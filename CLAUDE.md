# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Rally Gate: open, modular timing/event management system for RC rally events. Full background: [ideas/RC_Rally_Timing_Project_Documentation.md](ideas/RC_Rally_Timing_Project_Documentation.md). Implementation-specific design notes live in `docs/` — read the relevant one before touching that area, since a lot of "why" lives there rather than in code comments:

- `docs/architecture.md` — event pipeline, gate control channel, gate discovery/assignment design
- `docs/event-model.md` — `DetectionEvent`/`StageRun`/`StageSplit` shapes and rules
- `docs/decoder-adapters.md` — `DecoderAdapter` interface, planned adapters, hardware notes
- `docs/deployment-modes.md` — standalone vs headless, one-database-per-event model
- `docs/api.md` — REST/SSE endpoint summary
- `docs/frontend-structure.md` — planned multi-page restructuring of `apps/web` (routes, nav, new RallyInfo backend piece) — not built yet, read before starting on it
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
```

`apps/rally-server` (run from that directory):
```bash
npm run lint                 # eslint --fix, includes prettier/prettier rule — run before finishing any server change
npm run format                # prettier --write only
npm test                     # jest, all *.spec.ts under src/
npx jest gates.service       # single test file (substring match on path)
npm run test:watch
npm run build                 # nest build
```

`apps/gate-agent`, `apps/web`, `packages/shared`, `packages/ui` have no local `.prettierrc`/lint script — format them with the server's config:
```bash
npx prettier --config apps/rally-server/.prettierrc --write "apps/gate-agent/src/**/*.ts" "apps/web/src/**/*.{ts,vue}" "packages/shared/src/**/*.ts" "packages/ui/src/**/*.{ts,css}"
```

Headless deployment (Postgres instead of SQLite):
```bash
docker compose -f deploy/docker-compose.yml up
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dev.yml up   # + simulated gate-agents
```

## Port convention

This project's own services use dedicated ports **57430–57439**, never framework defaults (not 3000/5173/1883), to avoid clashing with other things running on a marshal's laptop. `rally-server` REST/SSE API is 57430, the embedded MQTT broker is 57431.

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

**TypeORM entity gotcha: `undefined` vs `null` on nullable columns.** `Repository.save()` on a loaded entity skips properties equal to `undefined` (leaves that DB column untouched) but writes `null` properties as SQL NULL — so "clear this column" must assign `null`, never `undefined`. Type nullable columns as `T | null` (not just `T | undefined`/optional) to make that the only option. Separately, `@Column()` without an explicit `type:` infers the SQL type via reflect-metadata, which collapses a `number | null` (or any union) property type to generic `Object` — better-sqlite3 then rejects it at startup (`DataTypeNotSupportedError`). Any nullable non-Date/non-string column needs an explicit `type:` (e.g. `{ type: 'int', nullable: true }`); `Date | null` is fine since `finishTime` already had `type: 'datetime'`. See `stage-run.entity.ts`'s `finishTime`/`durationMs` for the pattern — this exact bug shipped silently for a while: clearing a `StageRun.finishTime` via `PATCH /stage-runs/:id` looked like it worked (the response echoed the request) but never persisted.

**`DecoderAdapter` isolates hardware from the pipeline.** `apps/gate-agent/src/adapters/decoder-adapter.ts` defines `start()`/`stop()`; only `SimulatedAdapter` exists today. Everything past `gate-agent` only ever sees the resulting `DetectionEvent` over MQTT, so adding real hardware (`OpenStintAdapter`, planned) never touches `rally-server`.

**`packages/shared`** holds types used by all three apps (gate roles, `DetectionEvent` shape, MQTT topic helpers, stage/classification types) — build it first after any change (`npm run build:shared`), since the other workspaces import its compiled output, not its TS source.

**`packages/ui`** is the shared Vuetify design system for every rally-gate *web* interface — `apps/web` today, the planned gate config UI (see `development-roadmap.md`) later — so they read as one product instead of each picking its own theme. `theme.ts` defines the (dark-first, rally/motorsport-branded) `rallyGateDark` theme and its usage conventions — orange stays rare (one primary action per screen), red is reserved for penalties/DNF/abort, timing colors need a second non-color signal for colorblind users; `vuetify.ts`'s `createRallyVuetify()` wires that theme plus shared component defaults and is what every app calls once at startup. Adjust the theme/defaults there, not per-app. `fonts.ts` self-hosts Barlow/Barlow Condensed/JetBrains Mono via `@fontsource/*` (never Google Fonts CDN — these apps run on closed/absent rally-site WiFi) and feeds Vuetify's `$body-font-family`/`$heading-font-family` through the theme's `variables` (`font-body`/`font-heading` → Vuetify's own `--v-font-body`/`--v-font-heading` CSS vars), no SASS override file needed. `utilities.css` has a `.rg-timing` class (tabular-nums JetBrains Mono, slashed zero), applied to every timing value in `apps/web`, plus a rule hiding the native `<input type="time">` clock icon so it can be replaced with a matching MDI one — pair with `openTimePicker` (`datetime.ts`) on `@click:append-inner`. Time corrections are deliberately time-only, no date field: `combineDateAndTime()` in `App.vue` always sources the date from context (the run's existing date, or today), since a marshal correcting a missed detection is fixing seconds, not the date — Vuetify's `VTimePicker` was considered and rejected for this because it has no seconds precision (hours/minutes only). Icons are MDI (`@mdi/font`, also self-hosted). `apps/web/src/App.vue` is fully converted to Vuetify components (`v-card`/`v-table`/`v-select`/`v-text-field`/`v-btn`/`v-chip`) — no more raw `<table>`/`<select>`/`<button>` — status values use `v-chip` colored via `runStatusColor()`/`outcomeColor()` helpers in that file. Unlike `packages/shared`, it has **no build step** — it ships plain `.ts`/`.css` source (`main`/`types` point at `src/index.ts`) and relies on the consuming app's own Vite/`@vitejs/plugin-vue` to process it, since Vite (unlike Node) can compile TS/Vue source directly. Only add a `.vue` component here once there's a second real consumer to prove the pattern against — Vite's dev-time dependency pre-bundler can choke on `.vue` files pulled in from a workspace package and may need `optimizeDeps.exclude` in the consuming app's `vite.config.ts` at that point.

**Rule engine is intentionally simple and hardcoded**, not a YAML DSL — `EventsService.applyRules` directly branches on `GateRole`. One active `StageRun` per vehicle+stage; duplicate starts/out-of-order finishes/splits are logged and ignored rather than erroring (`stage-runs.service.ts`).

## Field deployment scripts

`deploy/install-server-pi.sh` and `deploy/install-gate-pi.sh` are one-shot `curl | bash` installers for real Raspberry Pi hardware (not run from this dev repo/working directory). They hardcode assumptions about the codebase that don't get checked by any build or test — update them by hand whenever the corresponding thing changes:

- `install-server-pi.sh`: assumes `deploy/docker-compose.yml` exists and `docker compose up -d --build` works; prints port `57430`.
- `install-gate-pi.sh`: assumes npm workspace names `@rally-gate/shared`/`@rally-gate/gate-agent` (must match their `package.json` `name` fields), a Node 22.x install, build output at `apps/gate-agent/dist/main.js`, and env vars `GATE_ID`/`MQTT_HOST`/`MQTT_PORT` (must match what `apps/gate-agent/src/main.ts` reads, default port `57431`).
