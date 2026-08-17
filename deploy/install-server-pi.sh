#!/usr/bin/env bash
# One-shot installer for headless/server mode on a stock Raspberry Pi OS Lite image.
# Usage: curl -fsSL https://raw.githubusercontent.com/GerritK/rally-gate/master/deploy/install-pi.sh | bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/GerritK/rally-gate.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/rally-gate}"

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR/deploy"
sudo docker compose up -d --build

IP=$(hostname -I | awk '{print $1}')
echo "rally-server running: http://$IP:57430"
