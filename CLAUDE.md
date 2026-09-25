# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Rally Gate: open, modular timing/event management system for RC rally events. Full background: [ideas/RC_Rally_Timing_Project_Documentation.md](ideas/RC_Rally_Timing_Project_Documentation.md). Implementation-specific design notes live in `docs/` — read the relevant one before touching that area, since a lot of "why" lives there rather than in code comments:

- `docs/architecture.md` — event pipeline, gate control channel, gate discovery/assignment design
- `docs/event-model.md` — `DetectionEvent`/`StageRun`/`StageSplit` shapes and rules
- `docs/decoder-adapters.md` — `DecoderAdapter` interface, planned adapters, hardware notes
- `docs/deployment-modes.md` — standalone vs headless, one-database-per-event model
- `docs/api.md` — REST/SSE endpoint summary
- `docs/frontend-structure.md` — multi-page structure of `apps/web` (routes, nav, `RallyInfo` backend piece) — built, read before changing routes/nav
- `docs/gate-config-ui.md` — the on-gate config service (`apps/gate-config`, port 57439); built, including Wi-Fi + the hotspot fallback — read the "Wi-Fi goes through a wrapper" section before touching anything that shells out to `nmcli`
- `docs/development-roadmap.md` — what's done, what's next, what's deliberately deferred (check this before starting new work)

## Commands

npm workspaces monorepo (`apps/*`, `packages/*`). Always build `shared` first — the other three depend on its compiled output, not its source.

```bash
npm install
npm run build:shared        # required before anything else after a shared/ change
npm run build                # build all workspaces
```

Dev loop (four terminals, no hardware needed):
```bash
npm run dev:server           # rally-server on :57430, embedded MQTT on :57431
npm run seed-demo-data       # seeds a stage + gate assignments + one vehicle via the REST API
npm run simulate -- --gate START_WP1 --transponder 1234567   # one-off simulated detection
npm run dev:gate-agent       # continuous simulated detections instead of one-off
npm run dev:web              # Vue dashboard (Vite)
npm run dev:gate-config      # on-gate config service on :57439 (API only)
npm run dev:gate-config-web  # its Vue page on :57449, proxying /api to 57439
```

`gate-config` shells out to systemd, chrony and journalctl, none of which exist off a Pi. Those calls all live in `apps/gate-config/src/system.ts` and report failures rather than throwing, so the service still runs and the page still loads on a dev machine — every status row just reads as unavailable. Point `GATE_CONFIG_FILE` and `CHRONY_SOURCE_DIR` at a scratch directory so it doesn't need `/etc`.

`apps/rally-server` (run from that directory):
```bash
npm run lint                 # eslint --fix, includes prettier/prettier rule — run before finishing any server change
npm run lint:check           # same rules, no --fix (what CI runs; --fix in CI would repair the tree and report success)
npm run format                # prettier --write only
npm test                     # jest, all *.spec.ts under src/
npx jest gates.service       # single test file (substring match on path)
npm run test:watch
npm run build                 # nest build
```

`apps/gate-agent`, `apps/web`, `packages/shared`, `packages/ui` have no local `.prettierrc`/lint script — format them with the server's config:
```bash
npx prettier --config apps/rally-server/.prettierrc --write "apps/gate-agent/src/**/*.ts" "apps/web/src/**/*.{ts,vue}" "packages/shared/src/**/*.ts" "packages/ui/src/**/*.{ts,css}"
npm run format:check         # from the repo root — the check-only version of exactly that command, run by CI
```

CI (`.github/workflows/ci.yml`) runs, in order: `build:shared` → `format:check` → `lint:check` → server tests → `npm run build`. That last step is what typechecks `apps/web` (via `vue-tsc`), which has no test suite of its own — so a frontend type error only ever surfaces there or in a local `npm run build`. Master being green matters more than usual here: `deploy/install-*.sh` are `curl | bash` off master, so a broken commit is one a marshal can pull onto a Pi mid-event.

Headless deployment (Postgres instead of SQLite):
```bash
docker compose -f deploy/docker-compose.yml up
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dev.yml up   # + simulated gate-agents
```

