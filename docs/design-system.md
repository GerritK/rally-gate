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
  - Delete in a table row is neutral; the confirmation protects it.
  - Delete behind a menu (the ⋮ on a run) or as a dialog's confirm button may
    be red: nothing there competes with a DNF chip.
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

## Confirmations

- **Destructive and irreversible actions ask first:** delete a run, close a
  stage, unfreeze a published start list. Say what will be lost, with
  numbers ("2 unassigned passings will be discarded").
- **Time-critical actions never ask:** Start now, Finish now. A dialog would
  add to the reaction time already in the hand time; a slip is fixed with
  Correct.
- Cheap-to-redo plan edits may skip it (deleting a gate assignment of a stage
  that hasn't started).

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
  stage scopes the whole page. Live Timing and stage Results.
- `ClassPicker`: one classes field, main class first and exclusive. Vehicles
  and both Results pages.
- `ManualMark`: the hand-timed icon.
