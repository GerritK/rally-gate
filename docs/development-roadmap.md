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
- DNF/DNS stage-run outcome: `POST /stages/:id/close` (admin action) sweeps any `STARTED` run on that stage to `CANCELLED` (DNF) and marks `Stage.status = CLOSED`. `GET /classification/stages/:stageId/non-finishers` returns `CANCELLED` runs as DNF plus, once the stage is closed, any registered vehicle with no run at all as DNS (a stage that isn't closed yet reports no DNS — "no run yet" just means "hasn't started"). Dashboard has a "Close Stage" button and a DNF/DNS table next to Stage Classification. No automatic trigger yet — see "Gate control channel" in `architecture.md` for the planned `stage-stopped` broadcast that could call this later instead of a marshal clicking the button.
- Gate discovery, heartbeat & gate assignment (plan vs. live): gate-agent
  publishes `rally/gates/<gateId>/heartbeat` every 15s (`HEARTBEAT_INTERVAL_MS`)
  with a `capabilities` string; `GatesService` auto-creates an unassigned
  `Gate` row on first heartbeat and stamps `lastHeartbeatAt` on every one
  (`gates.service.ts`). `Gate` now only carries hardware identity
  (`id`/`name`/`lastHeartbeatAt`/`capabilities`) — no more
  `role`/`stageId`/`splitIndex`. `GateAssignment` (`gate-assignment.entity.ts`)
  is the (gate, stage, role, splitIndex) plan, with exactly one row `active`
  per gate at a time; `GET/POST /gate-assignments` and
  `POST /gate-assignments/:id/activate|deactivate` manage it.
  `EventsService.applyRules` looks up the gate's active assignment instead of
  reading `gate.role`/`gate.stageId`. Activation is a manual marshal action
  for now (there's no "start stage" server action yet to auto-flip it — see
  "Gate control channel" below). Dashboard has new Gates and Gate Assignments
  sections (list, online/offline from heartbeat age, create
  assignment, activate/deactivate/delete) replacing the old raw `PUT
  /gates/:id` role pre-configuration. Verified end-to-end: gate-agent
  heartbeat auto-registered a gate, an activated `stage_start` assignment
  turned a simulated detection into a `StageRun`.

## Next

Priority order (1 = next):

1. Manual correction of stage runs (admin override) — safety net for missed/bad detections (RFID, beam, missed transponder reads all funnel into this).
2. Gate/gate-node health reporting, plus expected stage time: optional
   `Stage.expectedDurationMs` set by the marshal, dashboard flags any
   `STARTED` run as overdue once `now - startTime` exceeds it. Client-side
   only (SSE data already has `startTime`), no new backend push needed.
   Bundled with health reporting since both are "tell the marshal something's
   wrong" signals. Health reporting's actual mechanism is now sketched under
   "Gate control channel" in `architecture.md` — a `stage-started` broadcast
   + per-gate `ready` ack, which also doubles as the clock-sync trigger
   (see `decoder-adapters.md` DS3231 note).
3. Standalone packaging (`apps/rally-server/packaging/standalone`, Node SEA/pkg + optional tray icon) — needed to hand `rally-server` to a marshal without a dev machine.
4. Real `OpenStintAdapter` once the RF hardware validation (two ordered gates) confirms reliable reads — critical path, but gated on external hardware validation so it runs in parallel with the above rather than blocking them.
5. mDNS/Bonjour broker autodiscovery so a gate can find `rally-server`'s MQTT
   broker on the local network instead of `MQTT_HOST` being typed in by hand
   — see "MQTT broker discovery" in `architecture.md`. Smaller and
   independent of the gate config web interface item below (no AP/hotspot
   work needed), though it feeds into that item's "MQTT host" field once
   built. Manual entry stays as a fallback for APs that block multicast.
6. **Gate config web interface** (bigger item, own service): local HTTP server
   on the gate Pi to set `GATE_ID`, Wi-Fi/network, and MQTT host without
   re-running the install script over SSH. Needs an **AP/hotspot mode**
   fallback (hostapd + dnsmasq, or a lib like balena's wifi-connect) so a
   marshal can reach it before the Pi has any network configured — Pi boots as
   its own AP when no known Wi-Fi is set, serves the config page, switches to
   station mode once Wi-Fi is saved. Also falls back to AP mode if it *has* a
   saved Wi-Fi that fails to connect (wrong password, gate out of range,
   router changed) — not just on first boot with nothing configured. Not
   designed yet.
7. Parc Fermé / time control / service park gate roles and their state transitions.

## Deliberately deferred

- Rule engine YAML DSL (rules are hardcoded in `EventsService` for now — fine at this scale).
- RC4 learning registry / transponder management UI.
- Auth on the MQTT broker, REST API, and web dashboard — MQTT client
  credentials, web UI login, possibly SSO, with gates authenticating against
  `rally-server` itself (it's already the one source of truth for what's
  allowed) rather than a separate identity system. Explicitly deferred until
  the core timing pipeline is solid — the rally WiFi being closed to
  outsiders is the security boundary for now (see `deployment-modes.md`
  "Future: online/spectator mode").
- Online/spectator sync mode (see `deployment-modes.md`).
