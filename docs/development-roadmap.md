# Development Roadmap

## Standing rules

- **Zero-config gates.** Installing a gate must not require knowing anything
  about the rally it will be used at — not an IP, and not whether rally-server
  runs on a laptop or a Pi — and reconfiguring one happens in `gate-config`,
  never by re-running the installer. Check any new gate-side work against this
  rather than adding another install prompt.
- **The laptop comes first.** Standalone is the primary mode
  (`deployment-modes.md`); a server on a Pi is supported, not prioritised.

## Built

One line each; the linked doc has the detail. History is in git.

- **Pipeline:** gate-agent → MQTT → ingest → rule engine → stage runs → SSE →
  dashboard; QoS 1, idempotent rules, failed detections retried
  (`CLAUDE.md`, `event-model.md`).
- **Timing:** start/finish/split and combined start/finish gates,
  stage/split/overall classification, DNF/DNS, corrections, missed starts,
  voiding and re-runs, notional times, class rankings (`event-model.md`).
- **Stages outside the overall:** qualifying and shakedown (`event-model.md`).
- **Rally status:** Setup → Running → Closed with route locks
  (`event-model.md` "Rally status").
- **Penalties:** a catalogue of flat or tiered types, per stage or per rally,
  plus free text (`event-model.md` "Penalties").
- **Light barrier:** `BeamAdapter`, passings assigned by a marshal
  (`decoder-adapters.md`). Verified on a Pi with an E3Z-T61.
- **RC transponders:** `OpenStintAdapter` on an RTL-SDR
  (`decoder-adapters.md`). Verified on a Pi with a real car through a loop.
- **Beam + OpenStint** at one gate: the beam's time, the transponder's car
  (`decoder-adapters.md`). Not yet tried on hardware.
- **Stages and gates:** gates paired once with their own key, then created by their first heartbeat, assignments as a plan
  with per-stage activation, expected stage time (`architecture.md`).
- **Clocks:** chrony against rally-server's SNTP, measured offset with a
  correction deadband (`architecture.md` "Clock offset").
- **Discovery:** mDNS `rally-server.local` (`architecture.md`).
- **Start order:** computed per stage, frozen when posted (`event-model.md`).
- **Dashboard:** Live Timing (the marshal view), Results with podium,
  Entries with check-in, Hardware, Setup (`frontend-structure.md`).
- **Printing:** start lists and results as PDFs (`design-system.md` "Print").
- **Crews:** names and flags in the event's format, entry pages
  (`design-system.md`).
- **Check-in:** Desk and Scrutineering, withdraw and disqualify
  (`event-model.md` "Entry status").
- **Transponders:** several per entry, each with a kind (`event-model.md`).
- **Gate config UI:** settings, status, Wi-Fi, hotspot fallback, shutdown
  (`gate-config-ui.md`). Shutdown not yet tried on a Pi.
- **Gate health:** chrony state and versions in the heartbeat, "Shut down
  all gates" (`architecture.md`). Not yet tried on a Pi.
- **Deployment:** SQLite standalone and Postgres headless, Pi installers,
  standalone packages built in CI, new / open event, known gates; ESP32
  gate images on every release, flashed from the browser (`esp32-gate.md`
  "Installing")
  (`deployment-modes.md`).
- **English and German** in both web UIs, PDFs included (`api.md` for
  server error codes).
- **CI:** build, format, lint, tests, headless stack against Postgres.

## Next

- **Audit findings (2026-10-19)**, most urgent first. 1 and 2 were
  reproduced against the built server.
  1. *A finish or split before its delayed start is lost.* A start gate that
     drops off Wi-Fi replays its start later; the finish arriving first finds
     no open run, is ignored and still marked processed, so the run stays
     STARTED and becomes a DNF at close, with nothing on the pending list.
     Fix: when `finishRun`/`recordSplit` find no open run, leave the
     detection unprocessed for ~10 minutes so the 30 s retry sweep applies it
     once the start is in (`EventsService.applyRulesForRecord`); test
     "finish before start".
  2. *A detection is lost when storing it fails.* The broker PUBACKs before
     `EventsService` inserts, so with the database unreachable (Postgres
     restarting) the gate drops it (the ESP32 deletes it from flash) and the
     server logs only `ECONNREFUSED`. Fix: catch in `handleMqttMessage`, keep
     the failed detections in memory and retry them in `reprocessPending`;
     the full fix is to PUBACK only after the insert (Aedes
     `authorizePublish`).
  3. *Gate services run as the installing user,* which on Raspberry Pi OS has
     `NOPASSWD: ALL`, so the narrow sudoers rules and `rally-gate-net` don't
     bound anything once gate-config or gate-agent runs foreign code. Fix: a
     system user (`useradd --system --groups gpio,plugdev rally-gate`) as
     `User=` of both units, owning `/etc/rally-gate`.
  4. *From the 11th open dashboard* the console shows `possible EventEmitter
     memory leak detected` (EventEmitter2 allows 10 listeners per event).
     Fix: `EventEmitterModule.forRoot({ maxListeners: 100 })`.
  5. *A correction across midnight is refused:* start 23:58, finish typed as
     00:03:10 lands on the start's day, before the start (entering the stage
     time works). Fix: in `combineDateAndTime` callers, add a day when the
     finish isn't after the start; test in `format.spec.ts`.

