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

- Host networking for the headless stack, so mDNS discovery works there too: a
  bridged container can neither send nor receive LAN multicast, so
  `DiscoveryService` was advertising into the Docker bridge where no gate could
  ever see it. `deploy/docker-compose.yml` puts rally-server on
  `network_mode: host` (so it publishes no ports — it already listens on
  57430/57431/57433 directly) and reaches Postgres over `127.0.0.1` instead of by
  service name, with Postgres published on `127.0.0.1:5432` only. **The address
  prefix is the entire protection there** — a bare `5432:5432` would put the
  event database on the rally WiFi, which is what publishing nothing at all used
  to avoid.

  `docker-compose.dev.yml` needed it too: its simulated gate-agents pointed at
  `MQTT_HOST: rally-server`, a compose service name that stops resolving once
  rally-server leaves the bridge — they would have gone silent with no error
  anywhere. They use `host.docker.internal:host-gateway` now.

  Verified against a real stack (Rancher Desktop, Docker 29.5.3): rally-server
  reaches Postgres over loopback with no restart loop, all 9 tables synchronize
  against the actual Postgres driver, the API answers from the host network and
  lists both gates, the NTP server answers from another host-network process, and
  the dev overlay's gate-agents connect through the gateway and deliver
  detections end-to-end (18 stored from 2 gates, clock offset 1ms). The
  advertisement itself was checked both ways: found when browsing from the host
  network, *not* found from a bridge container — the failure this change fixes,
  demonstrated as the control.

  Caveat: on Docker Desktop/Rancher Desktop "host" is the WSL VM, not the
  Windows LAN, so what is proven is that the advertisement reaches the host
  network rather than a bridge. That it reaches gates on a physical rally LAN
  still needs a Pi.

- Server discovery over mDNS (`apps/rally-server/src/modules/discovery/`):
  rally-server advertises `_rally-gate._tcp` as **`rally-server.local`**, and
  `deploy/install-gate-pi.sh` defaults `MQTT_HOST` to that name — so a gate
  install no longer asks for an address at all. The gate side is deliberately
  codeless: gates resolve the advertised *name* through `getaddrinfo` (gate-agent
  for MQTT, chrony for time) rather than browsing for a service, so one
  advertisement covers both with nothing to debug in the field. `gate-agent`
  gained no dependency and no new code. The installer also installs
  `avahi-daemon`/`libnss-mdns` explicitly and verifies with `getent hosts`, since
  the whole path fails silently without nss-mdns behind `getaddrinfo`. Full
  design and limits in `architecture.md` "Server discovery".

  Verified end-to-end against a running server: the name resolves, MQTT connects
  over it, and the NTP server answers over it — over **both** IPv4 and IPv6.
  That last part was a real bug found by testing rather than reading: the name
  resolved to a global IPv6 address here while `NtpService` bound `udp4` only,
  which would have left such a gate with no time source and no error anywhere.
  The socket is now dual-stack, matching the broker, which already bound `::`.

- rally-server serves time itself (`apps/rally-server/src/modules/ntp/`): an
  embedded SNTP server, same reasoning as the embedded Aedes broker — a gate
  must never have to know what kind of machine the server runs on, so a
  standalone laptop and a Pi look identical from the gate's side and neither
  needs a host time service. Listens on **57433/udp** rather than 123, since
  123 needs root/admin a double-clicked standalone executable won't have;
  gates reach it via chrony's `port` option on the source line. Stratum 10 and
  refid `LOCL`, deliberately poor so a gate that can see a real upstream
  prefers it. Only mode 3 (client) packets are answered — mode 6/7 are ntpd's
  control protocols and the classic reflection amplifier — and a reply is the
  same 48 bytes as the request, so it can't amplify. A bind failure logs and
  continues rather than aborting startup like the broker's does: a gate with no
  time source still delivers detections, and the heartbeat offset measurement
  makes the skew visible, whereas refusing to start would take timing down
  entirely to protect it.

  This deleted the host-chrony block from `install-server-pi.sh` and the
  gate-serves-NTP stopgap from `install-gate-pi.sh` — both existed only to work
  around the server not serving time. `deploy/docker-compose.yml` publishes
  `57433:57433/udp`; the `/udp` suffix is load-bearing, since compose defaults
  to TCP and would leave headless gates with no time source, visible only as
  drift.

  Verified against a running server with a real client packet: mode 4 reply,
  stratum 10, origin timestamp echoed byte-for-byte, offset and round-trip both
  sane on loopback; a mode 6 packet gets no reply. `ntp.service.spec.ts` covers
  the timestamp arithmetic, including one test that runs NTP's own offset
  formula over a full exchange with a known 5s client skew — the rest can pass
  with a wrong epoch constant and still leave every gate silently wrong.

