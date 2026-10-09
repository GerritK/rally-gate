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
# Re-running it updates the gate; the prompts then default to its current
# settings (/etc/rally-gate/gate.env), so pressing Enter keeps them.
# Build/apt output is hidden unless a step fails; -v shows it all:
#   curl -fsSL <url> | bash -s -- -v
set -euo pipefail

VERBOSE=0
for arg in "$@"; do
  case "$arg" in
    -v|--verbose) VERBOSE=1 ;;
    *) echo "Unknown option: $arg (only -v/--verbose)" >&2; exit 1 ;;
  esac
done

REPO_URL="${REPO_URL:-https://github.com/GerritK/rally-gate.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/rally-gate}"

# ---------------------------------------------------------------------------
# Output helpers. Colour and animation only on a real terminal (NO_COLOR
# honoured), so a piped/logged run stays plain text.
# ---------------------------------------------------------------------------
IS_TTY=0
[ -t 1 ] && IS_TTY=1
if [ "$IS_TTY" = 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\e[0m' C_BOLD=$'\e[1m' C_DIM=$'\e[2m'
  C_RED=$'\e[31m' C_GREEN=$'\e[32m' C_YELLOW=$'\e[33m' C_CYAN=$'\e[36m'
else
  C_RESET='' C_BOLD='' C_DIM='' C_RED='' C_GREEN='' C_YELLOW='' C_CYAN=''
fi
# Box/braille glyphs need a UTF-8 terminal; a bare serial console may not be one.
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
  *UTF-8*|*utf8*|*UTF8*|*utf-8*)
    G_OK='✓' G_FAIL='✘' G_WARN='!' G_FULL='█' G_EMPTY='░' G_RULE='─'
    SPIN=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏) ;;
  *)
    G_OK='+' G_FAIL='x' G_WARN='!' G_FULL='#' G_EMPTY='.' G_RULE='-'
    SPIN=('|' '/' '-' '\') ;;
esac

rule() { local r; printf -v r '%*s' 60 ''; printf '  %s%s%s\n' "$C_DIM" "${r// /$G_RULE}" "$C_RESET"; }
title() { echo; printf '  %s%s%s\n' "$C_BOLD$C_CYAN" "$1" "$C_RESET"; rule; }

# During the install the bottom two lines of the screen are a live area — the
# progress bar and the current task — redrawn in place instead of scrolling.
# Anything printed through note/ok/warn lands above it and stays. Off without a
# terminal and with -v (raw command output would tear it), which falls back to
# one line per finished task.
LIVE=0
AREA=0
TASK=""
STEP=0
TOTAL_STEPS=8
CURRENT_STEP=""
cols() { local c; c="$(tput cols 2>/dev/null || echo 80)"; echo "${c:-80}"; }
# Labels are cut to the terminal width: a line that wraps would make the
# one-line cursor jump in area_clear land in the wrong place.
fit() { local max=$(($(cols) - $2)); [ "${#1}" -le "$max" ] && printf '%s' "$1" || printf '%s…' "${1:0:max-1}"; }
bar_line() {
  local width=24 filled bar='' i
  filled=$(($1 * width / TOTAL_STEPS))
  for ((i = 0; i < width; i++)); do
    if [ "$i" -lt "$filled" ]; then bar+="$G_FULL"; else bar+="$G_EMPTY"; fi
  done
  printf '  %s%s%s %s%3d%%%s  %s%s%s %s(%d/%d)%s' "$C_CYAN" "$bar" "$C_RESET" \
    "$C_BOLD" "$(($1 * 100 / TOTAL_STEPS))" "$C_RESET" "$C_BOLD" "$(fit "$2" 48)" "$C_RESET" \
    "$C_DIM" "$STEP" "$TOTAL_STEPS" "$C_RESET"
}
area_clear() { if [ "$AREA" = 1 ]; then printf '\r\e[1A\e[J'; AREA=0; fi; }
# Leaves the cursor at the end of the task line, so the spinner can rewrite
# just that line with \r.
area_draw() {
  [ "$LIVE" = 1 ] || return 0
  area_clear
  printf '%s\n%s' "$(bar_line "${1:-$((STEP - 1))}" "$CURRENT_STEP")" "$TASK"
  AREA=1
}
say() { area_clear; printf '%s\n' "$1"; area_draw; }
note() { say "  ${C_DIM}$1${C_RESET}"; }
ok() { say "  ${C_GREEN}${G_OK}${C_RESET} $1"; }
warn() { say "  ${C_YELLOW}${C_BOLD}${G_WARN} $1${C_RESET}"; }
# A routine result: replaces the task line in the live area rather than adding one.
info() { if [ "$LIVE" = 1 ]; then TASK="  ${C_GREEN}${G_OK}${C_RESET} $1"; area_draw; else ok "$1"; fi; }

step() {
  STEP=$((STEP + 1)) CURRENT_STEP="$1" TASK=""
  if [ "$LIVE" = 1 ]; then area_draw; return; fi
  echo
  printf '%s\n' "$(bar_line "$STEP" "$1")"
}

# Runs a command with its output hidden behind a spinner, replaying the output
# only if it fails. Backgrounded so the spinner can animate; stdin is
# /dev/null because under curl | bash stdin is this script itself.
RUN_PID=""
run() {
  local label="$1"; shift
  if [ "$VERBOSE" = 1 ]; then
    printf '  %s>%s %s\n' "$C_CYAN" "$C_RESET" "$label"
    "$@"
    return
  fi
  local log rc=0 i=0 start=$SECONDS short
  short="$(fit "$label" 12)"
  log="$(mktemp)"
  "$@" >"$log" 2>&1 </dev/null &
  RUN_PID=$!
  if [ "$IS_TTY" = 1 ]; then
    while kill -0 "$RUN_PID" 2>/dev/null; do
      printf '\r  %s%s%s %s %s%ds%s\e[K' "$C_CYAN" "${SPIN[i++ % ${#SPIN[@]}]}" "$C_RESET" \
        "$short" "$C_DIM" "$((SECONDS - start))" "$C_RESET"
      sleep 0.1
    done
    printf '\r\e[K'
  fi
  wait "$RUN_PID" || rc=$?
  RUN_PID=""
  if [ "$rc" != 0 ]; then
    area_clear
    LIVE=0
    printf '  %s%s %s%s\n\n' "$C_RED$C_BOLD" "$G_FAIL" "$label" "$C_RESET"
    sed 's/^/    /' "$log"
  elif [ "$LIVE" = 1 ]; then
    TASK="  ${C_GREEN}${G_OK}${C_RESET} $short ${C_DIM}$((SECONDS - start))s${C_RESET}"
    printf '%s' "$TASK"
  else
    printf '  %s%s%s %s %s%ds%s\n' "$C_GREEN" "$G_OK" "$C_RESET" "$label" "$C_DIM" "$((SECONDS - start))" "$C_RESET"
  fi
  rm -f "$log"
  return "$rc"
}

on_exit() {
  local rc=$?
  [ -n "$RUN_PID" ] && kill "$RUN_PID" 2>/dev/null
  area_clear
  [ "$IS_TTY" = 1 ] && printf '\e[?25h'
  if [ "$rc" != 0 ] && [ -n "$CURRENT_STEP" ]; then
    LIVE=0
    echo
    printf '  %s%s Installation stopped during: %s%s\n' "$C_RED$C_BOLD" "$G_FAIL" "$CURRENT_STEP" "$C_RESET"
    note "Nothing is broken by stopping here. Check the message above (often a"
    note "lost internet connection), then run the same install command again."
    note "Add  -s -- -v  after  bash  to see every detail."
  fi
}
trap on_exit EXIT

# The audit report is about the repo's lockfile, not something a marshal can act on.
export npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false

# Reads from the real terminal even when this script itself is piped in via curl | bash.
ask() {
  local var="$1" msg="$2" default="${3:-}"
  if [ -n "${!var:-}" ]; then return; fi
  local value
  read -rp "  ${C_BOLD}${C_CYAN}?${C_RESET} ${C_BOLD}${msg}${C_RESET}${default:+ ${C_DIM}[$default]${C_RESET}}: " value < /dev/tty
  printf -v "$var" '%s' "${value:-$default}"
}
is_yes() { [[ "$1" =~ ^[Yy] ]]; }

GATE_ENV=/etc/rally-gate/gate.env
BOOT_CONFIG=/boot/firmware/config.txt
[ -f "$BOOT_CONFIG" ] || BOOT_CONFIG=/boot/config.txt

# On a re-run (the documented way to update) the current settings become the
# prompt defaults, so Enter-Enter-Enter keeps the gate as it is — including
# whatever a marshal changed in the config UI since. Parsed, not sourced: the
# file is writable by an unauthenticated service, and sourcing it would run it.
if [ -r "$GATE_ENV" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      GATE_ID|MQTT_HOST|MQTT_PORT|HOTSPOT_PASSWORD) printf -v "CUR_$key" '%s' "$value" ;;
    esac
  done < "$GATE_ENV"
fi
CUR_HAS_RTC=n
grep -qs '^dtoverlay=i2c-rtc,ds3231' "$BOOT_CONFIG" && CUR_HAS_RTC=y

echo
printf '  %sRALLY GATE%s  %s·  Timing gate installer%s\n' "$C_BOLD$C_CYAN" "$C_RESET" "$C_DIM" "$C_RESET"
rule
note "This sets up this Raspberry Pi as a timing gate. You'll answer a few"
note "questions first; pressing Enter accepts the suggestion in [brackets]."
if [ -r "$GATE_ENV" ]; then
  echo
  ok "Existing gate found — the suggestions are its current settings,"
  note "  so pressing Enter everywhere simply updates it."
fi

title "1. Name this gate"
note "Every gate needs its own name. Start it with your club's short code so"
note "it stays unique when gates are shared between clubs, e.g. CLUB_START_WP1."
ask GATE_ID "Gate name" "${CUR_GATE_ID:-$(hostname | tr '[:lower:]-' '[:upper:]_')}"
while [ -z "$GATE_ID" ]; do ask GATE_ID "A gate name is required"; done

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
  echo
  note "To open this gate's settings page later, it needs a matching network"
  note "name: $GATE_HOSTNAME.local (recommended)."
  ask SET_HOSTNAME "Rename this Pi to $GATE_HOSTNAME? (Y/n)" "y"
fi

title "2. Timing server"
# Defaulted, not required: rally-server advertises this name over mDNS
# (DiscoveryService), and both gate-agent and chrony resolve it through plain
# getaddrinfo. A gate install therefore needs no knowledge of the network it
# will be used on — see "Zero-config gates" in docs/development-roadmap.md.
# An IP typed here still wins, which is the fallback for APs that block
# multicast.
note "The gate finds the timing server on its own. Just press Enter, unless"
note "a technician gave you an address to type in."
ask MQTT_HOST "Server address" "${CUR_MQTT_HOST:-rally-server.local}"
ask MQTT_PORT "Server port" "${CUR_MQTT_PORT:-57431}"
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
title "3. Emergency Wi-Fi"
note "When this gate can't find a known Wi-Fi, it opens its own network called"
note "rally-gate-$GATE_HOSTNAME so you can still reach it with a phone."
note "Use the same password on all your club's gates and write it on the box."
ask HOTSPOT_PASSWORD "Wi-Fi password (at least 8 characters)" "${CUR_HOTSPOT_PASSWORD:-rally-gate}"
while [ "${#HOTSPOT_PASSWORD}" -lt 8 ]; do
  HOTSPOT_PASSWORD=""
  ask HOTSPOT_PASSWORD "Too short — please use at least 8 characters" "rally-gate"
done

title "4. Clock module"
note "A DS3231 is a small battery-backed clock board on the Pi's pins."
note "Answer n if you're not sure."
ask HAS_RTC "Is a DS3231 clock module fitted? (y/n)" "$CUR_HAS_RTC"

title "Summary"
row() { printf '  %s%-16s%s %s\n' "$C_DIM" "$1" "$C_RESET" "$2"; }
row "Gate name" "$GATE_ID"
row "Network name" "$(is_yes "$SET_HOSTNAME" && echo "$GATE_HOSTNAME.local (renamed from $(hostname))" || echo "$(hostname).local (unchanged)")"
row "Timing server" "$MQTT_HOST:$MQTT_PORT"
row "Emergency Wi-Fi" "rally-gate-$GATE_HOSTNAME  /  $HOTSPOT_PASSWORD"
row "Clock module" "$(is_yes "$HAS_RTC" && echo "DS3231" || echo "none")"
row "Install folder" "$INSTALL_DIR"
echo
note "Installing takes about 5–15 minutes and needs internet access."
read -rp "  ${C_BOLD}${C_CYAN}?${C_RESET} ${C_BOLD}Start the installation?${C_RESET} ${C_DIM}[Y/n]${C_RESET}: " confirm < /dev/tty
is_yes "${confirm:-y}" || { echo; note "Cancelled — nothing was changed."; exit 0; }

# The spinner runs commands in the background, where sudo can't ask for a
# password — so ask once up front and keep the ticket alive for the long build.
sudo -v
( while kill -0 $$ 2>/dev/null; do sudo -n true; sleep 50; done ) >/dev/null 2>&1 &

if [ "$IS_TTY" = 1 ] && [ "$VERBOSE" = 0 ]; then
  LIVE=1
  printf '\n\e[?25l'
fi

step "Preparing the system"
# A fresh Pi OS image ships with empty apt lists, so every apt-get install
# below (git, chrony, i2c-tools, and nodejs when nodesource doesn't run) needs
# this.
run "Updating package lists" sudo apt-get update
# Pi OS Lite ships no git, and this script reaches the Pi through curl | bash
# rather than from a clone — so nothing has pulled it in by the time the clone
# below runs. Installed unconditionally: apt is a no-op when it is already
# there, and a `command -v` guard only adds a branch that is wrong on the one
# image that matters.
run "Installing git" sudo apt-get install -y git
# gpiod: the light-barrier adapter reads its GPIO pin through gpiomon, and the
# gpio group is what lets the unprivileged service open /dev/gpiochip*.
run "Installing sensor tools" sudo apt-get install -y gpiod
getent group gpio >/dev/null && sudo usermod -aG gpio "$USER"
# openstint: the transponder adapter spawns its openstint_rtlsdr itself, so the
# package's own service is disabled — two decoders can't share one SDR. Upstream
# only publishes arm64; plugdev opens the SDR, users writes /var/lib/openstint.
if [ "$(dpkg --print-architecture)" = arm64 ]; then
  echo 'deb [trusted=yes arch=arm64] https://repo.lapbeeps.com/apt/ /' | sudo tee /etc/apt/sources.list.d/openstint.list >/dev/null
  run "Adding the OpenStint source" sudo apt-get update
  run "Installing OpenStint" sudo apt-get install -y openstint
  sudo systemctl disable --now openstint.service >/dev/null 2>&1 || true
  sudo usermod -aG plugdev,users "$USER"
  # Our own rule rather than trusting the distro's: those may grant the SDR via
  # TAG+="uaccess" only, i.e. to the logged-in seat user, which leaves a system
  # service with usb_open error -3 (LIBUSB_ERROR_ACCESS). 0bda:2838 is the RTL-SDR
  # Blog V4 and most RTL2832U dongles, 2832 the rest.
  sudo tee /etc/udev/rules.d/60-rally-gate-rtlsdr.rules >/dev/null <<'EOF'
SUBSYSTEM=="usb", ATTRS{idVendor}=="0bda", ATTRS{idProduct}=="2838", MODE="0660", GROUP="plugdev"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0bda", ATTRS{idProduct}=="2832", MODE="0660", GROUP="plugdev"
EOF
  sudo udevadm control --reload
  sudo udevadm trigger --subsystem-match=usb
else
  note "Not arm64: skipping OpenStint, ADAPTER=openstint won't run on this gate"
fi

step "Installing Node.js"
if command -v node >/dev/null; then
  info "Node.js $(node --version) already installed"
else
  run "Downloading Node.js setup" curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
  run "Adding Node.js source" sudo -E bash /tmp/nodesource_setup.sh
  run "Installing Node.js" sudo apt-get install -y nodejs
fi

step "Downloading Rally Gate"
if [ -d "$INSTALL_DIR/.git" ]; then
  # Not `pull`: it refuses on a rewritten upstream history or on a lockfile an
  # older installer's `npm install` left modified. Nobody edits this clone on
  # purpose — config lives in /etc, build output is gitignored.
  run "Fetching the latest version" git -C "$INSTALL_DIR" fetch
  run "Updating files" git -C "$INSTALL_DIR" reset --hard '@{u}'
else
  run "Downloading" git clone "$REPO_URL" "$INSTALL_DIR"
fi

step "Building the gate software"
cd "$INSTALL_DIR"
# ci, not install: exactly what CI tested, and it never rewrites the lockfile —
# which `install` did, leaving the clone dirty.
# Only the gate's workspaces: the rest of the monorepo (rally-server's Nest,
# TypeORM and native better-sqlite3, the dashboard) is about half the install
# and never runs here. A new workspace the gate imports must be added here too.
run "Installing dependencies" npm ci --workspace=@rally-gate/shared --workspace=@rally-gate/gate-agent --workspace=@rally-gate/gate-config
run "Building shared code" npm run build --workspace=@rally-gate/shared
run "Building the gate service" npm run build --workspace=@rally-gate/gate-agent
# build:deploy skips vue-tsc: it OOMs a Pi on the Vuetify types, and CI already typechecks.
run "Building the settings page (the slowest part)" npm run build:deploy --workspace=@rally-gate/gate-config

step "Saving gate settings"
# Config lives in a file, not in the unit: the gate config UI rewrites it at
# runtime, and a unit file is code — a partial write there bricks the service,
# and changing it needs a daemon-reload. On a re-run only the keys prompted for
# above are replaced; everything else in it (decoder settings made in the UI)
# is kept as it is.
sudo mkdir -p /etc/rally-gate
{
  if [ -f "$GATE_ENV" ]; then
    grep -vE '^(GATE_ID|MQTT_HOST|MQTT_PORT|HOTSPOT_PASSWORD)=' "$GATE_ENV" || true
  else
    echo "# Written by deploy/install-gate-pi.sh, then owned by @rally-gate/gate-config."
  fi
  printf '%s\n' "GATE_ID=$GATE_ID" "MQTT_HOST=$MQTT_HOST" "MQTT_PORT=$MQTT_PORT" "HOTSPOT_PASSWORD=$HOTSPOT_PASSWORD"
} >/tmp/rally-gate.env
sudo mv /tmp/rally-gate.env "$GATE_ENV"
# The directory, not just the file: gate-config saves by writing a temp file
# beside gate.env and renaming it over, which needs write access to the dir.
sudo chown -R "$USER": /etc/rally-gate
info "Settings saved to $GATE_ENV"

step "Setting up background services"
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
# Without a delay, five failed starts in 10s make systemd give up for good — a
# gate whose sensor or SDR was unplugged at boot would never come back.
RestartSec=5
User=$USER
# Lets the openstint adapter run its decoder SCHED_FIFO (chrt) without root.
LimitRTPRIO=70

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
run "Installing emergency Wi-Fi support" sudo apt-get install -y dnsmasq-base
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
$USER ALL=(root) NOPASSWD: /usr/bin/systemctl poweroff
$USER ALL=(root) NOPASSWD: /usr/bin/chronyc reload sources
$USER ALL=(root) NOPASSWD: /usr/bin/chronyc refresh
$USER ALL=(root) NOPASSWD: /usr/local/sbin/rally-gate-net
EOF
sudo chmod 0440 /etc/sudoers.d/rally-gate-config
# A malformed sudoers file locks out sudo entirely, so check before trusting it.
sudo visudo -cf /etc/sudoers.d/rally-gate-config >/dev/null || {
  warn "Permission file invalid, removing it — the settings page can't restart the gate"
  sudo rm -f /etc/sudoers.d/rally-gate-config; }

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
# unit alone, so re-running this installer after an update would rebuild
# dist/ and keep serving the old code — silently, which is the worst kind. The
# README tells a marshal to update by re-running this script, so it has to
# actually take effect. `restart` starts a stopped unit too, so one line covers
# both a fresh install and an upgrade.
run "Starting the gate service" sh -c 'sudo systemctl enable rally-gate-agent && sudo systemctl restart rally-gate-agent'
run "Starting the settings page" sh -c 'sudo systemctl enable rally-gate-config && sudo systemctl restart rally-gate-config'
if command -v nmcli >/dev/null; then
  run "Enabling emergency Wi-Fi" sudo systemctl enable --now rally-gate-hotspot.timer
else
  # Pi OS Bookworm ships NetworkManager; an older image or a gate wired by
  # Ethernet has none, and the watchdog would just fail every 30s.
  warn "No NetworkManager on this Pi — emergency Wi-Fi is not available"
fi

step "Setting up clock sync"
# apt's chrony Conflicts: with systemd-timesyncd so this is usually redundant,
# but do it explicitly: two daemons steering one clock is precisely the
# mid-stage discontinuity "Gate system clock policy" in docs/decoder-adapters.md
# exists to prevent, and it would be invisible in the timing data.
sudo systemctl disable --now systemd-timesyncd >/dev/null 2>&1 || true
run "Installing the clock service" sudo apt-get install -y chrony

# What makes rally-server.local resolve for chrony and gate-agent alike: avahi
# answers mDNS, libnss-mdns is what puts it behind getaddrinfo. Raspberry Pi OS
# ships both (it is how raspberrypi.local works), installed explicitly because
# without them the default address resolves to nothing and the gate simply
# never connects.
run "Installing server discovery" sudo apt-get install -y avahi-daemon libnss-mdns

# A conf.d drop-in, not a replacement chrony.conf, because Debian's default
# already sets `makestep 1 3` (step only on the first few updates, slew forever
# after) — which *is* the clock policy gates require — plus driftfile and
# rtcsync. Only the rally-specific bits are added here. If a future chrony
# ships a different makestep default, that policy is what silently broke.
sudo mkdir -p /etc/chrony/conf.d
sudo tee /etc/chrony/conf.d/rally-gate.conf >/dev/null <<EOF
# rally-server is this gate's only time source. gate-config writes it into
# /run/chrony-rally from MQTT_HOST, at every start and save, and applies it with
# \`chronyc reload sources\` rather than a chrony restart — a restart re-arms
# \`makestep\`, and a step mid-stage writes a discontinuity straight into a
# running StageRun. rally-server serves time itself on its own port
# (NtpService), so one address covers MQTT and time on a Pi or a laptop.
sourcedir /run/chrony-rally
EOF
# A stage time is a subtraction between two gates' clocks, so they must agree
# with each other, not with the world. Any other source breaks that: a gate that
# reaches the internet or a DHCP-advertised NTP server outvotes rally-server
# (seen with a laptop 3.5s off) and follows a different clock than a gate that
# can't. Commented out rather than replacing chrony.conf, to keep makestep.
sudo sed -i -E 's,^(pool |sourcedir /run/chrony-dhcp),#rally-gate: &,' /etc/chrony/chrony.conf
run "Pointing the clock at the timing server ($MQTT_HOST:$NTP_PORT)" sudo systemctl restart chrony

# Printed rather than asserted: a hostname typed for MQTT_HOST comes back
# resolved here, so grepping for it would false-alarm. Look for a line whose
# first column is '^*' or '^+' against the time reference. If it is absent
# entirely, this chrony's chrony.conf is missing `confdir /etc/chrony/conf.d`
# and the drop-in above was ignored.
CHRONY_SOURCES="$(chronyc sources 2>&1 || true)"

# Exercises the exact path chrony and gate-agent use (getaddrinfo, so nss-mdns
# included), rather than trusting that avahi is merely installed.
SERVER_STATUS="not found yet"
if getent hosts "$MQTT_HOST" >/dev/null 2>&1; then
  SERVER_STATUS="found at $(getent hosts "$MQTT_HOST" | awk '{print $1}' | head -1)"
  info "Timing server $SERVER_STATUS"
else
  warn "Timing server $MQTT_HOST not found right now."
  note "  That's fine if the server isn't running yet. If it is, this network"
  note "  probably blocks auto-discovery — run the installer again with its IP:"
  note "    MQTT_HOST=<ip> bash -c \"\$(curl -fsSL <this script url>)\""
fi

step "Hostname and clock module"
REBOOT_NEEDED=0
if is_yes "$SET_HOSTNAME"; then
  run "Renaming this Pi to $GATE_HOSTNAME" sudo raspi-config nonint do_hostname "$GATE_HOSTNAME"
  REBOOT_NEEDED=1
fi

if is_yes "$HAS_RTC"; then
  run "Installing clock module tools" sudo apt-get install -y i2c-tools

  grep -q '^dtparam=i2c_arm=on' "$BOOT_CONFIG" || { echo 'dtparam=i2c_arm=on' | sudo tee -a "$BOOT_CONFIG" >/dev/null; REBOOT_NEEDED=1; }
  grep -q '^dtoverlay=i2c-rtc,ds3231' "$BOOT_CONFIG" || { echo 'dtoverlay=i2c-rtc,ds3231' | sudo tee -a "$BOOT_CONFIG" >/dev/null; REBOOT_NEEDED=1; }

  # fake-hwclock guesses the time from its last-seen value; a real RTC replaces it,
  # and leaving both installed lets fake-hwclock overwrite the RTC-read time on boot.
  # Nothing further is needed to keep the RTC itself right: Debian's chrony.conf
  # sets `rtcsync`, so once chrony is locked onto the time reference the kernel writes
  # the corrected time back to the DS3231 — chrony sets it, the RTC holds it
  # through a reboot with no network.
  sudo apt-get purge -y fake-hwclock >/dev/null 2>&1 || true
  info "DS3231 clock module enabled"
fi
is_yes "$SET_HOSTNAME" || is_yes "$HAS_RTC" || info "Nothing to change"

CURRENT_STEP="Installation complete" TASK=""
if [ "$LIVE" = 1 ]; then
  area_draw "$TOTAL_STEPS"
  printf '\e[?25h'
  AREA=0 LIVE=0
fi
CURRENT_STEP=""

echo
echo
printf '  %s%s Gate %s is installed and running%s\n' "$C_GREEN$C_BOLD" "$G_OK" "$GATE_ID" "$C_RESET"
rule
row "Timing server" "$MQTT_HOST ($SERVER_STATUS)"
row "Settings page" "${C_BOLD}http://$GATE_HOSTNAME.local:57439${C_RESET}"
note "                   Change the gate's settings there — no need to re-run this."
if command -v nmcli >/dev/null; then
  row "Emergency Wi-Fi" "rally-gate-$GATE_HOSTNAME  /  $HOTSPOT_PASSWORD"
  note "                   Appears within a minute when no known Wi-Fi is around."
fi
echo
note "For technicians:"
note "  Logs:        journalctl -u rally-gate-agent -f"
note "  Clock sync:  chronyc tracking  (offset should settle under a few ms)"
note "  Clock sources ($MQTT_HOST should be listed):"
printf '%s\n' "$CHRONY_SOURCES" | sed "s/^/    $C_DIM/; s/\$/$C_RESET/"

if [ "$REBOOT_NEEDED" = 1 ]; then
  echo
  warn "A restart is needed to finish (new name / clock module)."
  read -rp "  ${C_BOLD}${C_CYAN}?${C_RESET} ${C_BOLD}Restart now?${C_RESET} ${C_DIM}[Y/n]${C_RESET}: " reboot_ok < /dev/tty
  is_yes "${reboot_ok:-y}" && sudo reboot
fi
exit 0
