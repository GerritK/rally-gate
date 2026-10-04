# Design System

Every Rally Gate web interface (`apps/web`, `apps/gate-config`) uses the
Vuetify setup in `packages/ui`: `createRallyVuetify()` (`vuetify.ts`), the
`rallyGateDark` theme (`theme.ts`, colour values only), self-hosted fonts
(`fonts.ts`) and shared CSS (`utilities.css`). Change things there, never
per app, so the two read as one product.

## Built for the field

These screens run on a marshal's laptop or tablet at a stage: in a tent or a
car, at night, on a closed network, glanced at between cars. That decides
most of what follows.

- **Dark first.** A daylight high-contrast variant (near-black background,
  pure white text, brighter borders) isn't built; add it as a second theme
  plus a switcher when it's needed.
- **Readable at arm's length.** The one value a marshal acts on gets real
  size: the next car's start number on Live Timing is 3.5rem. Don't shrink
  it to fit more on screen.
- **Nothing jumps mid-event.** A card that only sometimes has content stays
  in place and shows a short note when empty ("No car on stage.") instead of
  appearing and pushing everything below it while someone aims at a button.
- **Laid out like the stage.** Where the order of the course matters, the
  screen follows it: gates on a line start → splits → finish, Up next on the
  left, cars on stage to its right.
- **Offline.** No CDNs: fonts and icons are self-hosted (`@fontsource/*`,
  `@mdi/font`), since rally-site Wi-Fi is closed or absent.
- **A recurring element looks the same everywhere.** A start number, a
  crew name, a time, a status is drawn by one shared component or class
  (`StartNumber`, `PersonName`/`CrewName`, `ClassChip`, `.rg-timing`, the
  status chips)
  and never restyled per page. A page sets only the size, through the
  surrounding `font-size`. A marshal recognises a car by its plate and a
  name by its lettering, on any page; a second look for the same thing
  reads as a different thing. Plain-text spots (a select option, a
  tooltip) write a start number as `#12`.

## Colour

Values live in `theme.ts`. The rules:

- **Orange (`primary`) is rare:** the one main action on a page (Start now,
  Freeze start list) and the active nav item. The app bar is dark, not
  orange, for that reason.
- **Red (`error`) means a race problem:** DNF, a gate offline, a penalty, an
  abort. On the page surface (table rows, cards) nothing else is red, so a
  marshal scanning for trouble isn't misled.
  - Delete is never a visible button in a table row (see Tables), so it
    never competes with a DNF chip there.
  - Delete in a row's ⋮ menu or as a dialog's confirm button may be red.
  - Aborts stay red: Close stage, Shut down all gates.
- **Colour is never the only signal.** Red-green colour blindness is common,
  so every status pairs colour with an icon and text, and timing highlights
  (`timing-best`/`timing-personal`) get a second cue too.
- **A tooltip only where it adds something**, and then only an
  explanation (what an icon or state means) or an unimportant extra (the
  gap to the fastest, a heartbeat's clock time). Never for anything a
  marshal needs: a tooltip doesn't show on touch or on paper, and on a
  disabled button not at all (see Confirmations). A gate's problem state is
  a line of text under it. Never
  a tooltip repeating what's already on screen (a gate's name under it, a
  ★ the legend explains).
- **Text links are `.rg-link`** (`utilities.css`): the surrounding text's
  colour, underlined, never the browser's blue and purple, which clash with
  the theme and with an alert's own colour. One look for every inline link,
  a hint in an alert and a column header alike. Going somewhere from a
  hint is such a link, not a button; a button in an alert is an action
  (Retry now). Back buttons, nav and list items that navigate are
  Vuetify's and need nothing.
- **Tooltips are Vuetify's, never the browser's `title`**: one look and
  one delay everywhere. `v-tooltip:top="'…'"` on the element (the
  directive), `:bottom` in the app bar; a conditional one passes `''`, not
  `undefined`, which shows the element's own text. `title` stays only where
  it is a component's label prop (`v-list-item`, `FormDialog`).
