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
- **Light barrier:** `BeamAdapter` (E3Z-T61 via GPIO), unassigned passings
  assigned by a marshal (`decoder-adapters.md`, `event-model.md`). The GPIO
  path is verified on a Pi with a switch to GND; the sensor itself is not.
- **Stages and gates:** gate auto-discovery via heartbeat, gate assignments as a
  plan with per-stage activation, close as terminal (`architecture.md`).
  Optional expected stage time; Live Timing flags a `STARTED` run past it as
  overdue (client-side only).
- **Clocks:** chrony on gates with rally-server's embedded SNTP server as the
  only source, measured per-gate offset with a server-side correction deadband
  (`architecture.md` "Clock offset", `deployment-modes.md` "Time sync").
- **Discovery:** mDNS `rally-server.local`, so a gate install needs no address
  (`architecture.md` "Server discovery").
- **Dashboard:** multi-page `apps/web` — Live Timing, Results, Setup, Hardware,
  Vehicles (`frontend-structure.md`).
- **Gate config UI:** settings, status, Wi-Fi, hotspot fallback, Wi-Fi reset;
  verified on a Pi. Shutdown built, not yet tried on a Pi (`gate-config-ui.md`).
- **Versions:** git build stamped into `packages/shared`, reported by gates in
  the heartbeat, shown in gate-config and the dashboard, mismatch flagged
  (`architecture.md`).
- **Deployment:** SQLite standalone and Postgres headless from one codebase,
  rally-server serving the dashboard under one port, Windows firewall rules on
  first start, Pi installers for server and gates (`deployment-modes.md`).
- **Standalone packages:** Windows and macOS zip, Linux tarball with
  bundled node, built and smoke-tested in CI (`deployment-modes.md`).
- **Events:** new / open event in the dashboard, one file each, switched by
  restarting under `start.js`; gates remembered per computer, picked into
  each event on the Hardware page (`deployment-modes.md` "New / open event").
- **CI:** build, format, lint, tests, and a headless-stack job against real
  Postgres (`CLAUDE.md`).

## Next

1. **Verify the light barrier sensor** — the adapter already works on a Pi
   with a switch between GPIO and GND. Left: the E3Z-T61 wiring and its edge
   per `decoder-adapters.md`, then a stage timed end to end with marshal
   assignment.
2. **`OpenStintAdapter`**, then **beam + OpenStint** combined (designed in
   `decoder-adapters.md`) — critical path, but waits on RF hardware validation
   (two ordered gates reading reliably); settle the `-t` question first.
3. **Gate control channel** — server → gate `sync`/`ready`/`stage-stopped`, for
   gate health ("gates ready X/Y") and pausing decoders outside a live stage
   (`architecture.md`). Also `shutdown` — "shut down all gates" after the
   event, refused while a stage is active.

## Deliberately deferred

- **GPS/PPS per gate** — waiting on hardware (`decoder-adapters.md` "Hardware
  notes").
- **Gate updates from the server** — rally WiFi is closed, so gates can't reach
  GitHub in the field; rally-server has to distribute the update. Never
  automatic: a manual "update now" outside active stages, tagged releases
  only — an unattended pull of master mid-event is the failure `CLAUDE.md`
  warns about.
- **Gate supply voltage** — optional `supplyVoltage` + `supplyWarnBelow` in
  the heartbeat, the dashboard compares. The threshold lives on the gate
  (gate-config), since the battery is gate hardware like `BEAM_EDGE` — no
  per-gate server config. Needs an I²C chip first (the Pi has no ADC):
  INA219/INA226 (voltage + current, preferred) or ADS1115 + divider.
  `vcgencmd get_throttled` (5V undervoltage flag) works without hardware as a
  fallback. Smooth over several readings with hysteresis (sensor/WiFi load
  sags); prefer per-chemistry presets over a raw volt value, as LiFePO4's flat
  curve warns late. A gate that dies of a flat battery only reads "offline", so
  log the warning on the gate too.
- **Discovery edge cases** — mDNS from a server Pi reaching gates on a physical
  LAN (only proven from a laptop and inside WSL so far), and two rally-servers on
  one network both claiming `rally-server.local`.
- **Rally controls** — Parc Fermé, time control, service park, pre-start roles
  (unused `GateRole` values today), planned start times, and penalties. All
  undesigned; don't grow Setup UI for them speculatively. When checkpoint
  interval times land, give them their own formatter rather than reusing
  `formatStageDuration` (see `packages/ui/src/format.ts`).
- **Combined start/finish gate** — one gate as both start and finish of a
  stage: on a detection, finish the vehicle's open run if it has one, otherwise
  start one. Not needed for the first functional test; to be thought through
  before building. Known points so far: a finished car passing again must still
  be ignored (as `startRun` already does); a detection right after the start
  would finish the run, so it needs a minimum stage time or similar; and the
  stage config needs a sanity check (e.g. a combined gate excludes separate
  start/finish gates on the same stage).
- **Vehicle classes** with per-class classification. Two constraints known up
  front: classes are organiser-defined **data**, not an enum; and a vehicle can
  be in **several classes at once** (many-to-many), each class ranking being a
  filtered view over the same runs, with the overall ranking unchanged.
- **Auth** on broker, API and dashboard — the closed rally network is the
  boundary until the timing pipeline is solid. Gates would authenticate against
  rally-server itself.
- **Carrying vehicles/stages over** into a new event (the useful part of an
  event wizard), and new/open event under Postgres (`deployment-modes.md`).
- **Renaming an event file** after a rally rename. The file name is fixed at
  creation; the app bar shows the rally name, so it rarely matters. If built:
  an explicit action, never on saving the details (that would restart the
  server over a typo). A closed file is a plain rename; the open one is locked
  on Windows, so `current.json` would carry `renameFrom` and the restarted
  server renames it before TypeORM opens it — keeping the old name, with a
  warning, if that fails.
- Online/spectator mode (`deployment-modes.md`).
- Rule engine DSL (hardcoded branching in `EventsService` is fine at this scale),
  RC4 learning registry / transponder management UI.
