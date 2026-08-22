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
  per gate at a time; `GET/POST /gate-assignments` manage the plan rows.
  `EventsService.applyRules` looks up the gate's active assignment instead of
  reading `gate.role`/`gate.stageId`. Activation is a manual marshal action
  for now (there's no "start stage" server action yet to auto-flip it — see
  "Gate control channel" below). Dashboard has new Gates and Gate Assignments
  sections (list, online/offline from heartbeat age, create/delete
  assignment) replacing the old raw `PUT /gates/:id` role pre-configuration.
  Verified end-to-end: gate-agent heartbeat auto-registered a gate, an
  activated `stage_start` assignment turned a simulated detection into a
  `StageRun`. **Superseded:** activation was per-assignment
  (`POST /gate-assignments/:id/activate|deactivate`) at the time this was
  written; it's now per-stage (`POST /stages/:id/activate`, with a
  cross-stage gate-conflict warning) and there's no standalone deactivate —
  `POST /stages/:id/close` deactivates the stage's gates as part of closing
  — see `architecture.md` "Gate assignment: plan vs. live" and
  `frontend-structure.md`.
- Manual correction of stage runs (admin override): `PATCH /stage-runs/:id`
  lets a marshal fix `startTime`/`finishTime` on an existing run (`durationMs`
  recomputed server-side), `POST /stage-runs` creates one outright when a
  start detection never arrived, `DELETE /stage-runs/:id` removes a phantom
  row (e.g. a misread transponder). All three emit `stage-run.updated`
  through the same event bus the gate pipeline uses, so the live dashboard
  picks up corrections without a special case. Dashboard's Stage Runs table
  has a per-row "Correct" toggle (off by default) that swaps start/finish to
  editable inputs; a Delete button; and a form to add a missing run.
  `StageRun.status` is not a stored/settable field — it's derived on read
  from `finishTime` + whether the run's stage is closed (see `StageRun` in
  `event-model.md`), so there's no status editor and `Stage.close()` no
  longer writes a DNF sweep to `StageRun` rows at all. Verified via `curl`
  against the running server (create → correct finish time → classification
  reflects it → close stage flips the still-open run to CANCELLED/DNF for
  free → delete → 404 on a missing id) and `vue-tsc`/`tsc` typechecks; no
  dedicated e2e browser test.
- Frontend restructuring: `apps/web` split from one `App.vue` into a
  `vue-router` multi-page app behind a `v-navigation-drawer` (5 top-level
  routes — Live Timing, Results, Setup, Hardware, Vehicles — plus nested
  `/results/stages/:stageId` and `/setup/stages/:stageId`), per the plan in
  `docs/frontend-structure.md`. Includes the new `RallyInfo` backend module
  (singleton entity/service/controller, `GET`/`PUT /rally-info`) and the new
  Vehicles registration UI (`POST /vehicles` had no caller before). Gate
  assignment CRUD moved from a flat cross-stage table to nested under its
  stage's setup page (`/setup/stages/:stageId`, filtered client-side from
  `GET /gate-assignments`); Hardware is now a read-only gate-centric roster.
  Verified end-to-end with a headless-browser pass through every route
  (RallyInfo save round-trip, stage create, gate assignment add, vehicle
  add) — no console errors.
- Gate management on the Hardware page: add/rename/delete a gate manually
  (`PUT`/`DELETE /gates/:id`) instead of only via auto-discovery from its
  first heartbeat, plus a per-event auto-discovery on/off toggle backed by
  a new generic `Settings` key-value module (`apps/rally-server/src/modules/settings/`,
  kept separate from `RallyInfo` so future toggles don't need another
  schema change) — when off, heartbeats from gates not already known are
  ignored rather than auto-registered.
- Vehicle status: `VehicleStatus` enum (`REGISTERED`, `CHECKED_IN`,
  `SCRUTINEERED`, `WITHDRAWN`, `DISQUALIFIED`) added to `packages/shared`
  and wired onto `Vehicle.status` (previously an untyped string nobody
  ever set past the default). `PATCH /vehicles/:id` now does a general
  partial update (status, driver/co-driver name, start number,
  transponder — not just status), reusing the same unique-start-number
  conflict handling as `create`. Vehicles page got inline per-field
  editing plus a status `v-select`, and `apps/web` picked up
  `@rally-gate/shared` as a real dependency for the first time (see the
  Vite `optimizeDeps` note in `CLAUDE.md`'s `packages/shared` section —
  hit and fixed the CJS/ESM pre-bundling gotcha while building this).