- **A table with icons has a legend under it** (`TableLegend`), listing
  only the icons that table currently shows. Tooltips don't work reliably
  on touch and don't exist on paper, so the legend is what explains an
  icon; a tooltip only adds a value (the gap to the fastest). Icon, colour
  and label come from `TIMING_MARKS` (`format.ts`), for the cells and the
  legend alike.
- **Results show the time driven**, the gap to the fastest in its tooltip:
  a posted result and a protest go by the time, and a crew checks it
  against their stopwatch. The Gap column covers the comparison.
- **Semantic colours over hex:** `timing-*` and `flag-*` in the theme, so
  components say what they mean ("timing-idle"), not what they look like.
- **Borders** use the theme's `border-color` at full opacity. That's why
  `utilities.css` sets `v-divider` to it: the divider otherwise draws in the
  text colour and came out solid white.

## Type

- **Barlow** for body text, **Barlow Condensed** for headings, card and
  toolbar titles (set in `utilities.css`, since Vuetify's heading font only
  reaches its `text-h*` classes).
- **A section inside a card or dialog** (Driver, Co-driver, Car, Entry in
  the vehicle dialog; Crew, Results on Setup → Display) is headed with
  `.rg-section-title` (`utilities.css`): the card title's font a size down,
  so the title still leads, and from the second section on a rule above
  it. Not `text-overline`, which is too faint to divide a form; that stays
  for a small label inside a block (Live Timing's "Then"). Sections set
  side by side share one rule above their row.
- **Crew names** follow the event's name format (Setup → Display) everywhere
  (`personName` in `src/crew.ts`) and are lettered like a rally car's side
  window: flag, Barlow Condensed bold, capitals (`PersonName`). Upright:
  italics read worse at table size.
  Wherever a crew appears, it is both names in one cell (`CrewName`), the
  co-driver below the driver and smaller, so the driver leads.
- **Start numbers** are a door plate: black on white, Barlow Bold
  (`StartNumber`). A sans like a real plate, not `.rg-timing`'s mono; the
  plate's minimum width keeps a column aligned. Not WRC's fluorescent
  orange: orange is the page's main action.
- **`.rg-timing`** on every time: JetBrains Mono, tabular
  figures so live values don't reflow, slashed zero so 0 and O can't be
  confused at a glance.

## Layout

- **16px between cards**, everywhere.
- **Card rows are a CSS grid**, not `v-row`/`v-col`: their negative margins
  and column padding don't add up to the 16px used around them. Live
  Timing's Up next / On stage grid (1fr 2fr, stacked below 960px) is the
  pattern.
- **A row of many items scrolls sideways** rather than squeezing items out
  (the gate line keeps a minimum width per gate).
- **Phone and tablet:** check portrait tablet width (~820px). Long names
  truncate with an ellipsis and keep the full name in a tooltip.
- **A record's page is its parts as cards**, the same parts its edit
  dialog has (a vehicle: Crew, Car, Entry), under one card with what
  identifies it and the Edit button. Side by side as they fit, the cards of
  a row equally tall. Inside a card the facts are a `.rg-facts` list
  (`utilities.css`): label left, value right, `-` where nothing is set, so a
  gap shows instead of a row going missing.

## Status

- **A status is a chip:** colour, icon and label together. One mapping per
  concept, reused wherever that status shows: Live Timing's row states
  (`ROW_STATE_DISPLAY`) drive the table, the On stage card and the counters
  in the stage header.
- **Something waiting on a marshal shows where it happened**, not in a card
  of its own: every unidentified passing in On stage, a start included,
  since a car that crossed the start line is on stage, and Up next must not
  move while the start marshal aims at Start now (`PassingBlock`: warning
  stripe on the left, lightly tinted, the fields neutral). A card that appears and disappears pushes everything
  below it around mid-event; tinting a whole card made its fields hard to
  read.
- **Counts, not filters**, for a status overview: "2 On stage · 3 Waiting"
  as chips. The table stays complete and in start order.
- **The live connection** shows in the app bar: Live / Connecting / Offline,
  on pages with a live stream only. A silently dropped stream would leave
  stale times on screen.

## Time

- **The clock shown is the server's**, the one the gates sync to (app bar,
  `GET /time`). A marshal reads times off it; a tablet's own clock may be
  off by seconds.
