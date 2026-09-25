#!/usr/bin/env bash
# Interactive installer for gate-agent on a stock Raspberry Pi OS Lite image.
# Runs bare-metal (not Docker) so it has direct access to the RTL-SDR/USB
# decoder and any GPIO sensors — see apps/gate-agent/Dockerfile for why.
#
# Usage: curl -fsSL https://raw.githubusercontent.com/GerritK/rally-gate/master/deploy/install-gate-pi.sh | bash
# Prompts can be skipped by pre-setting the env vars, e.g.:
#   GATE_ID=CLUB_START_WP1 bash -c "$(curl -fsSL https://raw.githubusercontent.com/GerritK/rally-gate/master/deploy/install-gate-pi.sh)"
# MQTT_HOST is only needed where mDNS is blocked; it defaults to the name
# rally-server advertises for itself.
# GATE_ID should be globally unique — prefix it with your club's short code
# (see "Gate discovery & heartbeat" in docs/architecture.md).
# Build/apt output is hidden unless a step fails; -v shows it all:
#   curl -fsSL <url> | bash -s -- -v
set -euo pipefail

for arg in "$@"; do
  case "$arg" in
    -v|--verbose) VERBOSE=1 ;;
    *) echo "Unknown option: $arg (only -v/--verbose)" >&2; exit 1 ;;
  esac
done

REPO_URL="${REPO_URL:-https://github.com/GerritK/rally-gate.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/rally-gate}"

quiet() {
  if [ "${VERBOSE:-0}" = "1" ]; then "$@"; return; fi
  local log; log="$(mktemp)"
  "$@" >"$log" 2>&1 || { local rc=$?; cat "$log"; rm -f "$log"; return "$rc"; }
  rm -f "$log"
}
# The audit report is about the repo's lockfile, not something a marshal can act on.
export npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false

# Reads from the real terminal even when this script itself is piped in via curl | bash.
ask() {
  local var="$1" msg="$2" default="${3:-}"
  if [ -n "${!var:-}" ]; then return; fi
  local value
  read -rp "$msg${default:+ [$default]}: " value < /dev/tty
  printf -v "$var" '%s' "${value:-$default}"
}

echo "== rally-gate gate-agent setup =="
echo

echo "No two gates need a globally unique ID by force, but pick one that"
echo "won't collide if this gate is ever borrowed/loaned to another club or"
echo "used at a joint event. Prefix it with your club's short code, e.g."
echo "CLUB_START_WP1 rather than just START_WP1. Defaults to this Pi's"
echo "current hostname, in case that's already set up the way you want."
echo "This is the gate's identity on the server; the Pi's network name is"
echo "derived from it separately, since host names allow no underscores."
ask GATE_ID "Gate ID (e.g. CLUB_START_WP1)" "$(hostname)"
while [ -z "$GATE_ID" ]; do ask GATE_ID "Gate ID is required"; done

# Derived rather than reused: a host name may contain only letters, digits and
# hyphens (RFC 1123), while GATE_ID is deliberately underscore-separated
# (CLUB_START_WP1) and is matched verbatim by the server. Passing GATE_ID
# straight to raspi-config would write an invalid host name that avahi will not
# publish, so the gate would not be reachable as <name>.local at all — the one
# thing renaming it is for. Keeping them separate lets the ID keep its format.
# Trimmed after truncating, not before: cutting at 63 can land on a separator
# and leave a trailing hyphen, which is invalid too.
GATE_HOSTNAME="$(printf '%s' "$GATE_ID" | tr '[:upper:]_ ' '[:lower:]--' | tr -cd 'a-z0-9-' | cut -c1-63 | sed 's/^-*//; s/-*$//')"
[ -n "$GATE_HOSTNAME" ] || GATE_HOSTNAME="$(hostname)"

SET_HOSTNAME="n"
if [ "$GATE_HOSTNAME" != "$(hostname)" ]; then
  ask SET_HOSTNAME "Also rename this Pi's hostname to $GATE_HOSTNAME? (reachable as $GATE_HOSTNAME.local, which the gate config UI will need) (Y/n)" "y"
fi