- chrony/NTP on gates — the actual clock sync, as opposed to the offset
  measurement above, which is only a monitor plus a gross-failure safety net.
  Gates point chrony at `$MQTT_HOST`
  (`/etc/chrony/conf.d/rally-gate.conf`, written by
  `deploy/install-gate-pi.sh`: `server $MQTT_HOST iburst prefer minpoll 4
  maxpoll 6` — `prefer` because gates agreeing with *each other* matters more
  than any of them being absolutely right, so it has to win even where the
  site has internet). The server Pi serves NTP from its own clock
  (`/etc/chrony/conf.d/rally-server.conf`, written by
  `deploy/install-server-pi.sh`: `local stratum 10` plus RFC1918 `allow`
  ranges) so it works with no internet, and a real upstream still wins when
  one is reachable. chrony runs on the host there, not in compose — an NTP
  server needs the host clock and port 123/udp.

  Both scripts drop a `conf.d` file instead of replacing `chrony.conf`,
  which keeps Debian's default `makestep 1 3` — step only on the first few
  updates, slew forever after — that default *being* the "Gate system clock
  policy" in `decoder-adapters.md`. Cheaper than restating it, but it means a
  future chrony changing that default would break the policy silently, so
  check there first if a mid-stage discontinuity ever shows up. Both also
  disable `systemd-timesyncd` explicitly (apt's `Conflicts:` usually handles
  it) since two daemons steering one clock is that same step waiting to
  happen. With a DS3231 present, chrony's default `rtcsync` writes the
  corrected time back to it, so chrony sets the clock and the RTC holds it
  across a reboot with no network.

  Fixed along the way: neither script ran `apt-get update`, so `i2c-tools`
  (and `nodejs` when nodesource was skipped) could fail to install on a fresh
  Pi OS image with empty apt lists.

  **Not yet verified on hardware** — `chronyc sources` on a gate (the
  installer prints it), `chronyc clients` on the server, and `Gate.clockOffsetMs`
  on the Hardware page as the ongoing check: it should sit near zero and never
  reach the 1000ms correction threshold once this is working.

## Next

**Zero-config gates (overriding requirement, not a single item).** Installing a
gate must not require knowing anything about the rally it will be used at — not
an IP, and not whether rally-server runs on a laptop or a Pi. One installed gate
should work in any rally-gate environment it is plugged into, and be configured
from the gate config UI rather than by re-running the installer. Everything
below is ordered by that: items 1-2 are what it decomposes into, and any new
gate-side work should be checked against it rather than adding another install
prompt. Both original violations are fixed (see Done): the time reference no
longer assumes a Pi server, and the address is no longer typed in — a gate
install now asks only for things about the gate itself. What is left is making
reconfiguration off the install script and into the gate's own UI (item 1).

Priority order (1 = next):

1. **Gate config web interface** (bigger item, own service): local HTTP server
   on the gate Pi to set `GATE_ID`, Wi-Fi/network, and MQTT host without
   re-running the install script over SSH. Needs an **AP/hotspot mode**
   fallback (hostapd + dnsmasq, or a lib like balena's wifi-connect) so a
   marshal can reach it before the Pi has any network configured — Pi boots as
   its own AP when no known Wi-Fi is set, serves the config page, switches to
   station mode once Wi-Fi is saved. Also falls back to AP mode if it *has* a
   saved Wi-Fi that fails to connect (wrong password, gate out of range,
   router changed) — not just on first boot with nothing configured. Not
   designed yet.

Then, unchanged in relative order:

2. **GPS/PPS as a chrony refclock per gate** (optional, per gate). Not for
   accuracy — LAN chrony already exceeds what tenths-of-a-second margins
   need — but because it removes the network from the timing path entirely,
   which matters if stages get long enough that a gate can't reliably reach
   the broker. Needs a UART/GPIO module, *not* a USB dongle; needs sky view.
   Requires no `rally-server` changes, and the Hardware page's clock column
   becomes its health indicator for free. Full trade-offs in
   `decoder-adapters.md` "Hardware notes".
3. Gate/gate-node health reporting, plus expected stage time: optional
   `Stage.expectedDurationMs` set by the marshal, dashboard flags any
   `STARTED` run as overdue once `now - startTime` exceeds it. Client-side
   only (SSE data already has `startTime`), no new backend push needed.
   Bundled with health reporting since both are "tell the marshal something's
   wrong" signals. Health reporting's actual mechanism is now sketched under
   "Gate control channel" in `architecture.md` — a `stage-started` broadcast
   + per-gate `ready` ack, which also doubles as the clock-sync trigger
   (see `decoder-adapters.md` DS3231 note). Natural fit once the Hardware
   page from the frontend restructuring exists.
4. Standalone packaging (`apps/rally-server/packaging/standalone`, Node SEA/pkg + optional tray icon) — needed to hand `rally-server` to a marshal without a dev machine.
5. Real `OpenStintAdapter` once the RF hardware validation (two ordered gates) confirms reliable reads — critical path, but gated on external hardware validation so it runs in parallel with the above rather than blocking them.
6. Parc Fermé / time control / service park gate roles and their state transitions. When this lands, checkpoint-to-checkpoint interval/target times should use their own formatter (MM:SS or accumulated minutes) — see the format conventions documented in `packages/ui/src/format.ts`, don't reuse `formatStageDuration`.

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
