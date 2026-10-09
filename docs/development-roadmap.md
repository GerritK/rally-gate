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
- **Timing:** start/finish/split roles, a combined start/finish gate with an
  optional minimum stage time (`event-model.md`), stage/split/overall classification, DNF/DNS,
  manual corrections (a time of day or a stage time), a missed start
  entered from finish and stage time, voiding and gate-timed re-runs, notional times,
  entry classes as filtered rankings, splits as columns of the stage
  classification, crews without a counted stage listed
  as "Not classified" below the overall (`event-model.md`).
- **Penalties:** a catalogue of types, flat or tiered, counted per stage or
  across the rally, plus free text; given on Live Timing or the entry page,
  added to the overall total only, priced on read (`event-model.md`
  "Penalties").
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
  table of every entry in start order with run state, corrections and
  Start now per row, and unassigned passings pre-selected from the start
  order (never auto-assigned). Prints as the posted start list (`frontend-structure.md`).
- **Overall stage headers** link to that stage's results, class filter
  kept. Header only: a row click is kept free for an entry detail page.
- **Printing:** start lists and results (Overall, each stage) as PDFs
  built in the browser (jsPDF), on numbered sheets with what each holds,
  the print time, and "Provisional" while a stage runs or a start list
  isn't frozen; "Print all" puts every class's ranking in one PDF. Saved
  class combinations ("2WD + Rookie") wait until someone needs one; the
  filter is a link (`design-system.md` "Print").
- **Dashboard:** multi-page `apps/web` — Live Timing, Results, Setup, Hardware,
  Entries (`frontend-structure.md`).
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
- **Crews:** driver and co-driver as first/last name with a flag each, body
  and chassis; names in the event's format and flags shown or off on
  screen (Setup → Display; printed PDFs never show flags); an entry page,
  opened from Entries and Results rows, with its crew, car, entry and
  times per stage (`frontend-structure.md`, `design-system.md`). Flags are
  freely usable only: `flag-icons` for countries, own SVGs for the
  chequered default and the Pride, Progress Pride and trans flags
  (`THIRD_PARTY_NOTICES.md`). Not the International Flag of Planet Earth:
  its terms forbid it standing for a person.
- **Check-in:** entry status from the Entries list, the entry page
  and a check-in page with Desk and Scrutineering stations, the desk
  taking the transponder (Registered → Checked in → Scrutineered, or both
  at once; Withdraw, Disqualify, Reinstate). Withdrawn and
  disqualified cars leave computed start lists and start no run;
  disqualified ones leave every result, listed as DSQ. Not yet scrutineered
  still starts, marked on Live Timing, and Freeze/Activate ask
  (`event-model.md` "Entry status").
- **Transponders:** several per entry, each with a kind (RC, NFC) and an
  optional label, a detection matching only its own kind; one transponder on
  several cars holds its passings for a marshal like a beam passing, the
  picker offering just those cars (`event-model.md` "Transponders").
- **Podium** above the Overall and each stage's results, following the class
  filter: steps 2-1-3 with gold/silver/bronze trophies, crew, body, time and
  gap; a click opens the entry. On screen only, or off; the printed
  result is a plain table (`design-system.md`).
- **CI:** build, format, lint, tests, and a headless-stack job against real
  Postgres (`CLAUDE.md`).
- **English and German** in both web UIs (vue-i18n, Vuetify's own texts
  included), picked per browser: its language, or the viewer's choice in the
  app bar. Printed PDFs follow it. Server error messages are still English.

## Next

- **Server errors as codes**, so the UIs can translate them: today a 409's
  English `message` reaches the snackbar as-is.

- **Event-wide status** — Setup → Running → Closed, on `RallyInfo`,
  server-owned like `Stage.status`. Activating the first stage starts the
  rally, with a pre-start check in that confirmation (every stage has a start
  and finish, gates online and synced, transponder gaps and duplicates,
  entries without a class): few hard errors, mostly warnings, as a marshal
  knows things the check doesn't. Running locks only what reinterprets
  results already timed (deleting/renaming classes, a timed car's start
  number, start-order settings) — late entries, transponder swaps, withdrawals
  and corrections stay open, or marshals unlock and forget. Closed is the
  valuable one: results official, no corrections or penalties, no
  "Provisional"; reopening is deliberate (a protest). Locks as a per-route
  decorator, and disabled controls say why.
- **Class and category badges in rankings** ("2WD · Rookie") on Results
  and the PDFs: only the classes the current filter doesn't already imply
  (filtered to 2WD, a 2WD badge says nothing), and no column at all while
  no entry has a class or category.

- **ESP32 NFC check-in gate** — firmware in `firmware/esp32-gate` builds,
  untested on hardware (ordered: XIAO ESP32-S3, PN532). Then: a server-side
  meaning for a check-in tap (no role sets entry status yet), OTA, and the
  status page on `packages/ui` (`esp32-gate.md`).

