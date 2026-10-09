# CLAUDE.md

Rally Gate: open, modular timing and event management for RC rally events. Background: [ideas/RC_Rally_Timing_Project_Documentation.md](ideas/RC_Rally_Timing_Project_Documentation.md).

## Where the rules are

This file holds what spans projects. **Each project has its own `CLAUDE.md` — read it before changing anything there**, including when only planning a change:

- `apps/rally-server/CLAUDE.md` — **before any entity, DTO or event-handler change**: TypeORM column types valid in both drivers, `null` not `undefined`, DTO whitelist and server-owned fields, `@OnEvent` swallows errors, `/api` prefix, rolldown bundle pitfalls
- `apps/web/CLAUDE.md` — tests only for plain `.ts` modules (`node --test`), shared components and clock, Vuetify-only, time-only corrections, PDF fonts, Vite `optimizeDeps`
- `packages/ui/CLAUDE.md` — theme and defaults, self-hosted fonts, no build step, keep it out of `optimizeDeps`
- `apps/gate-agent/CLAUDE.md` — `DecoderAdapter`, why the MQTT session options matter, `node:test`
- `apps/gate-config/CLAUDE.md` — OS calls only in `system.ts`, `FIELDS` is the security boundary
- `deploy/CLAUDE.md` — installer assumptions no test checks, the Postgres `127.0.0.1` binding, chrony setup
- `firmware/esp32-gate/CLAUDE.md` — PlatformIO commands; shares the MQTT payloads with gate-agent

The "why" lives in `docs/` — read the relevant one first:

- `architecture.md` — event pipeline, gate discovery, clock offset, server discovery, gate assignment, no server → gate commands
- `event-model.md` — `DetectionEvent`/`StageRun`/`StageSplit`, notional times, start order
- `decoder-adapters.md` — adapters, hardware, gate clock policy
- `deployment-modes.md` — standalone vs headless, one database per event
- `api.md` — REST/SSE endpoints
- `frontend-structure.md` — routes and nav of `apps/web`
- `design-system.md` — colour, type, layout, status, confirmation and print rules for every web UI
- `gate-config-ui.md` — the on-gate config service, Wi-Fi and hotspot
- `esp32-gate.md` — the ESP32 NFC check-in gate
- `development-roadmap.md` — standing rules, built, next, deliberately deferred (check before starting new work)

## Commands

npm workspaces (`apps/*`, `packages/*`). **Build `shared` first** — the other workspaces import its compiled output, not its source.

```bash
npm install
npm run build:shared         # after every packages/shared change
npm run build                # all workspaces; also the only typecheck of apps/web (vue-tsc)
npm run format               # prettier for every workspace except rally-server (that one: npm run lint there)
npm run format:check         # what CI runs
npm test --workspaces --if-present
```

Dev loop, no hardware needed:
```bash
npm run dev:server           # rally-server: API :57430, MQTT :57431, SNTP :57432/udp
npm run seed-demo-data       # a stage, gate assignments and one entry via the REST API
npm run simulate -- --gate START_WP1 --transponder 1234567   # one detection (--beam: without transponder)
npm run dev:gate-agent       # continuous simulated detections
npm run dev:web              # dashboard on :57440
npm run dev:gate-config      # gate config API on :57439
npm run dev:gate-config-web  # its page on :57449
```

Packages and headless:
```bash
node scripts/package-standalone.js   # standalone package for this OS -> dist-standalone/ (build shared, rally-server, web first)
docker compose -f deploy/docker-compose.yml up                                       # headless, Postgres
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dev.yml up      # + simulated gate-agents
```

CI (`.github/workflows/ci.yml`): `verify` (build shared → format:check → server lint:check → all workspace tests → build), `firmware` (PlatformIO tests and build), `headless-stack` (boots the compose stack against Postgres). `standalone.yml` builds and smoke-tests the packages on tags. **Keep master green**: the installers are `curl | bash` off master, so a broken commit can reach a Pi mid-event.

## Working rules

- **No AI attribution** in commits or PR descriptions — no `Co-Authored-By: Claude`, no "Generated with Claude Code", whatever the tooling defaults say.
- **Comments only where a senior fullstack dev would still be stuck without one**: a non-obvious constraint, a hardware/clock gotcha, a "this looks wrong but isn't". Keep a doc comment on the function it describes when moving code.
- **Still pure dev mode: no backwards compatibility.** No redirects for removed pages, no migrations for old event files, no deprecated API aliases — change it everywhere in one commit. All data is test data. This ends with the first real event.
- **Deliberately absent, don't reintroduce unasked:** Nx/Turborepo (plain npm workspaces suffice), a separate simulator service (it's `SimulatedAdapter`), a Mosquitto/NATS container (Aedes is embedded in both modes), a Dockerfile for gate-agent (it needs raw GPIO/USB, runs under systemd), YAML gate/stage config (gates self-register, assignments come from the dashboard), a multi-tenant `Event` table (see below).

