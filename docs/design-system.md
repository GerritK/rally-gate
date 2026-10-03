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
- **Semantic colours over hex:** `timing-*` and `flag-*` in the theme, so
  components say what they mean ("timing-idle"), not what they look like.
- **Borders** use the theme's `border-color` at full opacity. That's why
  `utilities.css` sets `v-divider` to it: the divider otherwise draws in the
  text colour and came out solid white.

## Type

- **Barlow** for body text, **Barlow Condensed** for headings, card and
  toolbar titles (set in `utilities.css`, since Vuetify's heading font only
  reaches its `text-h*` classes).
- **`.rg-timing`** on every time and start number: JetBrains Mono, tabular
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

## Status

- **A status is a chip:** colour, icon and label together. One mapping per
  concept, reused wherever that status shows: Live Timing's row states
  (`ROW_STATE_DISPLAY`) drive the table, the On stage card and the counters
  in the stage header.
- **A card that only appears when something needs a marshal** (unassigned
  passings) gets a warning-tinted header band with a warning underline; the
  table and fields below stay neutral. Tinting the whole card made every
  field in it hard to read, a warning frame around it looked crude.
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
  stamped by the server. Typed times remain only for corrections.

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

## Tables

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
  - An empty table's note names it ("No vehicles yet. Add one with
    + Add Vehicle."), no second button in the middle.

## Confirmations

- **Ask when data is lost that can't be retyped from the screen or from
  memory:** delete a run or a passing, close a stage, unfreeze a published
  start list, anything that takes other records with it. Say what will be
  lost, with numbers ("2 unassigned passings will be discarded"). Not every
  save: a confirmation on everything gets clicked through, and then it
  doesn't protect the delete either.
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
`#0B0D10` tile; change all three together.

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

- `window.print()` and print styles, no PDF library.
- `utilities.css` flips the theme to black on white (the theme class is set
  on every component, so the override targets all of them), hides the app
  shell and drops `color-scheme: dark`, which otherwise paints the page
  margins.
- A page prints by hiding what isn't for paper with Vuetify's
  `d-print-none`, and showing print-only parts with `d-none d-print-*`.
  An element with its own `display` (a grid) overrides `d-print-none` and
  needs its own `@media print` rule.
- Live Timing prints as the posted start list: position, number, driver,
  co-driver, class header rows, the published time.

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
  Every results card names it as its subtitle, "All classes" included, so
  a printout always says which ranking it is.
- `ManualMark`: the hand-timed icon.
- `GateClockChips`: a gate's measured offset (tooltip says whether it is
  being corrected) and chrony state, on Hardware and the gate's page.
- `FormDialog`: every add/edit dialog. Saves on its submit (Enter), shows
  `loading` while saving, keeps a server error inside the dialog, asks
  before Esc/outside/Cancel throws away changes, confirms with the snackbar
  and goes fullscreen on phones. The page passes the draft and a `save`
  function that throws on failure.