OpenStint (below) resumes when the hardware arrives.

## Deliberately deferred

- **`OpenStintAdapter`**, then **beam + OpenStint** combined (designed in
  `decoder-adapters.md`) — on hold on branch `feature/openstint-adapter`
  until working RTL-SDR hardware arrives; merge only once a real car is timed
  through a loop. Settle the `-t` question first.
- **Browser flashing for ESP32 gates** — CI builds one image per supported
  board onto the GitHub release, and a static page with ESP Web Tools
  installs it over USB, so nobody needs PlatformIO. Wanted once someone other
  than a developer flashes gates, or a second board is supported. Variants
  are per board only, never per feature: one firmware carries NFC and beam,
  the reader is detected and the beam switched on at runtime, as `ADAPTER` on
  a Pi. A per-feature builder would save no flash worth having (1.0 MB of a
  2.5 MB slot) and turn every gate into a question of which build it runs.
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
  (unused `GateRole` values today) and planned start times. All
  undesigned; don't grow Setup UI for them speculatively. When checkpoint
  interval times land, give them their own formatter rather than reusing
  `formatStageDuration` (see `packages/ui/src/format.ts`).
- **Required passings at one gate** — a stage that loops past the same gate
  n times between its own entry and exit (a car-park rally). Fits the
  stage-rally model: a `requiredPassings` on the `GateAssignment`, earlier
  passings recorded as splits with the pass number as `splitIndex`, and when
  it's the finish gate only the nth one finishes. Today the second passing is
  dropped: `StageSplit` is unique on `(stageRunId, gateId)` and `finishRun`
  takes the first. Needs a minimum pass interval like the combined gate's
  `minDurationMs` — a transponder reads a passing several times, and a double
  read counted as a lap finishes the car early, i.e. wins it the stage. A
  missed read leaves the car short a lap with no finish coming, so Live Timing
  shows "lap 2/3" and a marshal can add the missing one. One gate counts
  passings, it can't see a cut; that takes a second gate on the loop.
  The minimum interval is per entry, not per identifier: a car carrying two
  transponders of one kind is two detections per passing.
- **Other competition formats** — circuit races (several cars at once, ended
  by lap count or time) and regularity rallies, both asked for by the
  community. Not wanted yet; don't build the abstraction ahead of the first
  real second format. Direction when one comes: a `Stage.kind` with
  per-kind settings (each its own DTO class), and `EventsService.applyRules`'
  role branching moved into one handler per kind that also ranks — still
  hardcoded, not a DSL. Passings become generic (`StageSplit` minus its
  one-per-gate unique, plus a pass number — the required-passings gate above
  gets there first), so laps, splits and regularity checks are one table
  read differently. Keep the `Stage` entity name: a
  rename makes `synchronize` create new tables and every existing event file
  opens empty. The overall keeps summing stage-rally times only; ranking
  across formats needs a points scheme, decided when needed. Circuit races
  also need a transponder decoder first (OpenStint, above): a light barrier
  can't tell cars apart once several are on track, and the decoder has to
  separate simultaneous passings.
- **Manual start-order edits** on the frozen snapshot (late entry, car moved
  to the back after a repair, swaps). Until then, change start numbers before
  the start list is frozen.
- **Out-of-order start penalties**, measured against the frozen start order.
  A penalty type exists; the measuring doesn't.
- **Smarter passing suggestions** — today a start passing suggests the next
  car in start order and a split/finish one the first car on stage
  (`LiveView.vue` `suggestedEntryIds`). Planned start times could narrow it
  by time window.
- **Auth** on broker, API and dashboard — the closed rally network is the
  boundary until the timing pipeline is solid. Gates would authenticate against
  rally-server itself.
- **Reset event** — clear a rally that was only a trial so the same file can
  be used for real. Clears detections, stage runs and splits, sets stages
  back to NOT_STARTED with their gates inactive, and unfreezes start lists;
  keeps stages, gate assignments, classes, settings, rally info and known
  gates. A checkbox also clears the entries; kept entries go back to
  Registered, as the trial's check-in says nothing about the real one. It
  destroys evidence, so: refused while a stage is active, confirmed by typing
  the rally name, and in standalone mode the event file is copied aside
  first (one database = one event makes that a file copy). Emits an event so
  open dashboards reload. Overlaps with carrying entries/stages over (below):
  a reset is the same-file version of it.
- **Screens and announcements** — tablets, Pis and browser windows as
  server-controlled kiosk screens (start list, live timing, results, picked
  automatically by stage state), and finisher announcements. Thoughts only,
  not a plan: `ideas/output-devices.md`.
- **Carrying entries/stages over** into a new event (the useful part of an
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