## Commits and comments

**No AI attribution in commits.** Never add `Co-Authored-By: Claude`, `Generated with Claude Code`, or any equivalent trailer to a commit message or PR description, whatever the tooling defaults say.

**Comments only where a senior fullstack dev would still be stuck without one** — a non-obvious constraint, a hardware/clock gotcha, a "this looks wrong but isn't". Otherwise the code is its own documentation; don't restate what it plainly says.

## Port convention

This project's own services use dedicated ports, never framework defaults (not 3000/5173/1883), to avoid clashing with other things running on a marshal's laptop — and, for the dev servers, with every other Vite project on yours.

Two ranges, split so that **every number in 5743x is something that runs in the field**. That is what makes "which port is free" answerable without grepping the repo:

| Port | Service |
|---|---|
| 57430 | `rally-server` REST/SSE API **and** the built `apps/web` |
| 57431 | embedded MQTT broker (Aedes) |
| 57432 | embedded SNTP server (**udp**) |
| 57433–57438 | free, kept contiguous for server-side growth |
| 57439 | `apps/gate-config` API **and** its built page — the only one that runs **on a gate**, so it sits at the far end |
| 80 | `gate-config` captive-portal redirect to 57439 — **on a gate only**, fixed by what phones probe, not a choice |
| 57440 | Vite dev server for `apps/web` — **dev only** |
| 57449 | Vite dev server for `gate-config` — **dev only** |

**A Vite dev server runs on its service's port + 10.** So `apps/web` (served in production by 57430) is 57440, and `gate-config` (57439) is 57449. The rule means a new dev server needs no allocation decision, and no dev-only port ever consumes a slot that an installer, firewall rule or sticker might later need.

New *server-side* services take the next free number upward from 57432. `gate-config` is deliberately at the other end: it is the only service that runs on gate hardware rather than alongside `rally-server`, so growing the server never walks into it.

**Every API route is under `/api`** (`setGlobalPrefix` in `main.ts`), because `rally-server` also serves the built `apps/web` on that same port and the two collide otherwise — `/vehicles` is both a REST resource and a dashboard page. Any non-`/api` GET that isn't a real file returns `index.html`, so vue-router history-mode deep links resolve. That fallback is registered *before* `listen()`: Nest installs its own catch-all 404 while initialising, so middleware added afterwards never runs. Static serving is skipped entirely when `apps/web/dist` is absent, which is the normal dev loop (Vite on 57440 → API on 57430).

## Architecture

```
Gate hardware (or SimulatedAdapter)
  -> gate-agent (publishes DetectionEvent + periodic heartbeat over MQTT)
  -> embedded Aedes broker inside rally-server (in-process, no separate Mosquitto/NATS)
  -> EventsService (stores DetectionEventRecord, looks up gate + vehicle)
  -> rule engine (active GateAssignment.role -> start/finish/split a StageRun)
  -> EventEmitter2 internal bus ("detection.created", "stage-run.updated", "stage-run.split")
  -> LiveController (SSE: /live/detections, /live/stage-runs, /live/stage-run-splits) -> Vue dashboard
```

**Everything server-side is event-driven through `EventEmitter2`, not direct method chains.** `EventsService` never calls the live feed or rule engine directly — it emits and `LiveController`/listeners react. Follow this shape for new cross-cutting behavior (e.g. a future "stage started" trigger should be an emitted event with independent listeners, not a service calling into three other services inline) — see the "Event-based, not a hard-coded call chain" note in `architecture.md`.

**Gates are dumb.** A `gate-agent` only knows its own `GATE_ID`; it publishes to `rally/gates/<gateId>/detections` and `rally/gates/<gateId>/heartbeat`. All meaning is assigned centrally on the server — a gate never has hardcoded behavior.

