#!/usr/bin/env bash
# One-shot installer for headless/server mode on a stock Raspberry Pi OS Lite image.
# Usage: curl -fsSL https://github.com/GerritK/rally-gate/releases/latest/download/install-server-pi.sh | bash
# The release copy has RELEASE pinned to its tag, so script and code match;
# re-running a newer release's script updates to it. For development, the raw
# copy of a branch with BRANCH=<name> follows that branch (unset: the clone's
# branch, or master for a clone on a release):
#   curl -fsSL https://raw.githubusercontent.com/GerritK/rally-gate/<name>/deploy/install-server-pi.sh | BRANCH=<name> bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/GerritK/rally-gate.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/rally-gate}"
BRANCH="${BRANCH:-}"
# Set by the release job on the copy it attaches (.github/workflows/standalone.yml).
RELEASE="${RELEASE:-}"
# Outside INSTALL_DIR on purpose: that directory is a git clone, and an update
# should never have to reason about event data sitting inside it.
BACKUP_DIR="${BACKUP_DIR:-$HOME/rally-gate-backups}"

# Pi OS Lite ships no git, and this script arrives via curl | bash rather than
# from a clone, so nothing has pulled it in before the clone below. Guarded by
# an apt-get update because this script has no other apt step to share one with,
# and a fresh image has empty package lists.
if ! command -v git >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y git
fi

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  # Not `pull`, which refuses once upstream history has been rewritten.
  git -C "$INSTALL_DIR" fetch --tags --force
  if [ -n "$RELEASE" ]; then
    git -C "$INSTALL_DIR" checkout -f --detach "refs/tags/$RELEASE"
  else
    # A clone on a release has no branch, so nothing to reset to.
    if [ -z "$BRANCH" ] && ! git -C "$INSTALL_DIR" symbolic-ref -q HEAD >/dev/null; then
      BRANCH=master
    fi
    if [ -n "$BRANCH" ]; then
      git -C "$INSTALL_DIR" checkout -f -B "$BRANCH" --track "origin/$BRANCH"
    fi
    git -C "$INSTALL_DIR" reset --hard '@{u}'
  fi
else
  REF="${RELEASE:-$BRANCH}"
  git clone ${REF:+--branch "$REF"} "$REPO_URL" "$INSTALL_DIR"
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

# sudo drops the environment, hence the assignment inside it.
sudo env RALLY_GATE_VERSION="$(git -C "$INSTALL_DIR" describe --tags --always --dirty)" docker compose up -d --build

IP=$(hostname -I | awk '{print $1}')
echo "rally-server running — dashboard: http://$IP:57430  (API under http://$IP:57430/api)"
echo "Serving time on $IP:57432/udp — the same address gates use for MQTT, so"
echo "there is nothing extra to configure on a gate."
