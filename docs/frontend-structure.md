# Frontend Structure

`apps/web`: a `vue-router` app behind a `v-navigation-drawer`, one `.vue` file
per route in `src/pages/`, API calls in `src/api/` (one module per entity,
sharing `client.ts`). Audience is marshals and organisers; anyone without a login gets `/public`
only (`auth.md` "Who sees what"), who may change what is `auth.md` too.

| Route | Nav | Contents |
|---|---|---|
| `/` | — | redirect to `/live` |
| `/live/:stageId?` | Live Timing | the marshal view, laid out like the stage: gates, Up next beside On stage, the start list with every run, corrections, penalties, DNF/DNS, Activate / Close (decisions below). No stage picks the active one, else the next |
| `/results/overall` | Results | podium, overall classification, each stage column the time driven, the fastest marked, the gap to it in the tooltip, its header linking to that stage's results, a Penalties column once anyone has one, filterable by class; Print / Print all open a PDF (Print all: every class's ranking on its own sheets) |
| `/results/stages/:stageId` | Results | podium, stage classification with a column per split (the time and its rank, the fastest marked, the gap to it in the tooltip), DNF/DNS; class filter and printing as on Overall |
| `/entries` | Entries | registration in a dialog, status, classes; per row the status's next step (Check in, Passed) and ⋮ for the rest (back a step, Withdraw, Disqualify, Reinstate); Check-in in the header; a row opens the entry |
| `/entries/check-in` | Entries | check-in in two stations, Desk and Scrutineering (remembered per device), since they happen at different tables and scrutineering doesn't go in entry order; the picked car's next step is the big button. The desk takes transponders inline and offers Check in and pass |
| `/entries/:entryId` | Entries | one entry: crew with Edit, then the dialog's parts as cards (Crew, Car, Registration); Times per stage with position, gap and status, the overall standing; Penalties with what each costs and Add penalties. Result rows open it too |
| `/hardware` | Hardware | gate roster: health, one clock chip saying in sync, imprecise or out of sync (the worse of measured offset and chrony, both values in its tooltip and on the gate's page), last read with the car it matched (gate and transponder tests before the rally), pairing, shut down all gates; a row opens the gate. Gates known to this computer: add to this event, forget (standalone only) |
| `/hardware/gates/:gateId` | Hardware | one gate: status, clock, address with a link to its gate-config, version, rename; its assignments on every stage; its last 100 detections, live, with clock correction and what became of each |
| `/setup` | Setup | the event: rally details, file name, New / Open Event dialogs (standalone only); the rally status with what it locks, Start rally (behind the pre-start check), Close rally (confirmed, names the stages it closes), Reopen in ⋮ (confirmed); tiles to Stages, Classes, Start, Scoring and Display. The app bar's cog links here |
| `/setup/stages` | Setup | stage list, create |
| `/setup/stages/:stageId` | Setup | edit stage (scoring and start mode included, a timetable's first start and interval), its gate assignments (active state read-only) |
| `/setup/classes` | Setup | entry classes table: add/rename/delete, main class or category, entry count. Assigned on Entries |
| `/setup/start` | Setup | start order rules: grouping, key, direction; countdown, jump-start tolerance and penalty (a catalogue type, or none), minimum gap between manual starts (`event-model.md` "Start slots") |
| `/setup/scoring` | Setup | notional time penalty; the penalty catalogue: types with their tiers and how they count (per stage or per rally), the jump-start one marked and linking to Start, add/edit/delete (deleting takes its penalties) |
| `/setup/display` | Setup | Crew: name format and flags, with an example crew drawn with the unsaved settings; Results: podium. Switches, on screen only (printouts are plain PDFs) |
| `/setup/access` | Setup | invitations (role, stages, code, devices; Print one or all as a PDF sheet with the QR code, Block in ⋮), the devices that logged in (Block), the organiser password. Organiser only (`auth.md`) |
| `/public/:stageId?` | — | what anyone without a login sees, without the drawer: the stage track ending in Overall, the class filter; a stage's start list with each car's state and time (running ones ticking), then its results; or the overall, penalties as a sum. No print, no links to entries. No stage picks the active one. Every other page sends a browser without a login here |
| `/login` | — | who this browser is, Log out; an invitation code to type; the organiser password. `?setup=` from the server log sets the first one. The drawer's foot links here |
| `/join/:code` | — | what an invitation's QR code opens: logs the device in, then Live Timing |

## Decisions

- **The start list is Live Timing's backbone**, not a page of its own: one row
  per entry in start order, runs merged in, main classes as header rows.
  Printed as a PDF (`design-system.md` "Print"). Its rules are configured
  under Setup.
- **On a slot stage Up next becomes the start card**, not a page of its own:
  at a casual meet one laptop does everything, and a page of its own would
  have the marshal switching pages for every car; at a formal one the tablet at the line
  and the timing tent each show their own screen anyway. The card shows the
  running countdown (the slot's clock time until `countdownMs` before it, then the seconds, on the five start lights, which run the last 5 s alone and stay there grey on a slot stage so the card never grows), a timetable's Delay once as a note, and the queue with slot
  times, with Countdown, Cancel, New slot and Delay on it. Fullscreen shows
  only the card, big enough for a tablet at the line; it is its own
  component so a screen device (`ideas/output-devices.md`) can reuse it
  without buttons. Browsers play no sound before a tap on the page, and a
  tap at the pre-start gate or a timetable is none, so the card says
  "Enable sound" after every load until tapped; Countdown counts as the tap.
  Jump starts are marked on the car's row (On stage and the start list),
  where penalties are given.
- **DNF and DNS sit in the ⋮ menus where the car is**, not on a button: DNF
  in the On stage row and in the start-list row while the car is on stage,
  DNS in Up next (the start card on a slot stage, each row) and in the
  start-list row of a car without a run; Undo in the same start-list menu
  until the stage closes. Both confirm with the car named on the button
  ("DNF #12"), since the effect (out of On stage, out of Up next) is easily
  missed; undo doesn't. The menu entry isn't red, only the DNF chip it
  leads to (`design-system.md` "Colour"). No reason
  field and no "withdraw too?": a car that won't drive again is withdrawn at
  the desk.
- **Up next keeps its layout in every start mode; only the buttons change**
  (`UpNextCard`): Start now in `GATE` mode; Countdown in `SLOT_MANUAL`, in
  the same place, and while the first car counts down its seconds, lights and
  Cancel there. Queued cars lead the list, each "Then" row with its slot time
  and Cancel, the others with a small Countdown. In `SLOT_SCHEDULE` New slot
  takes Countdown's and Cancel's places and Delay sits in the header; before
  activation the rows show their slot from the start list, no countdown.
  Fullscreen and Enable sound sit in the card's header. On a timetable a car is waiting, not counting down, until `countdownMs` before its slot.
  Live Timing's Start column shows a timetable's slot (the slot is the start
  time), its rows staying in start-order position; a slot moved by New slot is
  bold with an icon, on the printed list bold with an arrow. The public start
  list shows a Slot column once a timetable's list is frozen. A car seen at a pre-start gate gets an "At the
  start" chip (a flag icon in a "Then" row); a car not seen gets nothing, and
  the order stays the start order.
- **Overall and a stage's results are one page** (`ResultsView`), two
  URLs: track, class filter, card header, Print and "Print all" exist once.
  Only the table differs (`OverallRanking`, `StageRanking`), since the
  columns and the second table (not classified vs. DNF/DNS) really differ.
- **The app bar** (`design-system.md` "App bar"): the live state comes from
  the page's own stream (`liveStatus` in `api/live.ts`), never a second
  connection. The rally status rides on that stream too; a page without
  one refetches it on navigation.
- **Live Timing loads its data directly, not only when the live stream opens**:
  with enough tabs open the stream sits pending (six connections per host,
  `api.md` "Live").
- **Splits are columns of the stage classification**, not a ranking of their
  own: Results is read after the stage, so a car still on stage has no row.
  Mid-stage, Live Timing's On stage card shows each car's split against the
  best. A DNF's splits no longer count towards a split's rank or best, from
  the moment it is marked.
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
  every crew name on every page reads them. Shared components:
  `design-system.md`; shared pure helpers: `src/format.ts`.
- **New / Open Event live in Setup**, on the rally details card: the details
  are the event, and switching is a before-the-event action (refused while a
  stage is active), so it has no nav entry. Known gates are on Hardware,
  where gates are looked for.
- **Switching events reloads the whole app** rather than refetching: every
  page holds the old event's data, and there is no store to reset.