- **Hand-set times are marked** (`ManualMark`, a hand icon): Start now,
  Finish now and corrections. They carry the marshal's reaction time, and a
  protest asks which times were hand-set.
- **Prefer an action to a typed time.** "Start now" / "Finish now" are
  stamped by the server. Typed times remain only for corrections and a
  missed start, and there a stage time ("3:12.4" off the stopwatch) derives
  the other end: a marshal knows that more reliably than a time of day.

## Editing

- **No inline editing.** A record is edited in a dialog when it is a few flat
  fields that fit on a tablet without scrolling, and on its own detail page
  when it has sub-lists (a stage and its gate assignments) or should be
  linkable. A field in a table cell that saves on change is one stray scroll
  wheel away from a changed result.
- **Actions with a parameter are not edits.** Picking the vehicle for an
  unassigned passing and pressing Assign stays in the row; a dialog there
  would only add clicks mid-event.
- **Creating works like editing**, with the same form component. A record
  with sub-lists is created in a dialog with its required fields only, then
  opens on its detail page: an empty "new" page whose lists can't be filled
  before the first save is a dead end.
- **Nothing saves on the fly.** A form saves on its Save button. The
  exception is a lone switch that is itself the setting (auto-discover
  gates): it applies at once, since one click puts it back.
- **Unsaved changes are never lost silently.** Leaving a page with a dirty
  form asks first (own dialog via the router guard). Closing or reloading
  the tab uses `beforeunload`, the one place the browser's own dialog is
  allowed: there is no other way to ask. A dialog with changes turns
  `persistent`, so Esc or a click outside asks instead of discarding.
- **Save shows `loading` and is disabled while the request runs**, so a
  double click can't create two vehicles.
- **After saving**, a dialog closes; a detail page stays open. Both confirm
  with a short snackbar.
- **Keyboard:** Enter saves, Esc cancels (asking first if there are changes).
- **Every input field looks alike**, typed or picked: text fields,
  selects, comboboxes and autocompletes are all outlined and the same
  height (`comfortable`), set once in `packages/ui` `vuetify.ts`. Vuetify's
  own default for the pickers is filled and a size taller, which reads as a
  different kind of field beside a text field. A field that sits in a row
  of buttons may go `compact` (the passing's vehicle picker).
- **Refused or just unusual.** A value the server refuses is an
  `error-messages` and Save won't help. One that is allowed but worth a
  second look (a transponder already on another car) is a `messages` with
  `.rg-field-warning` (`utilities.css`) in `warning`, and saves as usual:
  red there would read as refused.

## Tables

- **Times are right-aligned**, header and cell (`.rg-time` in
  `utilities.css`), so digits line up down a column. An icon qualifying a
  time (best, hand-set, notional) sits right after it in an `.rg-time-mark`
  slot. Every time in that column gets the slot, empty where there is no
  icon, so the times stay in line either way; the header too, or it ends
  a slot's width right of them.
- **A legend explains a table's icons** (`TableLegend`), only those the
  table actually shows: a legend listing absent icons is noise that gets
  skipped. Under the table; on Results it is the table's footer row.
- **Actions sit in the last column**, kept to its minimum width
  (`width="1%"`, `text-no-wrap`) so it really ends the row.
- **At most one direct action and one ⋮ menu** per row, either alone is
  fine. The direct action may depend on the row's state (Start now while
  waiting, Finish now on stage), but there is only ever one.
- **Delete is never the direct action**, it always goes in the menu: a lone
  visible delete button per row invites a slip on a tablet.
