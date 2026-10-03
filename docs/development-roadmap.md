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
  manual corrections, voiding and gate-timed re-runs, notional times,
  vehicle classes as filtered rankings, crews without a counted stage listed
  as "Not classified" below the overall (`event-model.md`).
- **Light barrier:** `BeamAdapter` (E3Z-T61 via GPIO), unassigned passings
  assigned by a marshal (`decoder-adapters.md`, `event-model.md`). Verified on
  a Pi with the E3Z-T61, marshal assignment included.
- **Stages and gates:** gate auto-discovery via heartbeat, gate assignments as a
  plan with per-stage activation, close as terminal (`architecture.md`).
  Optional expected stage time; Live Timing flags a `STARTED` run past it as
  overdue (client-side only).
- **Clocks:** chrony on gates with rally-server's embedded SNTP server as the
  only source, measured per-gate offset with a server-side correction deadband
  (`architecture.md` "Clock offset", `deployment-modes.md` "Time sync").
- **Discovery:** mDNS `rally-server.local`, so a gate install needs no address
  (`architecture.md` "Server discovery").
- **Start order:** integer start numbers, per-stage start list grouped by main
  class and sorted by start number, overall or last stage time in either
  direction, frozen by hand when posted or on first activation (`event-model.md`
  "Start order").
- **Marshal view:** Live Timing is laid out like the stage: "Up next" with
  Start now beside the cars on stage in expected arrival order, above one
  table of every vehicle in start order with run state, corrections and
  Start now per row, and unassigned passings pre-selected from the start order (never
  auto-assigned). Prints as the posted start list (`frontend-structure.md`).
- **Dashboard:** multi-page `apps/web` — Live Timing, Results, Setup, Hardware,
  Vehicles (`frontend-structure.md`).
- **UI guidelines** (`design-system.md`): shared confirm dialog and
  snackbar in both apps, add/edit forms in `FormDialog`, one direct action
  plus a menu per row, unsaved changes guarded on page forms.
- **Gate config UI:** settings, status, Wi-Fi, hotspot fallback, Wi-Fi reset;
  verified on a Pi. Shutdown built, not yet tried on a Pi (`gate-config-ui.md`).
- **Gate health:** chrony state in the heartbeat, each gate's state on Live
  Timing's gate line, "Shut down all gates" on the Hardware page via gate-config
  (`architecture.md`). Not yet tried on a Pi.
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

- **Splits as columns in the stage classification**, replacing the separate
  Split Classification card and its picker: each cell the split time plus
  that split's rank, the best one marked (`timing-best` and a second cue).
  No rows for cars still on stage: mid-stage, Live Timing's On stage card
  already shows each car's split against the best, and Results is read
  after the stage. No server change, the per-split data exists. Update the
  "Split classification is under Results" note in `frontend-structure.md`.
- **Print results** like the start list (`design-system.md` "Print"): a
  Print button on Overall and on a stage's results, printing the table as
  the posted result. Rally name (no app bar on paper), title, class filter
  from the subtitle, and the time it was printed, since results move while
  a stage runs; a stage still running prints as "Provisional". The stage
  page prints its classification, split columns included, plus DNF/DNS.
  Overall
  goes landscape (`@page`) once its stage columns no longer fit portrait.
- **Stage column headers on Overall link to that stage's results.** Header
  only: a row click is kept free for a vehicle detail page (`design-system.md`
  "Tables").

OpenStint (below) resumes when the hardware arrives.

## Deliberately deferred

- **`OpenStintAdapter`**, then **beam + OpenStint** combined (designed in
  `decoder-adapters.md`) — on hold on branch `feature/openstint-adapter`
  until working RTL-SDR hardware arrives; merge only once a real car is timed
  through a loop. Settle the `-t` question first.
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
  Not `vcgencmd get_throttled` as a fallback: it reads the Pi's 5V rail after
  the regulator, which holds until the battery collapses, so it warns too late
  to act on. Smooth over several readings with hysteresis (sensor/WiFi load
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
- **Manual start-order edits** on the frozen snapshot (late entry, car moved
  to the back after a repair, swaps). Until then, change start numbers before
  the start list is frozen.
- **Out-of-order start penalties**, measured against the frozen start order.
  They depend on penalties as a whole (Rally controls, above).
- **Manual times as durations, not clock times** — get rid of typed
  timestamps. Starting by hand is already "Start now" (server-stamped). Still
  typed: correcting a start or finish (`Correct` on a row). A marshal knows
  "3:12.4 on the stopwatch" more reliably than a time of day, so a correction
  could take the stage time and derive the missing end from the other one.
  Also covers a start missed on a stage that is already closed, which has no
  manual path since "Enter start" went.
- **Smarter passing suggestions** — today a start passing suggests the next
  car in start order and a split/finish one the first car on stage
  (`LiveView.vue` `suggestedVehicleIds`). Planned start times could narrow it
  by time window.
- **Combined start/finish gate** — one gate as both start and finish of a
  stage: on a detection, finish the vehicle's open run if it has one, otherwise
  start one. Not needed for the first functional test; to be thought through
  before building. Known points so far: a finished car passing again must still
  be ignored (as `startRun` already does); a detection right after the start
  would finish the run, so it needs a minimum stage time or similar; and the
  stage config needs a sanity check (e.g. a combined gate excludes separate
  start/finish gates on the same stage).
- **Auth** on broker, API and dashboard — the closed rally network is the
  boundary until the timing pipeline is solid. Gates would authenticate against
  rally-server itself.
- **Carrying vehicles/stages over** into a new event (the useful part of an
  event wizard) — low priority, re-entering them per event is acceptable — and
  new/open event under Postgres (`deployment-modes.md`).
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