- Split `apps/web/src/api.ts` (one 324-line file, every entity's types and
  fetch calls flat in one place) into `apps/web/src/api/` — one module per
  entity/topic (`vehicles.ts`, `stages.ts`, `stage-runs.ts`, `gates.ts`,
  `gate-assignments.ts`, `classification.ts`, `rally-info.ts`,
  `settings.ts`, `events.ts`) plus a `client.ts` holding the actual fetch
  wrapper (`apiFetch`/`postJson`/`putJson`/`patchJson`/`postRequest`/
  `deleteRequest`) every topic module calls into — the "centralized service,
  split by topic" shape. Along the way, deduplicated types that were
  hand-redeclared in `api.ts` despite already existing in
  `packages/shared` (`ClassificationEntry` and its siblings — the server's
  own `classification.service.ts` already imported these from `shared`,
  the frontend just wasn't); added `SplitGateInfo` to
  `packages/shared/src/classification.ts` since it was the one classification
  response shape that had never been named anywhere, and typed it on the
  server's `getSplitGates` return too. `Stage.status`/`StageRun.status`/
  `GateAssignment.role`/`GATE_ROLES` now reuse `StageStatus`/
  `StageRunStatus`/`GateRole` from `shared` instead of plain `string`.
  Full entity DTOs (`Stage`, `StageRun`, `Gate`, `GateAssignment`,
  `RallyInfo`) stay defined in their `apps/web/src/api/*.ts` module, not
  promoted to `packages/shared` — the server doesn't formally declare
  response DTOs for these today (controllers just return entities/inferred
  shapes), so a shared type would still drift from the real response
  without also introducing that layer server-side; out of scope here.
  Verified with a full route sweep in a real browser after the split, no
  console errors.

- Gate clock offset measurement + correction: heartbeats carry `sentAt`,
  `Gate.clockOffsetMs` holds the measured `arrivedAt - sentAt`, and
  `EventsService` corrects a detection's effective time at ingest when the
  offset clears `clockCorrectionThresholdMs` (default 1000ms), storing the
  amount applied on `DetectionEventRecord.clockCorrectionMs` and leaving
  `timestampGate` raw. Hardware page shows per-gate offset, amber past 250ms
  and red once corrected. Deadband exists because the one-way measurement
  can't separate clock offset from transit latency — see "Clock offset" in
  `architecture.md`. Verified end-to-end with a gate deliberately skewed 5s
  behind: the run recorded 3000ms (the true elapsed time) where an
  uncorrected server reported 8002ms.

## Next

Priority order (1 = next):

0. **chrony/NTP on gates** — the actual clock sync, versus the offset
   correction above, which is only a monitor plus a gross-failure safety net
   and can't resolve below network latency. Gates run chrony against
   `rally-server`, which serves NTP from its local clock (`local stratum 10`)
   so it works with no internet. Needs `deploy/install-gate-pi.sh` work and a
   server-side NTP service, and can only be validated on real Pi hardware —
   which is why it wasn't bundled with the measurement work.

   **Must be configured to step the clock only at boot and slew thereafter**
   (`makestep` with a small update limit) — a mid-stage step writes a
   discontinuity straight into a `StageRun`. This applies to every gate
   timestamp regardless of which decoder or flags are in use; see "Gate
   system clock policy" in `decoder-adapters.md`.

   Optional follow-on: **GPS/PPS as a chrony refclock per gate**. Not for
   accuracy — LAN chrony already exceeds what tenths-of-a-second margins
   need — but because it removes the network from the timing path entirely,
   which matters if stages get long enough that a gate can't reliably reach
   the broker. Needs a UART/GPIO module, *not* a USB dongle; needs sky view.
   Requires no `rally-server` changes, and the Hardware page's clock column
   becomes its health indicator for free. Full trade-offs in
   `decoder-adapters.md` "Hardware notes".
1. Gate/gate-node health reporting, plus expected stage time: optional
   `Stage.expectedDurationMs` set by the marshal, dashboard flags any
   `STARTED` run as overdue once `now - startTime` exceeds it. Client-side
   only (SSE data already has `startTime`), no new backend push needed.
   Bundled with health reporting since both are "tell the marshal something's
   wrong" signals. Health reporting's actual mechanism is now sketched under
   "Gate control channel" in `architecture.md` — a `stage-started` broadcast
   + per-gate `ready` ack, which also doubles as the clock-sync trigger
   (see `decoder-adapters.md` DS3231 note). Natural fit once the Hardware
   page from the frontend restructuring exists.
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
7. Parc Fermé / time control / service park gate roles and their state transitions. When this lands, checkpoint-to-checkpoint interval/target times should use their own formatter (MM:SS or accumulated minutes) — see the format conventions documented in `packages/ui/src/format.ts`, don't reuse `formatStageDuration`.

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
- Planned/scheduled start times (a start list — "car #12 is due at 09:15:00"
  — as opposed to the actual recorded start `StageRun` already has), the
  `pre_start`/`time_control` gate roles' actual behavior, and penalties
  (time penalties, exclusions). All four came up while scoping
  `frontend-structure.md` and are genuinely undesigned — `pre_start`/
  `time_control` exist only as unused `GateRole` enum values, penalties
  only as a field-list sketch in the original idea doc, and start times
  aren't represented anywhere at all. Explicitly deferred rather than
  missed — revisit if/when they're actually needed, don't let
  `frontend-structure.md`'s Setup page grow a start-list or penalty UI
  speculatively.
- Vehicle classes (4WD, 2WD, Rookie, Stock, ...) with per-class
  classification, alongside the existing overall/stage/split ranking.
  Two constraints noted up front so they're not lost by the time this gets
  designed: classes are **freely defined by the organizer**, not a fixed
  enum like `GateRole` — needs to be data (a `Class` entity/table), not a
  hardcoded list. And a vehicle can belong to **multiple classes at once**
  (e.g. a car is both "4WD" and "Rookie"), so it's a many-to-many
  relationship, not a single `classId` on `Vehicle` — the same
  `StageRun`/vehicle counts toward every class ranking it belongs to
  simultaneously, not exclusively. The global/overall ranking
  (`classification.service.ts`) stays as-is; per-class rankings are
  additional filtered views over the same underlying runs, conceptually
  like the existing split classification but filtered by class membership
  instead of split gate. Touches `Vehicle`, a new join table,
  `ClassificationService`/`ClassificationController`, and the Results
  pages in `apps/web`. Not designed beyond this — no entity shape, no
  routes, no UI decided yet.
