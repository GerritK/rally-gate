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

- Stage re-runs, and voiding as the way one starts. `StageRun` gained an
  `attempt` counter and a `voided` flag; results count the latest surviving
  attempt per vehicle+stage, and a **partial unique index** enforces that at
  most one attempt per (vehicle, stage) is non-voided, so the invariant is the
  database's rather than a service check. `POST /stage-runs/:id/void` strikes
  out an attempt (red flag): the row stays as evidence — a protest turns on
  what was originally timed — but stops counting, and because the vehicle then
  has neither an open nor a finished attempt, **the start gate opens the re-run
  by itself** on the car's next pass. That is the whole point of doing it this
  way rather than typing in a replacement run: both ends of the re-run stay
  gate-timed. `POST /stage-runs/:id/unvoid` reverses it and 409s with
  `{ blockingAttempt }` rather than cascading — discarding a run the car
  actually drove is a call a marshal makes explicitly. A bare post-finish gate
  detection deliberately does **not** start a re-run: the start gate stays live
  for the rest of the field while a finished car is recovered back past it, so
  that would manufacture phantom runs. Full rules in `event-model.md`,
  "Voiding, and how a re-run actually starts".

- Notional times, so the overall classification means something. A sum of
  stage times only compares crews if the totals cover the same stages —
  otherwise retiring from one makes a total *shorter* and ranks a crew higher
  for driving less. A crew missing a CLOSED stage is charged the slowest real
  time on that stage within the ranking being computed, plus
  `notionalPenaltyMs` (a `Settings` key, default 2 min), which guarantees the
  notional is worse than every real time there. `stagesCompleted` is
  display-only, not the ranking key. The `/setup/scoring` route is where a
  marshal sets the penalty. What the guarantee does *not* cover, and the
  reason the penalty wants to scale with stage length, is in `event-model.md`
  "Notional times".

- Failed detections are retried and made visible instead of lost.
  `EventsService` saves the raw detection before running the rules, so a rule
  failure costs the timing but never the evidence; `applyRulesForRecord`
  catches, leaves `processed: false`, and a 30s sweep retries oldest-first.
  `GET /events/pending` (+ `POST /events/pending/retry`) and a dashboard banner
  surface the backlog, pushed over `/live/pending-detections` as the whole list
  rather than a delta, so a reconnecting client is correct on the next change.
  An unknown gate or unregistered transponder is marked processed rather than
  retried forever — retrying changes nothing, and it would bury real problems.

- `rally-server` serves the built dashboard, and every API route moved under
  `/api`. Headless mode had no UI at all before this — nothing built or served
  `apps/web`, and `install-server-pi.sh` printed a URL that returned JSON. The
  prefix is forced by serving both from one origin: `/vehicles` is both a REST
  resource and a dashboard page. Non-`/api` GETs that aren't real files return
  `index.html` so vue-router deep links resolve, registered *before* `listen()`
  because Nest installs its own catch-all 404 while initialising. `API_BASE` is
  relative in a built app, so nothing needs the server's address at build time.
  **Breaking change to every path** — see the DTO/API-contract note in
  `CLAUDE.md`.

- Live streams resync on reconnect, and MQTT ingress is validated. Only the
  pending-detections stream refetched after a dropped connection; the other
  four trusted SSE and went silently stale, which during a stage is missing
  detections on the marshal's main screen. Each stream now refetches through
  `onopen`, which covers both first connect and every automatic reconnect.
  Separately, the broker is unauthenticated and the global `ValidationPipe`
  guards HTTP only, so anything on the rally network could publish an untyped
  detection: an unparseable `timestampGate` became an Invalid Date that poisons
  a duration *silently*, and a missing `eventId` failed the insert and sat in
  the pending list forever. Ids and timestamps are now bounds-checked and bad
  messages dropped with a warning.

- CI (`.github/workflows/ci.yml`), plus a headless-stack job that boots the
  real compose stack against Postgres — the only thing that catches a column
  type valid on sqlite and invalid on Postgres (see `CLAUDE.md`). Headless
  deploy hardened alongside it: Postgres published on `127.0.0.1:5432` only,
  builds pinned, a backup taken before a rebuild.

- Sub-second timestamp precision pinned by `timestamp-precision.spec.ts`,
  against real in-memory sqlite rather than a mock, since the whole risk lives
  in how the driver serialises a `Date`. It separates two runs a tenth of a
  second apart — the margin that actually decides a result — and recomputes
  the duration from the values that come back, because a truncating driver
  would leave `durationMs` correct while the timestamps behind it lost
  precision. (Written after a wrong claim in these docs that sqlite `datetime`
  has second precision: the truncation belongs to `@CreateDateColumn`, not to
  the column type.)

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