## Ports

Dedicated ports, never framework defaults (3000/5173/1883). **Every number in 5743x runs in the field**, so "which port is free" needs no grep:

| Port | Service |
|---|---|
| 57430 | `rally-server` API **and** the built `apps/web` |
| 57431 | embedded MQTT broker (Aedes) |
| 57432 | embedded SNTP server (**udp**) |
| 57433–57438 | free, for server-side growth |
| 57439 | `apps/gate-config` API and page — the only one **on a gate**, hence at the far end |
| 80 | gate-config captive-portal redirect — on a gate only, fixed by what phones probe |
| 57440 | Vite dev server for `apps/web` — dev only |
| 57449 | Vite dev server for `gate-config` — dev only |

**A Vite dev server runs on its service's port + 10**, so no dev port takes a slot an installer, firewall rule or sticker might need. New server-side services take the next free number up from 57432. Every API route is under `/api` (details in `apps/rally-server/CLAUDE.md`).

## Architecture

```
Gate hardware (or SimulatedAdapter)
  -> gate-agent (DetectionEvent + periodic heartbeat over MQTT)
  -> Aedes broker embedded in rally-server
  -> EventsService (stores DetectionEventRecord, looks up gate + entry)
  -> rule engine (active GateAssignment.role -> start/finish/split a StageRun)
  -> EventEmitter2 bus ("detection.created", "stage-run.updated", "stage-run.split", …)
  -> LiveController (one SSE stream /api/live, an event type per kind — never a stream per kind, see docs/api.md) -> dashboard
```

**Server-side behaviour is event-driven through `EventEmitter2`**, not method chains: `EventsService` emits, `LiveController` and listeners react. A new cross-cutting reaction is an emitted event with independent listeners, not a service calling three others inline.

**Gates are dumb.** A gate knows only its `GATE_ID` and publishes to `rally/gates/<gateId>/detections` and `/heartbeat`. All meaning is assigned on the server.

**`Gate` is identity, `GateAssignment` is the plan.** A `Gate` (id, name, heartbeat, capabilities) auto-creates from its first heartbeat. A `GateAssignment` is (gate, stage, role, splitIndex, active): a gate may be planned on many stages, but exactly one assignment per gate is active, and that one decides what a detection means. `StageRun`/`StageSplit` snapshot `stageId`, so reassigning a gate never rewrites history.

**One database = one event.** No `Event` entity: the SQLite file (or Postgres database) is the event, and saving or transferring one is copying it. Switching events in the standalone package restarts the process (`deploy/standalone/start.js`). **Deployment is a config switch, not a fork**: `DB_TYPE=sqlite` (default, standalone) or `postgres` (headless), picked in `apps/rally-server/src/config/database.config.ts`.

### Timing correctness beats everything

`StageRun.durationMs` subtracts timestamps from **two physically separate gate clocks**.

- **A duration must never be zero or negative.** Classification sorts ascending, so a skewed clock or a mistyped correction doesn't error — it *wins the rally*. Every path that computes or accepts a duration checks `finish > start` first.
- **Clock offset is measured and partly corrected — know which half you touch.** Heartbeats carry `sentAt`; the server stores `arrivedAt - sentAt` as `Gate.clockOffsetMs` and applies it at ingest only past a threshold, since a one-way measurement can't separate offset from latency. `timestampGate` stays raw and the applied amount is stored per detection as `clockCorrectionMs`: **effective time is always `timestampGate + clockCorrectionMs`**. Never overwrite `timestampGate` — the pair makes a result recomputable. Rationale: `docs/architecture.md` "Clock offset".
- Clock sync (chrony, an RTC) reduces drift but never guarantees two gates agree; the offset correction is a safety net for gross failures, not a substitute for sync — it can't resolve below network latency, which exceeds a winning margin.

### Detections are at-least-once, so everything is idempotent

A dropped detection is a driver with no time. gate-agent publishes at QoS 1 over a persistent session, so a reconnect replays in-flight detections. That is only safe because `DetectionEventRecord` is keyed on the gate-generated `eventId` and the rule engine ignores repeats. **Keep new pipeline code idempotent.** How processing failures are kept and retried: `apps/rally-server/CLAUDE.md`.

### `packages/shared`

Types and constants used by every app: gate roles, `DetectionEvent`, heartbeat, MQTT topics, stage/classification/entry/start-order types, and every setting key with its default (`settings.ts` and beside their enums) — never a key string or a "mirrored" default inside an app. Ships CommonJS — fine for Node; `apps/web` needs it in `optimizeDeps` (see `apps/web/CLAUDE.md`). A shape change here also reaches `firmware/esp32-gate`, which nothing type-checks.
