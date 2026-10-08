# Frontend Structure

`apps/web`: a `vue-router` app behind a `v-navigation-drawer`, one `.vue` file
per route in `src/pages/`, API calls in `src/api/` (one module per entity,
sharing `client.ts`). Audience is marshals and organisers only.

| Route | Nav | Contents |
|---|---|---|
| `/` | — | redirect to `/live` |
| `/live/:stageId?` | Live Timing | the marshal view, laid out like the stage: its gates on a line in the order a car meets them, each with its health; "Up next" (next car large with Start now, the two after it) beside cars on stage in expected arrival order, each with Finish now (split progress, last split with gap to the best); every entry in start order with its run state, times and corrections (a stage time derives the finish), and Enter time for a car with no run (a missed start: finish and stage time give the start); unidentified passings in On stage, starts included (a car that crossed the start line is on stage), with a suggested entry; Activate / Close; freeze and print the start list; raw detections collapsed. A car not yet scrutineered is marked in Up next and on the list; Freeze and Activate name such cars and ask. No stage picks the active one, else the next |
| `/results/overall` | Results | podium, overall classification, each stage column the time driven, the fastest marked, the gap to it in the tooltip, its header linking to that stage's results, filterable by class; Print / Print all open a PDF (every class's ranking on its own sheets) |
| `/results/stages/:stageId` | Results | podium, stage classification with a column per split (the time and its rank, the fastest marked, the gap to it in the tooltip), DNF/DNS, filterable by class; Print / Print all open a PDF (every class's ranking on its own sheets) |
| `/entries` | Entries | registration in a dialog, status, classes; per row the status's next step (Check in, Passed) and ⋮ for the rest (back a step, Withdraw, Disqualify, Reinstate); Check-in in the header; a row opens the entry |
| `/entries/check-in` | Entries | check-in in two stations, Desk and Scrutineering (switch remembered per device), since the two happen at different tables and scrutineering doesn't go in entry order: how many are checked in and scrutineered, the cars still open at this station, a search by start number or name that finds every car (Enter picks the first match, exact number first, accents ignored), the picked car beside the list with its car, classes and transponder, its next step as the big button, Edit and ⋮. The desk also offers Check in and pass, and takes the transponders inline, saved with the step; one another car already has, or several of one kind, is allowed but warned about, as in the entry dialog. Switching station drops the picked car. After a step the search clears for the next car. However long the list, the picked car stays in view: beside the list it travels with the page, on a phone it sits above the list and the page scrolls up to it |
| `/entries/:entryId` | Entries | one entry: door number and crew on top with Edit (the same dialog), then the dialog's parts as cards: Crew (names in full, flags with their country), Car (body, chassis), Registration (status, classes, transponders); below them Times: the overall standing, and per stage in stage order start, finish (hand-set marked), time (fastest marked), position and gap among all classes, a status where its time is missing (DNS, Waiting, Not started across Start and Finish; DNF, On stage under Finish), and a DNF or DNS with the notional time the overall charges for it under Time, so the rows add up to the total. Result rows open it too |
| `/hardware` | Hardware | gate roster: online, heartbeat, clock offset, version, add/delete, auto-discovery toggle, shut down all gates; a row opens the gate. Gates known to this computer: add to this event, forget (standalone only) |
| `/hardware/gates/:gateId` | Hardware | one gate: status, clock, address with a link to its gate-config, version, rename; its assignments on every stage; its last 100 detections, live, with clock correction and what became of each |
| `/setup` | Setup | the event: rally details, file name, New / Open Event dialogs (standalone only); tiles to Stages, Classes, Start order, Scoring and Display. The app bar's cog links here |
| `/setup/stages` | Setup | stage list, create |
| `/setup/stages/:stageId` | Setup | edit stage, its gate assignments (active state read-only) |
| `/setup/classes` | Setup | entry classes table: add/rename/delete, main class or category, entry count. Assigned on Entries |
| `/setup/start-order` | Setup | start order rules: grouping, key, direction. Later planned start times |
| `/setup/scoring` | Setup | notional time penalty; later penalties |
| `/setup/display` | Setup | Crew: name format and flags, with an example crew drawn with the unsaved settings; Results: podium. Switches, on screen only (printouts are plain PDFs) |

## Decisions

- **The start list is Live Timing's backbone**, not a page of its own: one row
  per entry in start order, runs merged in, main classes as header rows.
  Printing it is a PDF of the same rows (position, number, crew, car, class
  headers), like the results (`design-system.md` "Print"). Its rules are
  configured under Setup.
- **Overall and a stage's results are one page** (`ResultsView`), two
  URLs: track, class filter, card header, Print and "Print all" exist once.
  Only the table differs (`OverallRanking`, `StageRanking`), since the
  columns and the second table (not classified vs. DNF/DNS) really differ.
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
- **Hardware and Entries are top-level**, not under Setup, because both are
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