- **Access and authentication** (`auth.md`), before the first real event, in
  three steps, each shippable:
  1. API and dashboard. Built: roles on every change, invitations with
     printable QR codes and devices (Setup → Access), organiser by localhost
     or password with a setup QR, `reset-admin`, `/login` and `/join/:code`,
     the dashboard showing only what the role may do, the History of every
     hand-made change with its device on the entry page, a rate limit on
     `/auth/login`, and the operating rule "participants never on the timing
     Wi-Fi" on the login page and in the README, and the public page with
     every internal read behind the login. Done.
  2. Broker and gates. Built: Pi gates create their own key and log in
     with a single-use HMAC token, the key goes out only on a server's
     CONNACK 4 while pairing is open, Pair gates on Hardware with accept and
     reject, waiting gates refused so their detections stay on the gate,
     each gate publishing only on its own topics, `autoDiscoverGates`
     removed, `GATES_AUTO_ACCEPT` for dev. No server proof and no TLS: the
     operating rule covers a fake server (`auth.md` "Gates"). Left: the
     same login on the ESP32 (key in NVS).
  3. gate-config and ESP32: signed pass, the 3-minute power-on window, the
     same on `web.cpp`. Check whether browser flashing erases NVS.

- **Class and category badges in rankings** ("2WD · Rookie") on Results
  and the PDFs: only the classes the current filter doesn't already imply
  (filtered to 2WD, a 2WD badge says nothing), and no column at all while
  no entry has a class or category.

- **ESP32 NFC check-in gate** — firmware in `firmware/esp32-gate` runs on
  a XIAO ESP32-S3 with a PN532: Wi-Fi, server discovery, clock sync and a
  tap through to rally-server. Then: a server-side
  meaning for a check-in tap (no role sets entry status yet) and OTA
  (`esp32-gate.md`).

## Deliberately deferred

- **A dead beam on a `beam-openstint` gate in the heartbeat** — it drops
  every read, so the dashboard shows a quiet gate and only the gate's log
  says why (`decoder-adapters.md` "Beam + OpenStint"). Waits for it to
  happen in the field.

- **An event clock on rally-server that never steps** — every gate follows the
  server host's clock, so a host time sync stepping it mid-event (a laptop
  joining a phone hotspot, Windows correcting a weekly drift) moves Pi and
  ESP32 gates over different spans (chrony slews ~24s for 2s, an ESP32 ~12s),
  and a stage across that window is seconds off. The fix: serve NTP, heartbeat
  `arrivedAt`, manual start/finish "now" and the web's `/api` now from a
  monotonic clock that follows the system clock at ≤50ppm, optionally
  persisting its offset across restarts. Deferred because rally Wi-Fi has no
  internet, so the host has nothing to step to; until then `preciseNowMs`
  logs every step past 50ms. Build it before an event whose server has
  internet, or once a logged step shows up in the field.
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
  need the transponder decoder (OpenStint), not a beam: a light barrier
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
- **Beyond the auth design** (`auth.md`): TLS on the LAN, the login for the
  online mode's cloud push, carrying invitations over to a new event, rights
  per single action instead of per role.
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
- **NFC stop control for beam-only finishes** — once the ESP32 check-in
  gate runs on hardware. The driver taps the entry's NFC sticker at an ESP32
  gate at the stop control, where cars halt well past the flying finish, so
  the tap names the car instead of a marshal. A new role: on a
  `stage_finish` gate a tap would finish the run with the tap's own time.
  Never "tap takes the oldest open passing": a phantom passing or a missed
  tap shifts every later car onto the previous car's time, and close
  finishes tapped in reverse swap them — the wrong time nobody notices
  (`event-model.md` "Unassigned passings"). Only open finish passings in a
  **window before the tap** count: at least the drive from finish to stop
  control, at most ~60 s (both per stage). A leftover phantom or untapped
  car's passing ages out of it, so a shift can't run on through the field.
  **Exactly one** in the window, and the car has an open run: the tap
  assigns it, through the same path as a marshal's assign, with its checks.
  **Several**: a phantom or a missed tap just before would hand this car the
  wrong time, so it is a suggestion — the oldest pre-selected for the tapped
  car, one click to confirm. **None**: the tap is stored, nothing more.
  Server side needs no hardware (`simulate` with an NFC kind).
- **Unassigned tags at check-in** — an ESP32 gate on the desk, its taps of
  tags no entry has shown on the check-in page to add to the selected
  entry, so the desk never types a UID and gate and desk read it the same
  way (`esp32-gate.md` "Identifying a driver"). Which gate is the desk's is
  open: picked on the page, or a gate role that never times, which could
  also check in a known tag. Server side needs nothing new: the taps are
  plain detections with no entry.
- **Saved class combinations** ("2WD + Rookie") for printing — the class
  filter is a link, which covers it until someone asks.
- **The International Flag of Planet Earth** as a crew flag: its terms
  forbid it standing for a person.
- Online/spectator mode: a one-way push from the local rally-server to a
  cloud service, so spectators get live timing while the rally network stays
  closed.
- Rule engine DSL (hardcoded branching in `EventsService` is fine at this scale),
  RC4 learning registry / transponder management UI.