**`Gate` vs `GateAssignment` — identity vs. plan.** `Gate` (`apps/rally-server/src/modules/gates/gate.entity.ts`) is pure hardware identity: `id`, `name`, `lastHeartbeatAt`, `capabilities`. It auto-creates from the first heartbeat a gate sends — no pre-configuration needed. `GateAssignment` is the (gate, stage, role, splitIndex, active) plan: a gate can be assigned to many stages with different roles ahead of an event, but exactly one assignment per gate is `active` at a time, and `EventsService.applyRules` looks up the *active* assignment to decide what a detection means. This split exists so reassigning a gate across stages never corrupts history (`StageRun`/`StageSplit` snapshot `stageId` at creation, they don't live-join back to `Gate`).

**One database = one event.** No `Event` entity — `DB_PATH` (SQLite) / `DB_NAME` (Postgres) in `apps/rally-server/src/config/database.config.ts` is the event boundary. Save/load/transfer an event is just copying the SQLite file (or `pg_dump`/restore). Don't add a multi-tenant `Event` table; it's intentionally not needed.

**Deployment is a config switch, not a code fork.** `DB_TYPE=sqlite` (default, standalone/laptop mode, packaged exe eventually) vs `DB_TYPE=postgres` (headless/server mode via `deploy/docker-compose.yml`) — same codebase, `apps/rally-server/src/config/database.config.ts` picks the driver. `synchronize: true` on both, so entity changes apply automatically — no manual migrations.

**TypeORM entity gotcha: `undefined` vs `null` on nullable columns.** `Repository.save()` on a loaded entity skips properties equal to `undefined` (leaves that DB column untouched) but writes `null` properties as SQL NULL — so "clear this column" must assign `null`, never `undefined`. Type nullable columns as `T | null` (not just `T | undefined`/optional) to make that the only option. Separately, `@Column()` without an explicit `type:` infers the SQL type via reflect-metadata, which collapses **any explicitly-written union** — `number | null`, `Date | null`, `string | null`, all of them, strings included — to generic `Object`; better-sqlite3 then rejects it at startup (`DataTypeNotSupportedError`). The *only* thing that's exempt is a bare optional property with no written union, e.g. `foo?: string` (TS emits plain `String` metadata for that one case since `?` alone isn't a union). So: every nullable column needs an explicit `type:` (e.g. `{ type: 'int', nullable: true }`, `{ type: 'varchar', nullable: true }`) the moment its TS type becomes `T | null` — there is no free pass for `string | null` or `Date | null`. See `stage-run.entity.ts`'s `finishTime`/`durationMs` and `vehicle.entity.ts`'s `coDriverName`/`transponderId` for the pattern. This exact bug has shipped silently twice: once with `StageRun.finishTime` (`PATCH /stage-runs/:id` looked like it worked — the response echoed the request — but never persisted), and again with `Vehicle.coDriverName`/`transponderId` when they were widened from `?: string` to `?: string | null` without adding `type: 'varchar'` (crashed `rally-server` at startup instead of silently failing, since the whole entity failed metadata validation — a louder but still avoidable failure).

**…and the explicit `type:` must be valid in *both* drivers.** The rule above only says "give it an explicit `type:`" — that's half the check. `DB_TYPE=sqlite` and `DB_TYPE=postgres` are the same entities against two drivers with **disjoint** `supportedDataTypes`, and TypeORM validates them at `DataSource.initialize()` (`EntityMetadataValidator`) with `DataTypeNotSupportedError`. Two traps in particular:
- `'datetime'` is **sqlite-only** — Postgres has no `datetime` and `PostgresDriver.normalizeType` doesn't map it, so it falls through unmapped and fails validation. `'timestamp'` is the mirror image: Postgres-only, absent from the sqlite driver's list.
- The portable spelling for a timestamp is the **`Date` constructor**, not a string: `@Column({ type: Date })` normalizes to `datetime` on sqlite and `timestamp without time zone` on Postgres. It's explicit, so it also sidesteps the reflect-metadata union collapse above. Use `{ type: Date, nullable: true }` for `Date | null`.