- **A menu has at least two entries**, otherwise its one entry becomes the
  direct action. Delete is the exception: a menu holding only Delete is
  fine, by the rule above.
- **A row with a detail page opens it on click**, so it needs no Edit
  button and the direct action stays free for the real one.
- **Add sits top right in the table card's title** (`#append`): visible
  without scrolling to the end of 80 vehicles, never moving as rows are
  added, and clearly tied to the list it fills.
  - Orange when adding is the page's main action (Vehicles, Stages), tonal
    otherwise (Add Assignment on a stage).
  - An empty table keeps its header and shows one `.rg-empty` row
    (`packages/ui` `utilities.css`: italic, centred, padded) that names it
    ("No vehicles yet. Add one with + Add Vehicle."), no second button in
    the middle. Not an alert: those are for states that need attention.
    The same class marks an empty card ("No car on stage."). Only a page
    with nothing to show at all (no stages, unknown gate) gets an alert.

## Confirmations

- **An action that can't run right now stays clickable and says why** when
  pressed (`notifyError`, or in the dialog it opens anyway): Shut down all
  gates during an active stage. A disabled button can't explain itself on
  touch, and a permanent caption beside it is noise for an exception.
  Disable only where the reason is already on screen beside it: Assign
  with no vehicle picked, a stage's Save under "This stage is ACTIVE…", a
  menu item with the reason as its subtitle.
- **Ask when data is lost that can't be retyped from the screen or from
  memory:** delete a run or a passing, close a stage, unfreeze a published
  start list, anything that takes other records with it. Say what will be
  lost, with numbers ("2 unassigned passings will be discarded"). Not every
  save: a confirmation on everything gets clicked through, and then it
  doesn't protect the delete either.
- **Ask before an action whose effect isn't on screen:** Disqualify (the
  car leaves every result, the cars behind move up), Freeze or Activate with
  cars not yet scrutineered (named by number). A status change that one
  click undoes doesn't ask.
- **Time-critical actions never ask:** Start now, Finish now. A dialog would
  add to the reaction time already in the hand time; a slip is fixed with
  Correct.
- Cheap-to-redo plan edits may skip it (deleting a gate assignment of a stage
  that hasn't started).

## Dialogs and feedback

- **Only our own dialogs**, never `alert()`/`confirm()`/`prompt()`: they look
  foreign and can't be styled or worded. `beforeunload` is the one exception
  (see Editing).
- **Shared dialogs wherever possible:** one confirmation dialog for both
  apps (`useConfirm()` from `packages/ui`, rendered by `RallyFeedback` once
  in each `App.vue`), not a hand-built `v-dialog` per page.
- **The confirm button names the action** ("Delete class", "Close stage"),
  never "OK". Cancel on the left, the action on the right.
- **Errors don't get a dialog.** An error from a form shows inside it
  (`v-alert`) so the input survives; an error from an action shows as a
  snackbar. That needs no `try`/`catch`: each app's `main.ts` sends every
  error Vue sees to `notifyError()`, and Vue sees a rejected promise from an
  event handler or lifecycle hook only if the handler returns it. A wrapper
  that calls an async function without `return` loses the error.
- **A snackbar belongs to the page it was raised on** and goes when the
  path changes (`clearNotice()` in `apps/web`'s `router.ts`). A query change
  such as the class filter keeps it, and so does a message raised after the
  navigation its own action triggered ("Stage added" on the new stage).
- **Dialogs go fullscreen on phones** (`:fullscreen="smAndDown"`), which is
  mostly `gate-config`.

## App bar

Same in both apps: dark and flat, the logo, then the context that matters,
status on the right.

- `apps/web`: the open event's name alone; the logo names the product (its
  alt text is "Rally Gate"). Right: live chip, server clock with date, a cog
  to Setup, separated by vertical dividers.
- `gate-config`: "Gate Config" small above the gate's name. That line names
  the tool, not the product: the two apps look alike on purpose, and a
  marshal switching between them on a phone needs to see which one is open.

## Logo

`packages/ui/src/logo.svg`, exported as `logoUrl`, sits left of the title in
both apps' app bar. It isn't an action, so its orange doesn't compete with a
page's main button. The favicons (`apps/web/public/favicon.svg`,
`apps/gate-config/web/public/favicon.svg`) are the same paths on a square
`#0B0D10` tile; change all three together. Printed PDFs carry it small beside
"Rally Gate" at the foot, in two greys (`LOGO_GREYS` in
`apps/web/src/pdf.ts`), drawn from the same file.

