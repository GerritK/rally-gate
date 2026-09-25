# Development Roadmap

## Standing rules

- **Zero-config gates.** Installing a gate must not require knowing anything
  about the rally it will be used at — not an IP, and not whether rally-server
  runs on a laptop or a Pi — and reconfiguring one happens in `gate-config`,
  never by re-running the installer. Check any new gate-side work against this
  rather than adding another install prompt.

## Built

What exists, with where its reasoning lives. History is in git.

- **Pipeline:** gate-agent → embedded MQTT → ingest → rule engine → stage runs →
  SSE → dashboard; QoS 1 persistent sessions, idempotent rules, failed
  detections retried and surfaced (`CLAUDE.md`, `event-model.md`).
- **Timing:** start/finish/split roles, stage/split/overall classification, DNF/DNS,
  manual corrections, voiding and gate-timed re-runs, notional times
  (`event-model.md`).
- **Stages and gates:** gate auto-discovery via heartbeat, gate assignments as a
  plan with per-stage activation, close as terminal (`architecture.md`).
- **Clocks:** chrony on gates with rally-server's embedded SNTP server as the
  only source, measured per-gate offset with a server-side correction deadband
  (`architecture.md` "Clock offset", `deployment-modes.md` "Time sync").
- **Discovery:** mDNS `rally-server.local`, so a gate install needs no address
  (`architecture.md` "Server discovery").
- **Dashboard:** multi-page `apps/web` — Live Timing, Results, Setup, Hardware,
  Vehicles (`frontend-structure.md`).
- **Gate config UI:** settings, status, Wi-Fi, hotspot fallback, Wi-Fi reset;
  verified on a Pi (`gate-config-ui.md`).
- **Deployment:** SQLite standalone and Postgres headless from one codebase,
  rally-server serving the dashboard under one port, Windows firewall rules on
  first start, Pi installers for server and gates (`deployment-modes.md`).
- **CI:** build, format, lint, tests, and a headless-stack job against real
  Postgres (`CLAUDE.md`).

## Next

1. **Expected stage time.** Optional `Stage.expectedDurationMs`; the dashboard
   flags a `STARTED` run as overdue once `now - startTime` exceeds it.
   Client-side only — the SSE data already carries `startTime`.
2. **Standalone packaging** (Node SEA/`pkg`, optional tray icon, "new / open
   event") — needed to hand `rally-server` to a marshal without a dev machine.
3. **`OpenStintAdapter`** — critical path, but waits on RF hardware validation
   (two ordered gates reading reliably); settle the `-t` question in
   `decoder-adapters.md` first.
4. **Gate control channel** — server → gate `sync`/`ready`/`stage-stopped`, for
   gate health ("gates ready X/Y") and pausing decoders outside a live stage
   (`architecture.md`).

## Deliberately deferred

- **GPS/PPS per gate** — waiting on hardware (`decoder-adapters.md` "Hardware
  notes").
- **Discovery edge cases** — mDNS from a server Pi reaching gates on a physical
  LAN (only proven from a laptop and inside WSL so far), and two rally-servers on
  one network both claiming `rally-server.local`.
- **Rally controls** — Parc Fermé, time control, service park, pre-start roles
  (unused `GateRole` values today), planned start times, and penalties. All
  undesigned; don't grow Setup UI for them speculatively. When checkpoint
  interval times land, give them their own formatter rather than reusing
  `formatStageDuration` (see `packages/ui/src/format.ts`).
- **Vehicle classes** with per-class classification. Two constraints known up
  front: classes are organiser-defined **data**, not an enum; and a vehicle can
  be in **several classes at once** (many-to-many), each class ranking being a
  filtered view over the same runs, with the overall ranking unchanged.
- **Auth** on broker, API and dashboard — the closed rally network is the
  boundary until the timing pipeline is solid. Gates would authenticate against
  rally-server itself.
- Online/spectator mode (`deployment-modes.md`).
- Rule engine DSL (hardcoded branching in `EventsService` is fine at this scale),
  RC4 learning registry / transponder management UI.
