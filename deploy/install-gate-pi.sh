#!/usr/bin/env bash
# Interactive installer for gate-agent on a stock Raspberry Pi OS Lite image.
# Runs bare-metal (not Docker) so it has direct access to the RTL-SDR/USB
# decoder and any GPIO sensors — see apps/gate-agent/Dockerfile for why.
#
# Usage: curl -fsSL https://raw.githubusercontent.com/GerritK/rally-gate/master/deploy/install-gate-pi.sh | bash
# Prompts can be skipped by pre-setting the env var (e.g. GATE_ID=START_WP1 ... | bash).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/GerritK/rally-gate.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/rally-gate}"

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

ask GATE_ID "Gate ID (e.g. START_WP1)"
while [ -z "$GATE_ID" ]; do ask GATE_ID "Gate ID is required"; done

ask MQTT_HOST "rally-server IP address"
while [ -z "$MQTT_HOST" ]; do ask MQTT_HOST "rally-server IP is required"; done

ask MQTT_PORT "rally-server MQTT port" "57431"
ask HAS_RTC "DS3231 RTC module connected? (y/N)" "n"

echo
echo "  Gate ID:     $GATE_ID"
echo "  MQTT host:   $MQTT_HOST:$MQTT_PORT"
echo "  Install dir: $INSTALL_DIR"
echo "  RTC:         $([[ "$HAS_RTC" =~ ^[Yy]$ ]] && echo "DS3231" || echo "none")"
echo
read -rp "Proceed with install? [Y/n] " confirm < /dev/tty
[[ "${confirm:-y}" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

if ! command -v node >/dev/null; then
  echo "-- installing Node.js --"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "-- fetching rally-gate --"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

echo "-- building gate-agent --"
cd "$INSTALL_DIR"
npm install
npm run build --workspace=@rally-gate/shared
npm run build --workspace=@rally-gate/gate-agent

echo "-- installing systemd service --"
sudo tee /etc/systemd/system/rally-gate-agent.service >/dev/null <<EOF
[Unit]
Description=rally-gate gate-agent ($GATE_ID)
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node apps/gate-agent/dist/main.js
Environment=GATE_ID=$GATE_ID
Environment=MQTT_HOST=$MQTT_HOST
Environment=MQTT_PORT=$MQTT_PORT
Restart=always
User=$USER

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now rally-gate-agent

REBOOT_NEEDED=0
if [[ "$HAS_RTC" =~ ^[Yy]$ ]]; then
  echo "-- configuring DS3231 RTC --"
  BOOT_CONFIG=/boot/firmware/config.txt
  [ -f "$BOOT_CONFIG" ] || BOOT_CONFIG=/boot/config.txt

  sudo apt-get install -y i2c-tools

  grep -q '^dtparam=i2c_arm=on' "$BOOT_CONFIG" || { echo 'dtparam=i2c_arm=on' | sudo tee -a "$BOOT_CONFIG" >/dev/null; REBOOT_NEEDED=1; }
  grep -q '^dtoverlay=i2c-rtc,ds3231' "$BOOT_CONFIG" || { echo 'dtoverlay=i2c-rtc,ds3231' | sudo tee -a "$BOOT_CONFIG" >/dev/null; REBOOT_NEEDED=1; }

  # fake-hwclock guesses the time from its last-seen value; a real RTC replaces it,
  # and leaving both installed lets fake-hwclock overwrite the RTC-read time on boot.
  sudo apt-get purge -y fake-hwclock >/dev/null 2>&1 || true
fi

echo
echo "Done. gate-agent ($GATE_ID) is running — logs: journalctl -u rally-gate-agent -f"

if [ "$REBOOT_NEEDED" = "1" ]; then
  echo
  read -rp "RTC config needs a reboot to take effect. Reboot now? [Y/n] " reboot_ok < /dev/tty
  [[ "${reboot_ok:-y}" =~ ^[Yy]$ ]] && sudo reboot
fi