Rules the geometry follows, so an edit doesn't reintroduce the
inconsistencies the first draft had:

- One slant for every forward edge (dx/dy 0.64); the R's leg and the G's
  bottom-left chamfer share a second one (0.86), so they run parallel.
- One stroke width (72, measured perpendicular to the stroke), bars and
  slanted stems alike.
- Only the sides where R and G face each other are rounded: outer radius 52,
  inner 14, true circular arcs. Outer sides and stroke ends stay sharp. No
  sharp corner directly next to a rounded one.
- The G's top sits on the underside of the R's top bar; both share the
  baseline. The gap between the letters is constant along the whole seam.
- Colours are the theme's `primary` (`#FF6B00`) and `secondary` (`#00D3F2`).

## Print

Everything on paper is a PDF, built from the data by jsPDF +
`jspdf-autotable` in the browser (`apps/web/src/pdf.ts`, loaded only on
click): no server, works offline, no print CSS anywhere. The browser's print
can't paginate a table it doesn't know the page size for, and every attempt
to make it (measuring the screen, estimating the page) was a workaround; a
PDF lays out the pages itself, on A4 whatever the print dialog says. Ctrl+P
on a page prints the screen as it is, dark; anything meant for paper has a
button.

- Deliberately plain, for the notice board, but in the app's fonts:
  Barlow for text and JetBrains Mono for every time, so digits line up down
  a column as `.rg-timing` does on screen. Both are embedded (TTFs in
  `apps/web/src/assets/fonts`, fetched only on print), since the PDF base
  fonts know Western European letters only and one ř or Ł garbles a whole
  line. No flags, no podium. Fastest times bold, notional times in
  parentheses, a one-line legend at the foot of every sheet.