The reason this hides: `DataSource.initialize()` calls `driver.connect()` **before** `buildMetadatas()`, so a Postgres-invalid type can't fail until Postgres is actually reachable — i.e. never in the default SQLite dev loop, and inside Docker it surfaces as a `restart: unless-stopped` crash-loop rather than an obvious error. Two things guard it now, and neither is `npm test`: `src/config/entity-column-types.spec.ts` checks every column against **both** drivers' `supportedDataTypes` with no database running, and CI's `headless-stack` job boots the real compose stack against Postgres. **After changing any entity column type, run `docker compose -f deploy/docker-compose.yml up` locally too if you have Docker — `npm run dev:server` alone cannot catch this class of bug.**

**Timing correctness beats everything, and gate timestamps are two different clocks.** `StageRun.durationMs` is `finishGate.timestampGate - startGate.timestampGate` — subtracting clocks from two physically separate Pis (`events.service.ts` `applyRules`). Consequences to respect in any new timing code:
- **A duration must never be negative or zero.** Classification sorts `durationMs` ascending (`classification.service.ts` `rank`), so a skewed clock or a mistyped correction doesn't error — it silently *wins the rally*. Any code path that computes or accepts a duration (`finishRun`, `correctRun`, `createManual`, future checkpoint/penalty math) validates `finish > start` first.
- **Gate clock offset is measured and partially corrected — know which half you're touching.** Heartbeats carry `sentAt`; `GatesService.recordHeartbeat` stores `arrivedAt - sentAt` as `Gate.clockOffsetMs`, and `clockCorrectionMsFor` applies it to detections only past a threshold, because a one-way measurement can't separate clock offset from network latency. Correction happens server-side at ingest, `timestampGate` stays raw, and the amount applied is stored per detection as `clockCorrectionMs` — effective time is always `timestampGate + clockCorrectionMs`. Never "simplify" that into overwriting `timestampGate`; the pair is what makes a result recomputable. Full rationale in `architecture.md` "Clock offset".
- Clock *sync* (DS3231, chrony, the planned `stage-started` sync message) reduces drift but never guarantees two gates agree — don't treat an RTC as making the checks above unnecessary. Equally, the offset correction is a safety net for gross failures, not a substitute for real NTP sync: it can't resolve below network latency, which is above a winning margin.

**Requests are untrusted; `@Body()` types are erased at runtime.** `@Body() stage: Stage` is a compile-time fiction — a TS type or interface validates nothing. A global `ValidationPipe` (`main.ts`) with `whitelist: true, forbidNonWhitelisted: true, transform: true` is what actually enforces the shape, and it only does so when the body's type is a **decorated DTO class**. A `@Body()` typed as an interface or a mapped type (`Partial<X>`, `Omit<X, 'id'>`) compiles to `Object` metadata, which the pipe skips entirely — such an endpoint silently has no validation at all. So every mutating endpoint binds a class from its module's `dto.ts`, never an entity and never an inline type literal.

What the DTOs deliberately leave out matters as much as what they declare — a field absent from the DTO cannot be set by any client:
- `Stage.status` — owned by `StagesService.activate`/`close`, which keep it in step with `GateAssignment.active`. Settable via a create/update body, it would flip a stage ACTIVE without activating its gates (or CLOSED without deactivating them), desynchronising the exact split `architecture.md` "Gate assignment: plan vs. live" exists to maintain.
- `GateAssignment.active` — activation is per-stage, never per-assignment; accepting it would skip the cross-stage gate-conflict check.
- `Vehicle.id` — `VehiclesService.update` merges with `Object.assign`, so an id in the body retargets the save at another row.
- `Gate.lastHeartbeatAt`/`capabilities` — gate-reported, stamped only by `recordHeartbeat`; writable, they'd make an offline gate read as online.
- `RallyInfo.id` — singleton pinned to `RALLY_INFO_ID`.

`forbidNonWhitelisted` means an unknown property is a 400, not a silent strip — so **a server-side DTO change is a breaking API change**: `apps/web` and `scripts/seed-demo-data.js` have to drop the field in the same commit. `src/config/dto-contracts.spec.ts` pins the list above by running the real pipe config over each DTO; add a case there when a new server-owned field appears rather than relying on review to catch it.

