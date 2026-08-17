# Rally Gate

Open, modular timing and event management system for RC rally events. See
[ideas/RC_Rally_Timing_Project_Documentation.md](ideas/RC_Rally_Timing_Project_Documentation.md)
for the full project background, and `docs/` for architecture notes specific
to this implementation.

## Stack

- `apps/rally-server` — NestJS backend: REST API, embedded MQTT broker (Aedes), TypeORM (SQLite for dev/standalone, PostgreSQL for headless deployments), Server-Sent Events live feed.
- `apps/gate-agent` — runs on each gate node (or locally). Publishes detection events over MQTT via a swappable `DecoderAdapter` (only the `SimulatedAdapter` exists so far — see [docs/decoder-adapters.md](docs/decoder-adapters.md)).
- `apps/web` — Vue 3 + Vite dashboard: live detections and stage run results.
- `packages/shared` — TypeScript types shared by all three (gate roles, detection event shape, MQTT topics).

## Quickstart (local dev, no hardware needed)

```bash
npm install
npm run build:shared

# terminal 1
npm run dev:server

# terminal 2 — seed a demo stage/gates/vehicle
npm run seed-demo-data

# terminal 3 — fire a simulated start + finish detection
npm run simulate -- --gate START_WP1 --transponder 1234567
npm run simulate -- --gate FINISH_WP1 --transponder 1234567

# terminal 4
npm run dev:web
```

Open the printed Vite URL — the stage run and detections should appear live.

By default `rally-server` uses SQLite (`rally-gate.sqlite`), a REST/SSE API on
port 57430, and an in-process MQTT broker on port 57431 — all in the
57430–57439 range dedicated to this project to avoid clashing with other
services on the host (e.g. a standalone Mosquitto broker on the default 1883,
or another dev server on 3000/5173). No Docker or Postgres required for this
flow.

## Headless / server deployment

`deploy/docker-compose.yml` runs `rally-server` against PostgreSQL instead of
SQLite. See [docs/deployment-modes.md](docs/deployment-modes.md) for the
standalone-exe vs headless-server story.

```bash
docker compose -f deploy/docker-compose.yml up
# with simulated gate-agents for a hardware-free demo:
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dev.yml up
```

## Field deployment (Raspberry Pi)

One-shot installers for a stock Raspberry Pi OS Lite image — no manual git clone/build needed.

`rally-server` (Docker Compose, headless/server mode):
```bash
curl -fsSL https://raw.githubusercontent.com/GerritK/rally-gate/master/deploy/install-server-pi.sh | bash
```

`gate-agent` (bare-metal, needs direct USB/SDR access — see [docs/decoder-adapters.md](docs/decoder-adapters.md)). Interactive by default; pre-set the env vars to skip prompts:
```bash
curl -fsSL https://raw.githubusercontent.com/GerritK/rally-gate/master/deploy/install-gate-pi.sh | bash
# or non-interactive:
GATE_ID=CLUB_START_WP1 MQTT_HOST=192.168.1.10 bash -c "$(curl -fsSL https://raw.githubusercontent.com/GerritK/rally-gate/master/deploy/install-gate-pi.sh)"
```

No forced global uniqueness on `GATE_ID`, but pick one that won't collide with another club's — prefix it with your club's short code (e.g. `CLUB_START_WP1`) so gates stay collision-free if hardware ever gets shared or a joint event mixes clubs.

Installs as a systemd service (`rally-gate-agent`) — logs via `journalctl -u rally-gate-agent -f`. Optionally configures a DS3231 RTC module if one's connected (asked interactively).
