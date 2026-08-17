# Development Roadmap

## Done

- Monorepo scaffold (`apps/rally-server`, `apps/gate-agent`, `apps/web`, `packages/shared`), npm workspaces.
- Core event pipeline: gate-agent -> embedded MQTT broker -> ingestion -> rule engine -> stage runs -> live SSE feed -> Vue dashboard.
- `stage_start` / `stage_finish` gate roles, single active stage run per vehicle+stage.
- Simulated detections (interval mode + one-off CLI) — no hardware required.
- SQLite (dev/standalone) and PostgreSQL (headless, via `deploy/docker-compose.yml`) both wired through one config.
- Results view: per-stage and overall classification (`/classification/stages/:stageId`, `/classification/overall`), ranked with gaps, deduped so stage reruns only count the latest run per vehicle+stage.
- Splits (`stage_split` role): `StageSplit` rows recorded per (stage run, split gate), pushed live via `/live/stage-run-splits`, displayed in the dashboard. Stages are now sorted by `stageNumber` in the API/dashboard. No stage-sequencing enforcement — any stage can still be started independently of others finishing.
- Live split-based classification/leaderboard: `GET /classification/stages/:stageId/split-gates` (lists configured split points for a stage) and `GET /classification/stages/:stageId/splits/:splitIndex` (ranks vehicles by elapsed time at that split, including in-progress `STARTED` runs, not just finished ones — excludes `CANCELLED`). Dashboard has a new "Split Classification" section with a split selector, refreshed on both `stage-run.updated` and `stage-run.split` live events. Verified end-to-end via simulate CLI (two vehicles, one crossing the split first while still on-stage) and a browser screenshot of the dashboard.

## Next

- Optional DNF/DNS stage-run outcome (`StageRunStatus.CANCELLED` is already reserved for this — needs a way to mark a run as such, e.g. an admin action or a timeout rule).
- Parc Fermé / time control / service park gate roles and their state transitions.
- Manual correction of stage runs (admin override).
- Gate/gate-node health reporting.
- Expected stage time: optional `Stage.expectedDurationMs` set by the
  marshal, dashboard flags any `STARTED` run as overdue once
  `now - startTime` exceeds it — helps catch a missed/failed detection
  rather than just a slow car. Client-side only (SSE data already has
  `startTime`), no new backend push needed.
- **Gate config web interface** (bigger item, own service): local HTTP server
  on the gate Pi to set `GATE_ID`, Wi-Fi/network, and MQTT host without
  re-running the install script over SSH. Needs an **AP/hotspot mode**
  fallback (hostapd + dnsmasq, or a lib like balena's wifi-connect) so a
  marshal can reach it before the Pi has any network configured — Pi boots as
  its own AP when no known Wi-Fi is set, serves the config page, switches to
  station mode once Wi-Fi is saved. Also falls back to AP mode if it *has* a
  saved Wi-Fi that fails to connect (wrong password, gate out of range,
  router changed) — not just on first boot with nothing configured. Not
  designed yet.
- Standalone packaging (`apps/rally-server/packaging/standalone`, Node SEA/pkg + optional tray icon).
- Real `OpenStintAdapter` once the RF hardware validation (two ordered gates) confirms reliable reads.

## Deliberately deferred

- Rule engine YAML DSL (rules are hardcoded in `EventsService` for now — fine at this scale).
- RC4 learning registry / transponder management UI.
- Auth on the MQTT broker or REST API.
- Online/spectator sync mode (see `deployment-modes.md`).