**Detections are lossy by default, and a dropped one is a driver with no time.** `@OnEvent` handlers swallow exceptions (`@nestjs/event-emitter` defaults `suppressErrors: true`), so anything that throws inside an event handler is a log line and nothing else — never rely on an exception propagating out of one. Two mechanisms exist because of this, and new pipeline code has to keep both working:
- **Delivery**: `gate-agent` publishes detections at QoS 1 over a persistent session (`clientId`/`clean: false` in `apps/gate-agent/src/main.ts`) so a reconnect replays in-flight messages. That makes delivery at-least-once, which is only safe because the rule engine ignores repeats (`startRun`/`finishRun`/`recordSplit` in `stage-runs.service.ts`) and `DetectionEventRecord` is keyed on the gate-generated `eventId`. **Keep new pipeline code idempotent.**
- **Processing**: `EventsService` saves the raw detection *before* running the rules, so a rule failure costs the timing but never the evidence. `applyRulesForRecord` catches, leaves `processed: false`, and a 30s sweep (`reprocessPending`) retries oldest-first; `GET /events/pending` and a dashboard banner make the backlog visible. Retries replay with the `clockCorrectionMs` stored on the record, not a freshly measured one — the gate's offset may have moved since. An unknown gate or unregistered transponder is **not** a failure (nothing to apply, retrying changes nothing) and is marked processed so the pending list stays real problems only.

**`DecoderAdapter` isolates hardware from the pipeline.** `apps/gate-agent/src/adapters/decoder-adapter.ts` defines `start()`/`stop()`; only `SimulatedAdapter` exists today. Everything past `gate-agent` only ever sees the resulting `DetectionEvent` over MQTT, so adding real hardware (`OpenStintAdapter`, planned) never touches `rally-server`.