# Defaulted, not required: rally-server advertises this name over mDNS
# (DiscoveryService), and both gate-agent and chrony resolve it through plain
# getaddrinfo. A gate install therefore needs no knowledge of the network it
# will be used on — see "Zero-config gates" in docs/development-roadmap.md.
# An IP typed here still wins, which is the fallback for APs that block
# multicast.
echo
echo "rally-server advertises itself as rally-server.local, so the default works"
echo "on any rally-gate network. Only enter an address if mDNS/multicast is"
echo "blocked on your network."
ask MQTT_HOST "rally-server address" "rally-server.local"

ask MQTT_PORT "rally-server MQTT port" "57431"
# Not a prompt: this is a property of rally-server, not of the event, and a gate
# install must not require knowing anything about the rally it will be used at.
NTP_PORT="${NTP_PORT:-57432}"

# Wi-Fi is configured from the gate config UI, not here — but the gate has to be
# reachable before it is on any network, so it raises its own access point when
# it cannot join one. That AP needs a WPA2 password: without it the gate
# broadcasts an open network on which anyone at the event can repoint timing
# hardware. Predictable on purpose rather than generated — the organiser needs
# it on a sticker, and a random one nobody wrote down is a gate that needs a
# keyboard. 8 characters is WPA2's own minimum.
echo
echo "This gate raises a Wi-Fi access point called rally-gate-$GATE_HOSTNAME when"
echo "it cannot join any network, so the config page stays reachable. Set the same"
echo "password on every gate at your club and write it on the box."
ask HOTSPOT_PASSWORD "Hotspot password (min 8 characters)" "rally-gate"
while [ "${#HOTSPOT_PASSWORD}" -lt 8 ]; do
  HOTSPOT_PASSWORD=""
  ask HOTSPOT_PASSWORD "Too short — WPA2 needs at least 8 characters" "rally-gate"
done

ask HAS_RTC "DS3231 RTC module connected? (y/N)" "n"