- Every sheet is headed with what it is (a ranking or "Start list — WP3 ·
  name"), the rally, the class filter or "Provisional", the part it holds
  ("Pos 16–18 · WP1–WP13", named only where it is actually split), and
  "3 / 4" top right, numbered per section; that number is the only "more
  follows", no "continues on" line repeating it. The foot has the legend
  and below it, in grey, the logo with "Rally Gate" on the left and when it
  is from on the right (a start list's publish time, the print time by the
  server clock). "Print all" puts every ranking in one PDF, each
  starting a new sheet.
- Results: Pos/#/Crew and the totals (Total, Gap, Stages) come first and
  repeat on every sheet, so each sheet is a complete standing; a vertical
  line sets them apart from the stage times, which follow and split across
  sheets. Sheets go across first, then down
  (`horizontalPageBreakBehaviour: 'immediately'`), so they hang as a grid.
- The start list: Pos, #, Crew, Car (body above chassis), Class when not
  grouped; main classes as full-width header rows, posted top to bottom.
- Portrait unless a table needs the width, decided from the measured
  column widths, not a column count.
- Every table spans the sheet: the columns get their measured content
  width and the text columns (Crew, Car) share the rest, so times stay
  together on the right. A table too wide for one sheet is split evenly,
  the same number of stage columns on each sheet, widened to fill it,
  rather than autotable's greedy split that leaves a lone column on the
  last sheet.
- Nothing runs off the sheet: the heading is cut short before "x / y",
  the details line and the legend wrap onto a second line. Widths carry 0.2 mm of slack (`SLACK`) against floating-point
  rounding, so a time never wraps by a hair.
- It opens in a new tab, to print, save or share; the tab is opened by the
  click itself, since one opened after an `await` is a blocked popup.

## Shared components (`apps/web/src/components`)

Extract a component once it is actually used twice, not before.

- `StagePicker`: the rally's progress as a track of stages, the same
  picture as the gate line one level up: closed ✓, running ● (green),
  upcoming ○. The shapes differ, so the status needs no label. Progress
  first, selection second: a neutral ring marks the stage shown, a click
  switches. Stage details such as a published start list belong in the
  stage's own header, not on the track. It sits above every card, since the
  stage scopes the whole page. Each stage is labelled by its id alone (the
  organiser's own code, "WP3"), the same as the overall table's columns; a
  name truncates at track width, so it goes in the tooltip and in the
  stage's header as "WP3 · Waldweg Nord". Live Timing and both Results
  pages. On
  Results the track ends in **Overall** (`overall` prop): a checkered flag
  behind a dashed last leg, since the overall is a result and not another
  stage. It is ringed on the overall page, so the track is the one switch
  between all results.
- `ClassPicker`: one classes field, main class first and exclusive, for
  assigning classes on Vehicles.
- `ClassFilter`: the Results filter, one click per choice. A row of main
  classes (exactly one, "All" by default) and a row of categories (any
  number), ANDed as the server filters. The selection lives in
  `?classes=` (`useClassQuery`), so it carries between Overall and a stage.
  Every results card names it as its subtitle, "All classes" included, and
  so does every printed sheet.
- `StartNumber`: the door plate, sized by the surrounding font.
- `CrewName`: the crew, driver above a smaller co-driver; every table's
  Crew column, Live Timing's Up next and On stage, the vehicle page. Built
  from `PersonName`, one person's flag and name per the Display settings
  (`useDisplay()`: the event's, or what a page provides under `DISPLAY`;
  Setup → Display provides its unsaved form, so its example crew shows a
  change before it is saved).
  No flag chosen shows the chequered flag. Flags are `flag-icons` (4:3) plus
  our own in `src/assets/flags`, all freely usable (`THIRD_PARTY_NOTICES.md`);
  never flag emoji, which Windows renders as two letters.
- `ClassChip`: a vehicle class, main classes in secondary with a star.
  Live Timing puts a car's main class at the right of Up next and Then.
- `ResultsPodium`: the first three of a ranking above its table, steps
  2-1-3, trophies in `podium-gold`/`-silver`/`-bronze` (`theme.ts`, used
  nowhere else). A click opens the vehicle, as a row does.
- `VehicleDialog`: add and edit a vehicle, on Vehicles and the vehicle's page.
- `VehicleStatusActions`: a vehicle's status changes, the next step as the
  direct action and the rest in ⋮ (`statusActions` in `vehicle-status.ts`).
  Small in a table row (with a short label, "Passed", the full one its
  tooltip), `large` in the check-in card's footer. There `alsoShow` puts
  further steps beside the next one, `withStep` saves fields with a step
  forward. Only Disqualify asks first.
- `ManualMark`: the hand-timed icon.
- `TableLegend`: the icons a table shows, explained under it (see Tables).
- `PassingBlock`: the oldest unidentified passing with its vehicle picker,
  Assign and a ⋮ for Not a car, in On stage; later ones wait
  below it as a count; "Dismiss all" (confirmed) discards it and them.
- `GateClockChips`: a gate's measured offset (tooltip says whether it is
  being corrected) and chrony state, on Hardware and the gate's page.
- `FormDialog`: every add/edit dialog. Saves on its submit (Enter), shows
  `loading` while saving, keeps a server error inside the dialog, asks
  before Esc/outside/Cancel throws away changes, confirms with the snackbar
  and goes fullscreen on phones. The page passes the draft and a `save`
  function that throws on failure. A long form goes wide rather than tall
  (`maxWidth`): `VehicleDialog` sets its sections in pairs, Driver |
  Co-driver and Car | Entry, one column on a phone, so it fits a laptop
  screen without scrolling. Before it outgrows that, its editing moves to
  the record's page.