**`packages/shared`** holds types used by all three apps (gate roles, `DetectionEvent` shape, MQTT topic helpers, stage/classification/vehicle-status types) — build it first after any change (`npm run build:shared`), since the other workspaces import its compiled output, not its TS source. It ships CommonJS (`tsc`, default module target) — fine for `rally-server`/`gate-agent` (plain Node), but `apps/web` (Vite/browser) needs it listed in `optimizeDeps.include` in `apps/web/vite.config.ts`, or Vite skips pre-bundling this symlinked workspace package and loads the raw CJS file as native ESM, where named imports silently fail (`exports.Foo` isn't visible as `import { Foo }`). If you add a new named export and `apps/web` throws `SyntaxError: ... does not provide an export named 'X'` after `npm run build:shared`, that's Vite's dependency-optimizer cache being stale, not a real missing export — stop the dev server, delete `apps/web/node_modules/.vite`, and restart.

**`packages/ui`** is the shared Vuetify design system for every rally-gate *web* interface — `apps/web` today, the planned gate config UI (see `development-roadmap.md`) later — so they read as one product instead of each picking its own theme. `theme.ts` defines the (dark-first, rally/motorsport-branded) `rallyGateDark` theme and its usage conventions — orange stays rare (one primary action per screen), red is reserved for penalties/DNF/abort, timing colors need a second non-color signal for colorblind users; `vuetify.ts`'s `createRallyVuetify()` wires that theme plus shared component defaults and is what every app calls once at startup. Adjust the theme/defaults there, not per-app. `fonts.ts` self-hosts Barlow/Barlow Condensed/JetBrains Mono via `@fontsource/*` (never Google Fonts CDN — these apps run on closed/absent rally-site WiFi) and feeds Vuetify's `$body-font-family`/`$heading-font-family` through the theme's `variables` (`font-body`/`font-heading` → Vuetify's own `--v-font-body`/`--v-font-heading` CSS vars), no SASS override file needed. `utilities.css` has a `.rg-timing` class (tabular-nums JetBrains Mono, slashed zero), applied to every timing value in `apps/web`, plus a rule hiding the native `<input type="time">` clock icon so it can be replaced with a matching MDI one — pair with `openTimePicker` (`datetime.ts`) on `@click:append-inner`. Time corrections are deliberately time-only, no date field: `combineDateAndTime()` (in `apps/web/src/format.ts`, alongside `runStatusColor()`/`outcomeColor()`) always sources the date from context (the run's existing date, or today), since a marshal correcting a missed detection is fixing seconds, not the date — Vuetify's `VTimePicker` was considered and rejected for this because it has no seconds precision (hours/minutes only). Icons are MDI (`@mdi/font`, also self-hosted). `apps/web` is fully Vuetify (`v-card`/`v-table`/`v-select`/`v-text-field`/`v-btn`/`v-chip`) — no raw `<table>`/`<select>`/`<button>` — with status values as `v-chip`s; `App.vue` is now just the nav shell, the markup lives in `src/pages/*.vue` (see `frontend-structure.md`). Unlike `packages/shared`, it has **no build step** — it ships plain `.ts`/`.css` source (`main`/`types` point at `src/index.ts`) and relies on the consuming app's own Vite/`@vitejs/plugin-vue` to process it, since Vite (unlike Node) can compile TS/Vue source directly. `apps/gate-config` is now that second consumer, so a shared `.vue` component is no longer premature — but none has been added yet, and the reason to be careful still stands: Vite's dev-time dependency pre-bundler can choke on `.vue` files pulled in from a workspace package and may need `optimizeDeps.exclude` in the consuming app's `vite.config.ts` at that point.

**Rule engine is intentionally simple and hardcoded**, not a YAML DSL — `EventsService.applyRules` directly branches on `GateRole`. One active `StageRun` per vehicle+stage; duplicate starts/out-of-order finishes/splits are logged and ignored rather than erroring (`stage-runs.service.ts`).

## Field deployment scripts

`deploy/install-server-pi.sh` and `deploy/install-gate-pi.sh` are one-shot `curl | bash` installers for real Raspberry Pi hardware (not run from this dev repo/working directory). They hardcode assumptions about the codebase that don't get checked by any build or test — update them by hand whenever the corresponding thing changes:

- `install-server-pi.sh`: assumes `deploy/docker-compose.yml` exists and `docker compose up -d --build` works; prints port `57430`. That compose file runs rally-server on `network_mode: host` so its mDNS advertisement reaches the LAN at all (a bridged container can't multicast) — so it publishes no ports, reaches Postgres over `127.0.0.1`, and Postgres is published on `127.0.0.1:5432` where **the address prefix is the entire protection**. Don't "tidy" that into `5432:5432`, and don't move rally-server back to bridge networking without re-checking discovery.
- `install-gate-pi.sh`: assumes npm workspace names `@rally-gate/shared`/`@rally-gate/gate-agent` (must match their `package.json` `name` fields), a Node 22.x install, build output at `apps/gate-agent/dist/main.js`, and env vars `GATE_ID`/`MQTT_HOST`/`MQTT_PORT` (must match what `apps/gate-agent/src/main.ts` reads, default port `57431`).
- `install-gate-pi.sh` defaults `MQTT_HOST` to `rally-server.local`, the mDNS name `DiscoveryService` advertises — so it asks for no address at all, and the name is what both `gate-agent` and chrony resolve. That depends on `avahi-daemon`/`libnss-mdns` on the gate (installed explicitly) and on the server not being in a bridged container, which is why headless/Docker still needs a typed IP. An explicit `MQTT_HOST` always wins.
- Both configure chrony by dropping a file in `/etc/chrony/conf.d/`, which assumes Debian's `chrony.conf` includes that directory (`confdir`) and that its `makestep 1 3` default is left in place — that default is the gate clock policy in `docs/decoder-adapters.md`, so don't "consolidate" these into a full `chrony.conf`. Gates use `MQTT_HOST` as their NTP reference too, so it needs 123/udp reachable as well as `57431` — which today silently assumes a Pi `rally-server`, since a standalone one serves no time. **Don't fix that by adding an install prompt:** a gate must be installable without knowing anything about the rally it will be used at (see "Zero-config gates" in `docs/development-roadmap.md`) — the fix is `rally-server` serving time itself plus mDNS discovery. Timing sync is the one thing here with no automated check at all: `npm test` can't see it and CI can't boot a second host.
