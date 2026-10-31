# Frontend Structure

`apps/web`: a `vue-router` app behind a `v-navigation-drawer`, one `.vue` file
per route in `src/pages/`, API calls in `src/api/` (one module per entity,
sharing `client.ts`). Audience is marshals and organisers; anyone without a login gets `/public`
only (`auth.md` "Who sees what"), who may change what is `auth.md` too.

| Route | Nav | Contents |
|---|---|---|
| `/` | — | redirect to `/live` |
| `/live/:stageId?` | Live Timing | the marshal view, laid out like the stage: the stage's gates with their health, Up next beside On stage (cars in expected arrival order, unidentified passings with a suggested entry), every entry in start order with run state, corrections, Enter time and Add penalties; Activate / Close, freeze and print the start list. No stage picks the active one, else the next |
| `/results/overall` | Results | podium, overall classification, each stage column the time driven, the fastest marked, the gap to it in the tooltip, its header linking to that stage's results, a Penalties column once anyone has one, filterable by class; Print / Print all open a PDF (every class's ranking on its own sheets) |
| `/results/stages/:stageId` | Results | podium, stage classification with a column per split (the time and its rank, the fastest marked, the gap to it in the tooltip), DNF/DNS, filterable by class; Print / Print all open a PDF (every class's ranking on its own sheets) |
| `/entries` | Entries | registration in a dialog, status, classes; per row the status's next step (Check in, Passed) and ⋮ for the rest (back a step, Withdraw, Disqualify, Reinstate); Check-in in the header; a row opens the entry |
| `/entries/check-in` | Entries | check-in in two stations, Desk and Scrutineering (remembered per device), since they happen at different tables and scrutineering doesn't go in entry order: counts, the cars still open here, a search by number or name, the picked car with its next step as the big button. The desk takes transponders inline and offers Check in and pass |
| `/entries/:entryId` | Entries | one entry: crew with Edit, then the dialog's parts as cards (Crew, Car, Registration); Times per stage with position, gap and status, the overall standing; Penalties with what each costs and Add penalties. Result rows open it too |
| `/hardware` | Hardware | gate roster: online (heartbeat on hover), a version only when it differs from the server's, last read with the car it matched (gate and transponder tests before the rally), clock offset, add/delete, pairing (open for 10 minutes with a countdown on its button, waiting gates in the roster to accept or reject, a changed key in that gate's own row), shut down all gates; a row opens the gate. Gates known to this computer: add to this event, forget (standalone only) |
| `/hardware/gates/:gateId` | Hardware | one gate: status, clock, address with a link to its gate-config, version, rename; its assignments on every stage; its last 100 detections, live, with clock correction and what became of each |
| `/setup` | Setup | the event: rally details, file name, New / Open Event dialogs (standalone only); the rally status with what it locks, Start rally (behind the pre-start check), Close rally (confirmed, names the stages it closes), Reopen in ⋮ (confirmed); tiles to Stages, Classes, Start order, Scoring and Display. The app bar's cog links here |
| `/setup/stages` | Setup | stage list, create |
| `/setup/stages/:stageId` | Setup | edit stage (scoring included), its gate assignments (active state read-only) |
| `/setup/classes` | Setup | entry classes table: add/rename/delete, main class or category, entry count. Assigned on Entries |
| `/setup/start-order` | Setup | start order rules: grouping, key, direction. Later planned start times |
| `/setup/scoring` | Setup | notional time penalty; the penalty catalogue: types with their tiers and how they count (per stage or per rally), add/edit/delete (deleting takes its penalties) |
| `/setup/display` | Setup | Crew: name format and flags, with an example crew drawn with the unsaved settings; Results: podium. Switches, on screen only (printouts are plain PDFs) |
| `/setup/access` | Setup | invitations (role, stages, code, devices; Print one or all as a PDF sheet with the QR code, Block in ⋮), the devices that logged in (Block), the organiser password. Organiser only (`auth.md`) |
| `/public/:stageId?` | — | what anyone without a login sees, without the drawer: the stage track ending in Overall, the class filter; a stage's start list with each car's state and time (running ones ticking), then its results; or the overall, penalties as a sum. No print, no links to entries. No stage picks the active one. Every other page sends a browser without a login here |
| `/login` | — | who this browser is, Log out; an invitation code to type; the organiser password. `?setup=` from the server log sets the first one. The drawer's foot links here |
| `/join/:code` | — | what an invitation's QR code opens: logs the device in, then Live Timing |

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
- **The app bar** shows the open event, the rally status (a chip linking
  to Setup, where it changes), the server clock and the live
  stream's state (see `design-system.md` "App bar"). The state comes from the
  page's own stream (`liveStatus` in `api/live.ts`), never a second
  connection. The rally status rides on that stream too; a page without
  one refetches it on navigation.
- **Live Timing loads its data directly, not only when the live stream opens**:
  with enough tabs open the stream sits pending (six connections per host,
  `api.md` "Live").
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
  where a quiet gate's passings would scroll out. Live Timing has none: a
  marshal there needs runs and unassigned passings, not the feed behind them.
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