echo
echo "  Gate ID:     $GATE_ID"
echo "  Hostname:    $([[ "$SET_HOSTNAME" =~ ^[Yy]$ ]] && echo "$GATE_HOSTNAME.local (renaming from $(hostname))" || echo "unchanged ($(hostname).local)")"
echo "  MQTT host:   $MQTT_HOST:$MQTT_PORT"
echo "  Hotspot:     rally-gate-$GATE_HOSTNAME / $HOTSPOT_PASSWORD"
echo "  Install dir: $INSTALL_DIR"
echo "  RTC:         $([[ "$HAS_RTC" =~ ^[Yy]$ ]] && echo "DS3231" || echo "none")"
echo
read -rp "Proceed with install? [Y/n] " confirm < /dev/tty
[[ "${confirm:-y}" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

# A fresh Pi OS image ships with empty apt lists, so every apt-get install
# below (git, chrony, i2c-tools, and nodejs when nodesource doesn't run) needs
# this.
echo "-- updating package lists --"
quiet sudo apt-get update

# Pi OS Lite ships no git, and this script reaches the Pi through curl | bash
# rather than from a clone — so nothing has pulled it in by the time the clone
# below runs. Installed unconditionally: apt is a no-op when it is already
# there, and a `command -v` guard only adds a branch that is wrong on the one
# image that matters.
quiet sudo apt-get install -y git

if ! command -v node >/dev/null; then
  echo "-- installing Node.js --"
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
  quiet sudo -E bash /tmp/nodesource_setup.sh
  quiet sudo apt-get install -y nodejs
fi

echo "-- fetching rally-gate --"
if [ -d "$INSTALL_DIR/.git" ]; then
  # Installers before the switch to `npm ci` rewrote the lockfile on the gate,
  # which makes this pull refuse to run. Nobody edits it here on purpose.
  git -C "$INSTALL_DIR" checkout -- package-lock.json
  quiet git -C "$INSTALL_DIR" pull
else
  quiet git clone "$REPO_URL" "$INSTALL_DIR"
fi

echo "-- building gate-agent --"
cd "$INSTALL_DIR"
# ci, not install: exactly what CI tested, and it never rewrites the lockfile —
# which `install` did, blocking the `git pull` of every later update.
quiet npm ci
quiet npm run build --workspace=@rally-gate/shared
quiet npm run build --workspace=@rally-gate/gate-agent

echo "-- building gate-config (web UI, takes a minute on slower hardware) --"
# build:deploy skips vue-tsc: it OOMs a Pi on the Vuetify types, and CI already typechecks.
quiet npm run build:deploy --workspace=@rally-gate/gate-config

echo "-- installing configuration --"
# Config lives in a file, not in the unit: the gate config UI rewrites it at
# runtime, and a unit file is code — a partial write there bricks the service,
# and changing it needs a daemon-reload. Only written if absent, so re-running
# this installer never discards settings a marshal made in the UI.
sudo mkdir -p /etc/rally-gate
if [ -f /etc/rally-gate/gate.env ]; then
  echo "   keeping existing /etc/rally-gate/gate.env"
else
  sudo tee /etc/rally-gate/gate.env >/dev/null <<EOF
# Written by deploy/install-gate-pi.sh, then owned by @rally-gate/gate-config.
GATE_ID=$GATE_ID
MQTT_HOST=$MQTT_HOST
MQTT_PORT=$MQTT_PORT
HOTSPOT_PASSWORD=$HOTSPOT_PASSWORD
EOF
fi
# The directory, not just the file: gate-config saves by writing a temp file
# beside gate.env and renaming it over, which needs write access to the dir.
sudo chown -R "$USER": /etc/rally-gate

echo "-- installing systemd services --"
sudo tee /etc/systemd/system/rally-gate-agent.service >/dev/null <<EOF
[Unit]
Description=rally-gate gate-agent ($GATE_ID)
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node apps/gate-agent/dist/main.js
EnvironmentFile=/etc/rally-gate/gate.env
Restart=always
User=$USER

[Install]
WantedBy=multi-user.target
EOF

# A separate unit from gate-agent on purpose: gate-agent restarts forever, so a
# bad setting turns into a crash loop — and a config UI hosted inside it would
# die with the thing it exists to repair, leaving SSH as the only way in. See
# docs/gate-config-ui.md.
sudo tee /etc/systemd/system/rally-gate-config.service >/dev/null <<EOF
[Unit]
Description=rally-gate gate config UI
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/apps/gate-config
ExecStart=/usr/bin/node dist/main.js
Restart=always
User=$USER
# Port 80 only redirects to 57439 — it is what phones probe to detect a captive
# portal. The capability lets a non-root service bind it, and nothing else.
Environment=CAPTIVE_PORT=80
AmbientCapabilities=CAP_NET_BIND_SERVICE
# chrony's sourcedir, created owned by User= since gate-config writes the time
# source there. Preserved so a gate-config restart doesn't drop the source.
RuntimeDirectory=chrony-rally
RuntimeDirectoryPreserve=yes

[Install]
WantedBy=multi-user.target
EOF

# The other half of the captive portal: NetworkManager's hotspot dnsmasq reads
# this directory, so on the hotspot (and only there) every name resolves to the
# gate. 10.42.0.1 is NetworkManager's default address for a shared connection,
# which the hotspot never overrides.
# dnsmasq-base is also what hands out the hotspot's DHCP leases: NetworkManager
# only recommends it, and without it the hotspot comes up but no phone gets an
# address. -base is the bare binary; the `dnsmasq` package would add a
# system-wide service fighting NetworkManager's for port 53.
quiet sudo apt-get install -y dnsmasq-base
sudo mkdir -p /etc/NetworkManager/dnsmasq-shared.d
echo 'address=/#/10.42.0.1' | sudo tee /etc/NetworkManager/dnsmasq-shared.d/rally-gate-captive.conf >/dev/null

# Networking goes through a wrapper rather than a sudoers rule for nmcli, whose
# arguments vary and so would need a wildcard. That grant is effectively a root
# shell on an unauthenticated service — `nmcli connection import type openvpn`
# runs that file's up-script as root — where this one fixes every argument but
# the SSID and password. See the header of deploy/rally-gate-net.
sudo install -m 0755 "$INSTALL_DIR/deploy/rally-gate-net" /usr/local/sbin/rally-gate-net

# Exact commands rather than a blanket rule: this service is reachable by
# anyone on the rally network and has no authentication, so what it can do as
# root is the boundary.
sudo tee /etc/sudoers.d/rally-gate-config >/dev/null <<EOF
$USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart rally-gate-agent
$USER ALL=(root) NOPASSWD: /usr/bin/chronyc reload sources
$USER ALL=(root) NOPASSWD: /usr/local/sbin/rally-gate-net
EOF
sudo chmod 0440 /etc/sudoers.d/rally-gate-config
# A malformed sudoers file locks out sudo entirely, so check before trusting it.
sudo visudo -cf /etc/sudoers.d/rally-gate-config >/dev/null || {
  echo "   sudoers drop-in invalid, removing it"; sudo rm -f /etc/sudoers.d/rally-gate-config; }

# Reachability before the gate has a network — the state the config page is
# most needed in. Also the recovery path *after* a network that used to work
# stops working (wrong password, moved out of range, a different router at the
# next event), which is the difference between a gate a marshal can rescue and
# one that needs a keyboard.
sudo tee /etc/systemd/system/rally-gate-hotspot.service >/dev/null <<'EOF'
[Unit]
Description=rally-gate hotspot fallback
After=NetworkManager.service
Wants=NetworkManager.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/rally-gate-net watchdog
EOF

sudo tee /etc/systemd/system/rally-gate-hotspot.timer >/dev/null <<'EOF'
[Unit]
Description=rally-gate hotspot fallback check

[Timer]
# Long enough after boot for NetworkManager to associate and pick up a lease on
# a slow access point; anything shorter raises the hotspot over a connection
# that was about to succeed.
OnBootSec=60s
OnUnitActiveSec=30s
AccuracySec=5s

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
# `enable` then `restart`, not `enable --now`: --now leaves an already-running
# unit alone, so re-running this installer after a `git pull` would rebuild
# dist/ and keep serving the old code — silently, which is the worst kind. The
# README tells a marshal to update by re-running this script, so it has to
# actually take effect. `restart` starts a stopped unit too, so one line covers
# both a fresh install and an upgrade.
quiet sudo systemctl enable rally-gate-agent
sudo systemctl restart rally-gate-agent
quiet sudo systemctl enable rally-gate-config
sudo systemctl restart rally-gate-config
if command -v nmcli >/dev/null; then
  quiet sudo systemctl enable --now rally-gate-hotspot.timer
else
  # Pi OS Bookworm ships NetworkManager; an older image or a gate wired by
  # Ethernet has none, and the watchdog would just fail every 30s.
  echo "   no NetworkManager — skipping the hotspot fallback"
fi

echo "-- configuring chrony against $MQTT_HOST:$NTP_PORT --"
# apt's chrony Conflicts: with systemd-timesyncd so this is usually redundant,
# but do it explicitly: two daemons steering one clock is precisely the
# mid-stage discontinuity "Gate system clock policy" in docs/decoder-adapters.md
# exists to prevent, and it would be invisible in the timing data.
sudo systemctl disable --now systemd-timesyncd >/dev/null 2>&1 || true
quiet sudo apt-get install -y chrony

# What makes rally-server.local resolve for chrony and gate-agent alike: avahi
# answers mDNS, libnss-mdns is what puts it behind getaddrinfo. Raspberry Pi OS
# ships both (it is how raspberrypi.local works), installed explicitly because
# without them the default address resolves to nothing and the gate simply
# never connects.
quiet sudo apt-get install -y avahi-daemon libnss-mdns

# A conf.d drop-in, not a replacement chrony.conf, because Debian's default
# already sets `makestep 1 3` (step only on the first few updates, slew forever
# after) — which *is* the clock policy gates require — plus driftfile and
# rtcsync. Only the rally-specific bits are added here. If a future chrony
# ships a different makestep default, that policy is what silently broke.
sudo mkdir -p /etc/chrony/conf.d
sudo tee /etc/chrony/conf.d/rally-gate.conf >/dev/null <<EOF
# rally-server serves time itself, on its own port rather than 123 — see
# NtpService in apps/rally-server. That is what lets a gate use one address for
# both MQTT and time without knowing whether the server is a Pi or a laptop.
#
# A stage time is a subtraction between two gates' clocks, so what matters is
# that they agree with each other, not that either is absolutely right —
# \`prefer\` keeps rally-server winning even at a site that happens to have
# internet and can reach the distro's default pool.
server $MQTT_HOST port $NTP_PORT iburst prefer minpoll 4 maxpoll 6

# Lets gate-config repoint the time source when a marshal changes the server
# address, via \`chronyc reload sources\` rather than a chrony restart — a
# restart re-arms \`makestep\`, and a step mid-stage writes a discontinuity
# straight into a running StageRun.
sourcedir /run/chrony-rally
EOF
sudo systemctl restart chrony

# Printed rather than asserted: a hostname typed for MQTT_HOST comes back
# resolved here, so grepping for it would false-alarm. Look for a line whose
# first column is '^*' or '^+' against the time reference. If it is absent
# entirely, this chrony's chrony.conf is missing `confdir /etc/chrony/conf.d`
# and the drop-in above was ignored.
echo "   chrony sources ($MQTT_HOST should appear here):"
chronyc sources || true

# Exercises the exact path chrony and gate-agent use (getaddrinfo, so nss-mdns
# included), rather than trusting that avahi is merely installed.
if getent hosts "$MQTT_HOST" >/dev/null 2>&1; then
  echo "   $MQTT_HOST resolves to $(getent hosts "$MQTT_HOST" | awk '{print $1}' | head -1)"
else
  echo "   WARNING: $MQTT_HOST does not resolve. If rally-server is running,"
  echo "   this network is probably blocking mDNS/multicast — re-run with an IP:"
  echo "     MQTT_HOST=<ip> bash -c \"\$(curl -fsSL <this script url>)\""
fi

REBOOT_NEEDED=0

if [[ "$SET_HOSTNAME" =~ ^[Yy]$ ]]; then
  echo "-- renaming hostname to $GATE_HOSTNAME --"
  sudo raspi-config nonint do_hostname "$GATE_HOSTNAME"
  REBOOT_NEEDED=1
fi

if [[ "$HAS_RTC" =~ ^[Yy]$ ]]; then
  echo "-- configuring DS3231 RTC --"
  BOOT_CONFIG=/boot/firmware/config.txt
  [ -f "$BOOT_CONFIG" ] || BOOT_CONFIG=/boot/config.txt

  quiet sudo apt-get install -y i2c-tools

  grep -q '^dtparam=i2c_arm=on' "$BOOT_CONFIG" || { echo 'dtparam=i2c_arm=on' | sudo tee -a "$BOOT_CONFIG" >/dev/null; REBOOT_NEEDED=1; }
  grep -q '^dtoverlay=i2c-rtc,ds3231' "$BOOT_CONFIG" || { echo 'dtoverlay=i2c-rtc,ds3231' | sudo tee -a "$BOOT_CONFIG" >/dev/null; REBOOT_NEEDED=1; }

  # fake-hwclock guesses the time from its last-seen value; a real RTC replaces it,
  # and leaving both installed lets fake-hwclock overwrite the RTC-read time on boot.
  # Nothing further is needed to keep the RTC itself right: Debian's chrony.conf
  # sets `rtcsync`, so once chrony is locked onto the time reference the kernel writes
  # the corrected time back to the DS3231 — chrony sets it, the RTC holds it
  # through a reboot with no network.
  sudo apt-get purge -y fake-hwclock >/dev/null 2>&1 || true
fi

echo
echo "Done. gate-agent ($GATE_ID) is running — logs: journalctl -u rally-gate-agent -f"
echo "Config UI: http://$GATE_HOSTNAME.local:57439  (change the gate's settings"
echo "there instead of re-running this script)"
echo "Clock sync: chronyc tracking  (System time offset should settle under a"
echo "few ms; the Hardware page's clock column is the same check from the server)"
if command -v nmcli >/dev/null; then
  echo "If this gate ever finds no Wi-Fi it raises its own access point within a"
  echo "minute — join rally-gate-$GATE_HOSTNAME (password $HOTSPOT_PASSWORD) and open"
  echo "http://$GATE_HOSTNAME.local:57439 to point it at the right network."
fi

if [ "$REBOOT_NEEDED" = "1" ]; then
  echo
  read -rp "Hostname/RTC changes need a reboot to take effect. Reboot now? [Y/n] " reboot_ok < /dev/tty
  [[ "${reboot_ok:-y}" =~ ^[Yy]$ ]] && sudo reboot
fi