- Gate config UI, settings half (`apps/gate-config`, port 57439): a marshal can
  change a gate's identity, server address, decoder and simulator settings from a
  page on the gate itself, and see whether gate-agent is running, what chrony
  reports and the recent log — no SSH, no re-running the installer. The design
  and the reasoning behind each decision are in `docs/gate-config-ui.md`; the
  parts worth knowing without reading it: it is a *separate* service from
  `gate-agent`, because gate-agent restarts forever, so a bad setting becomes a
  crash loop and a UI hosted inside it would die with the thing it exists to
  repair; config moved out of the systemd unit into `/etc/rally-gate/gate.env`
  behind `EnvironmentFile=`, which meant `gate-agent` needed no code change at
  all since it already reads exactly those env vars; and the settable keys are a
  **whitelist**, because that file becomes gate-agent's environment and an
  arbitrary key would let anyone on the rally network set `LD_PRELOAD`.

  Built with Vue + Vuetify through `packages/ui` — its second consumer, which
  `CLAUDE.md` said the shared-component pattern needed. The cost weighed against
  it, a Vite build in the install path, turned out to be build time only:
  `install-gate-pi.sh` already installs every workspace's dependencies on the Pi.

  Verified: 23 unit tests over the config file including every injection case,
  and the API exercised end-to-end against the running service (save, validation
  rejection, the chrony source file's contents, static serving, SPA fallback).
  Also that it degrades — with no `systemctl` or `chronyc` present `/api/status`
  returns 200 with per-probe failures, and a save reports `saved: true` alongside
  the restart failure, so a marshal is never told to re-enter values that are in
  fact stored. **Not** verified: the privileged actions (systemd, chrony,
  sudoers) and how the page renders, there being no headless browser in this
  repo.

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

- Gate config, Wi-Fi + hotspot fallback — the other half of `apps/gate-config`.
  A marshal can now pick a network from the page and join it, and a gate that
  can reach no Wi-Fi raises its own WPA2 access point (`rally-gate-<hostname>`,
  password `HOTSPOT_PASSWORD`, default `rally-gate`, asked for by the installer)
  within a minute, so the config page is reachable in the state it is most
  needed in. `rally-gate-hotspot.timer` runs the watchdog every 30s after a 60s
  boot delay; it covers a gate whose previously working network stops working,
  not only a virgin one.

  The decision worth carrying forward is **not** granting `nmcli` through
  sudoers. A wildcard rule there is effectively a root shell on an
  unauthenticated service — `nmcli connection import type openvpn file …` runs
  that file's up-script as root, and short of that, control of routing and DNS
  on a gate is a man-in-the-middle on the timing path. Polkit is no narrower in
  capability, only in mechanism. So `deploy/rally-gate-net` is installed as a
  wrapper in which every `nmcli` argument is a literal except the SSID and
  password, and the hotspot password is read by the wrapper from `gate.env`
  rather than passed in, so the grant cannot raise an AP on a password only the
  caller knows. Full reasoning in `docs/gate-config-ui.md`, "Wi-Fi goes through
  a wrapper".

  Verified on a developer machine: 63 unit tests over the config file and the
  `nmcli` parsing/validation; the three new endpoints end to end, including that
  they report a missing wrapper rather than throwing; and every branch of
  `rally-gate-net` against a stub `nmcli` on `PATH`, argument vectors included.
  **Not verified, and only a Pi can:** whether hotspot and station mode coexist
  on one radio, whether the hotspot is reachable at `<hostname>.local:57439`,
  and whether the 60s boot delay suits a slow access point. See "Next".

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

1. **Verify Wi-Fi and the hotspot fallback on a Pi.** The code is written (see
   Done); what no developer machine can answer is on the list at the end of
   `docs/gate-config-ui.md`. In order: does `rally-gate-net hotspot` raise an AP
   at all on this Pi model, is `http://<hostname>.local:57439` reachable over
   it, does `join` from the page get the gate onto a real network, does the
   watchdog bring the hotspot back within a minute after a deliberately wrong
   password, and is `OnBootSec=60s` long enough on a slow access point. If
   station and hotspot mode turn out not to coexist on one radio, the fallout is
   in the "known ceiling" paragraph of that doc, not in the code.

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
