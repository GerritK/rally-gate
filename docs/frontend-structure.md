# Frontend Structure

`apps/web`: a `vue-router` app behind a `v-navigation-drawer`, one `.vue` file
per route in `src/pages/`, API calls in `src/api/` (one module per entity,
sharing `client.ts`). Audience is marshals and organisers only.

| Route | Nav | Contents |
|---|---|---|
| `/` | — | redirect to `/live` |
| `/live/:stageId?` | Live Timing | the marshal view, laid out like the stage: its gates on a line in the order a car meets them, each with its health; "Up next" (next car large with Start now, the two after it) beside cars on stage in expected arrival order, each with Finish now (split progress, last split with gap to the best); every vehicle in start order with its run state, times and corrections (a stage time derives the finish), and Enter time for a car with no run (a missed start: finish and stage time give the start); unidentified passings in On stage, starts included (a car that crossed the start line is on stage), with a suggested vehicle; Activate / Close; freeze and print the start list; raw detections collapsed. No stage picks the active one, else the next |
| `/results/overall` | Results | overall classification, each stage column the time driven, the fastest marked, the gap to it in the tooltip, its header linking to that stage's results, filterable by class, printable |
| `/results/stages/:stageId` | Results | stage classification with a column per split (the time and its rank, the fastest marked, the gap to it in the tooltip), DNF/DNS, filterable by class, printable |
| `/vehicles` | Vehicles | registration in a dialog, status, classes; a row opens the vehicle |
| `/vehicles/:vehicleId` | Vehicles | one vehicle: door number, crew name with flags, body and chassis, edit in the same dialog. Result rows open it too. Later its times per stage, several transponders |
| `/hardware` | Hardware | gate roster: online, heartbeat, clock offset, version, add/delete, auto-discovery toggle, shut down all gates; a row opens the gate. Gates known to this computer: add to this event, forget (standalone only) |
| `/hardware/gates/:gateId` | Hardware | one gate: status, clock, address with a link to its gate-config, version, rename; its assignments on every stage; its last 100 detections, live, with clock correction and what became of each |
| `/setup` | Setup | the event: rally details, file name, New / Open Event dialogs (standalone only); tiles to Stages, Classes, Start order, Scoring and Display. The app bar's cog links here |
| `/setup/stages` | Setup | stage list, create |
| `/setup/stages/:stageId` | Setup | edit stage, its gate assignments (active state read-only) |
| `/setup/classes` | Setup | vehicle classes table: add/rename/delete, main class or category, vehicle count. Assigned on Vehicles |
| `/setup/start-order` | Setup | start order rules: grouping, key, direction. Later planned start times |
| `/setup/scoring` | Setup | notional time penalty; later penalties |
| `/setup/display` | Setup | crew name format, flags and podium: shown, screen only (not printed) or not at all |

## Decisions

- **The start list is Live Timing's backbone**, not a page of its own: one row
  per vehicle in start order, runs merged in, main classes as header rows.
  Printing it is `window.print()`; print styles (`d-print-none`,
  `packages/ui/src/utilities.css`) cut it down to the start list (position,
  number, driver, co-driver), so the posted copy and the marshal's screen are
  one page. No PDF library. Its rules are configured under Setup.
- **The app bar** shows the open event, the server clock and the live
  stream's state (see `design-system.md` "App bar"). The state comes from the
  page's own stream (`liveStatus` in `api/live.ts`), never a second
  connection.
- **Live Timing loads its data directly, not only when the live stream opens.**
  A browser allows six connections per host, and each dashboard tab holds one
  stream, so with enough tabs open the stream sits pending; waiting for it
  would leave the page empty.
- **Splits are columns of the stage classification**, not a ranking of their
  own: Results is read after the stage, so a car still on stage has no row.
  Mid-stage, Live Timing's On stage card shows each car's split against the
  best. Once the stage closes, a DNF's splits no longer count towards a
  split's rank or best.
- **Gate assignments live under their stage**; the gate-centric view of "what
  is every gate doing" is the Hardware page, and a gate's own page lists its
  assignments read-only, linking to each stage.
- **Raw detections are on the gate's page**, filtered server-side
  (`GET /events?gateId=`): the unfiltered list is the last 100 of every gate,
  where a quiet gate's passings would scroll out. Live Timing keeps its
  stage-wide panel.
- **Activation is on Live Timing and per stage** — it is an operational
  mid-event action, like Close. There is no deactivate button; gates turn off by
  closing the stage.
- **Hardware and Vehicles are top-level**, not under Setup, because both are
  used mid-event. `/setup` doesn't link to them; it keeps a Stages tile only
  because Stages has no nav entry.
- **Sub-pages open with a text back button, no breadcrumbs** — two levels deep,
  and a full-size button is easier to hit on a tablet.
- **Drawer, not tabs**, so more sections don't need a nav rework.
- **No store, no speculative components.** Each page fetches what it needs in
  `onMounted`; data volumes are tiny. The one exception is the Display
  settings (`display` in `src/crew.ts`), loaded once by `App.vue`, since
  every crew name on every page reads them. Extract a component once it is actually
  duplicated; the shared ones are listed in `design-system.md`. Shared pure
  helpers are in `src/format.ts`.
- **New / Open Event live in Setup**, on the rally details card: the details
  are the event, and switching is a before-the-event action (refused while a
  stage is active), so it has no nav entry. Known gates are on Hardware,
  where gates are looked for.
- **Switching events reloads the whole app** rather than refetching: every
  page holds the old event's data, and there is no store to reset.
- Stage ids are caller-supplied (`WP1`, `SS2`), so the create form has an id
  field.
