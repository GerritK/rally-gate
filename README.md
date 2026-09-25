# Rally Gate

Open, modular timing and event management system for RC rally events. See
[ideas/RC_Rally_Timing_Project_Documentation.md](ideas/RC_Rally_Timing_Project_Documentation.md)
for the full project background, and `docs/` for architecture notes specific
to this implementation.

## Stack

- `apps/rally-server` — NestJS backend: REST API, embedded MQTT broker (Aedes), TypeORM (SQLite for dev/standalone, PostgreSQL for headless deployments), Server-Sent Events live feed.
- `apps/gate-agent` — runs on each gate node (or locally). Publishes detection events over MQTT via a swappable `DecoderAdapter` (only the `SimulatedAdapter` exists so far — see [docs/decoder-adapters.md](docs/decoder-adapters.md)).
- `apps/web` — Vue 3 + Vite dashboard: live timing, results, setup, hardware and vehicles ([docs/frontend-structure.md](docs/frontend-structure.md)).
- `apps/gate-config` — runs *on each gate*, serving a page that configures that gate: identity, server address, decoder, Wi-Fi, plus a status panel. So a gate needs no SSH and no re-running the installer ([docs/gate-config-ui.md](docs/gate-config-ui.md)).
- `packages/shared` — TypeScript types shared by every app (gate roles, detection event shape, MQTT topics, stage/classification/vehicle-status types).
- `packages/ui` — the Vuetify design system both web interfaces build on, so they read as one product.

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

By default `rally-server` uses SQLite (`rally-gate.sqlite`), the API on port
57430 and the MQTT broker on 57431 — no Docker or Postgres needed. The project
uses its own port range instead of framework defaults; see the table in
[CLAUDE.md](CLAUDE.md).

The gate config service is separate and needs none of the above:

```bash
npm run dev:gate-config      # API on 57439
npm run dev:gate-config-web  # its page on 57449, proxying /api to 57439
```

It shells out to systemd, chrony and NetworkManager, which exist on a Pi and
not on a laptop — every status row just reads as unavailable off a Pi rather
than failing. Point `GATE_CONFIG_FILE` and `CHRONY_SOURCE_DIR` at a scratch
directory so it doesn't want to write to `/etc`.

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
GATE_ID=CLUB_START_WP1 bash -c "$(curl -fsSL https://raw.githubusercontent.com/GerritK/rally-gate/master/deploy/install-gate-pi.sh)"
```

**A gate install asks nothing about the rally it will be used at.** No server
address: `rally-server` advertises itself over mDNS as `rally-server.local`,
which is what both `gate-agent` and chrony resolve, and it serves time itself
so a gate never has to know whether the server is a laptop or a Pi. Pass
`MQTT_HOST` only where the network blocks multicast.

No forced global uniqueness on `GATE_ID`, but pick one that won't collide with another club's — prefix it with your club's short code (e.g. `CLUB_START_WP1`) so gates stay collision-free if hardware ever gets shared or a joint event mixes clubs. The prompt defaults to the Pi's current hostname, and can optionally rename the Pi's hostname to match `GATE_ID` too, so the gate stays easy to find on the network (e.g. `club-start-wp1.local`).

Installs two systemd services — `rally-gate-agent` (logs via `journalctl -u rally-gate-agent -f`) and `rally-gate-config`, the gate's own config page at `http://<hostname>.local:57439`. Optionally configures a DS3231 RTC module if one's connected (asked interactively).

If a gate can reach no Wi-Fi it raises its own access point within a minute — `rally-gate-<hostname>`, password set at install time (default `rally-gate`) — so the config page is reachable in the state you most need it in. Join it and point the gate at the right network from the page.
