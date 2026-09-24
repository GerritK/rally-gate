#!/usr/bin/env bash
# One-shot installer for headless/server mode on a stock Raspberry Pi OS Lite image.
# Usage: curl -fsSL https://raw.githubusercontent.com/GerritK/rally-gate/master/deploy/install-server-pi.sh | bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/GerritK/rally-gate.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/rally-gate}"
# Outside INSTALL_DIR on purpose: that directory is a git clone, and `git pull`
# should never have to reason about event data sitting inside it.
BACKUP_DIR="${BACKUP_DIR:-$HOME/rally-gate-backups}"

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

# Re-running this script pulls a newer commit and rebuilds. rally-server runs
# TypeORM with synchronize:true, so any entity change in that commit alters
# the schema of the *live event database* the moment it starts — including
# dropping a column that was renamed. Dump first; it costs seconds and is the
# only way back. Skipped on a first install, where there is nothing to dump.
if [ -n "$(sudo docker compose ps --status running --quiet postgres 2>/dev/null || true)" ]; then
  mkdir -p "$BACKUP_DIR"
  BACKUP="$BACKUP_DIR/rally_gate-$(date +%Y%m%d-%H%M%S).sql"
  echo "-- backing up the event database to $BACKUP --"
  sudo docker compose exec -T postgres pg_dump -U rally rally_gate >"$BACKUP"
  echo "   restore with: sudo docker compose exec -T postgres psql -U rally rally_gate < $BACKUP"
fi

sudo docker compose up -d --build

IP=$(hostname -I | awk '{print $1}')
echo "rally-server running — dashboard: http://$IP:57430  (API under http://$IP:57430/api)"
echo "Serving time on $IP:57433/udp — the same address gates use for MQTT, so"
echo "there is nothing extra to configure on a gate."
