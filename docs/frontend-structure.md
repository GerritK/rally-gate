# Frontend Structure

Built — see [development-roadmap.md](development-roadmap.md) "Done" for the
verification summary. This doc records the reasoning behind the route/nav
split so it doesn't need re-deriving later. Audience is the marshal/organizer
team only — no public/spectator view (see `deployment-modes.md` "Future:
online/spectator mode", still deliberately deferred).

## Why

`App.vue` today stacks every section vertically on one page (Stage/Split/Overall
Classification, Stage Runs + corrections, Gates, Gate Assignments, Live
Detections). It grew there incrementally across the Vuetify migration. This
plan splits it into `vue-router` pages under one Vuetify nav, grouped by the
question each page answers rather than by "what happened to be built in what
order."

## Route list

| Route | Section | Contents | Status |
|---|---|---|---|
| `/` | — | redirect to `/live` | new |
| `/live` | **Live Timing** | Live Detections feed, Stage Runs table (Correct/Delete/Add Missing Run inline, as today), Close Stage action | reorganized |
| `/results/overall` | **Results** | Overall Classification | reorganized |
| `/results/stages/:stageId` | **Results** | Stage Classification, Split Classification, DNF/DNS — stage picked via route param (bookmarkable), not a client-side dropdown like today | reorganized |
| `/setup` | **Setup** | Rally name/details (edit) + a link tile to Stages. A checklist landing page, not a duplicate of those pages | **new** |
| `/setup/stages` | **Setup** | Stage list, create new stage | reorganized + new create form |
| `/setup/stages/:stageId` | **Setup** | Edit stage name/number, plus that stage's gate assignments (assign a gate as start/finish/split, activate/deactivate/delete) | reorganized (replaces the old flat "Gate Assignments" table) |
| `/hardware` | **Hardware** | Gate roster: identity, online/offline, heartbeat, capabilities, current active assignment (gate-centric cross-stage view) | reorganized |
| `/vehicles` | **Vehicles** | Registered vehicles/drivers list + add/edit form | **new UI** (backend `POST /vehicles` already exists, nothing calls it today) |

5 top-level nav items: Live Timing, Results, Setup, Hardware, Vehicles.

## Key decisions and why

- **Split Classification lives in Results, not Live Timing**, even though it
  ranks in-progress (`STARTED`) runs too. It answers "who's winning," same
  question as Stage/Overall Classification — just at a mid-stage checkpoint.
  Live Timing answers "what's happening at the gates right now."
- **Gate assignment is nested under its stage** (`/setup/stages/:stageId`),
  not a flat cross-stage table. `GateAssignment.stageId` is the real owning
  relationship — a stage needs a start/finish/split plan, that's part of the
  stage's setup. The flat "what's every gate doing across the whole event"
  view moves to Hardware instead (gate-centric: each gate row shows its
  current active assignment), so that question is still answerable, just
  from the other entity's page.
- **Hardware and Vehicles are their own top-level nav items, not nested
  under Setup**, even though they're part of pre-event prep. Both get used
  operationally too (checking gate health mid-event, registering a late
  entry mid-event), so burying them under "Setup" would misrepresent their
  ongoing relevance. `/setup` does **not** also link to them — they're
  always one click away in the nav drawer, so a shortcut tile to the same
  page would just be a second path to the same place. (It originally did
  link to both; dropped after it started to feel redundant in practice —
  see "Build notes".) Stages is different and still gets a tile: it has no
  top-level nav item of its own, so `/setup` is the only way to reach it.
- **No results-export/printable view yet** — `/results` can grow a
  print-friendly variant later without restructuring.
- **Nav is `v-navigation-drawer`, not top tabs.** 5 items today is thin
  justification for a drawer on its own, but more nav-worthy sections are
  expected (see roadmap), and a drawer doesn't need reworking when that
  list grows the way a tab bar would.
- **No new store (Pinia etc.) as part of this split.** Today one
  `<script setup>` shares refs (`stages`, `gates`, `vehicles`, ...) across
  every section for free; once those live in separate route components,
  each page fetches what it needs in its own `onMounted`, same pattern as
  today, just per-page instead of per-app. Rally data volumes are tiny (see
  the gate-assignments filtering note below), so refetching per page isn't
  a real cost. Only reach for a shared store if duplicate fetches become an
  actual, visible problem.
- **Don't pre-build a `components/` hierarchy while splitting.** One `.vue`
  file per route, moving markup as-is. Extract a shared component only once
  something is actually duplicated across two pages (e.g. a gate status
  chip, if Hardware and Live end up rendering one identically) — not
  speculatively as part of the split.

## New backend piece: RallyInfo (scoped, small)

No `Event`/`Rally` entity exists today — per `architecture.md`, one database
*is* one event on purpose (no multi-tenant table). But nothing holds a
label for *this* event, so `/setup` has nothing to show/edit. Needs a
singleton settings row, same "one DB = one event" philosophy, not a rename
of that decision:

- New module `apps/rally-server/src/modules/rally-info/` — entity, service,
  controller, following the existing module shape (see `vehicles/` for the
  simplest comparable example).
- Entity: fixed singleton row (e.g. `@PrimaryColumn() id: string` always
  `'rally'`, hidden from the API — never exposed as a route param, unlike
  `Stage`/`Gate` which use caller-supplied ids for real multi-row tables).
  Fields: `name: string`, `date?: string`, `location?: string`. Add more
  only when something actually needs them — this is deliberately minimal.
- Endpoints: `GET /rally-info` (returns the row, or `null` before it's ever
  been set), `PUT /rally-info` (upsert, same pattern as `PUT /stages/:id`
  minus the id param since there's only ever one row).
- Frontend: `api.ts` gets `fetchRallyInfo`/`saveRallyInfo`; `/setup` page
  shows the name (falls back to "Unnamed Rally" or similar until set) with
  an edit form.

## Other things this plan surfaces (not building yet, just noting)

- **Stage creation needs an ID field in the form**, not just name/number —
  `PUT /stages/:id` takes a caller-supplied id (e.g. `WP1`, `SS2`), Stage
  has no auto-generated id. Same for a "create gate" form if one's ever
  needed (`PUT /gates/:id`) — though gates auto-create from their first
  heartbeat already, so this is lower priority, manual creation is really
  just for pre-registering a gate before it's powered on.
- `GET /gate-assignments` only filters by `gateId` today, not `stageId` —
  fine to filter client-side for `/setup/stages/:stageId` given the data
  volume (a rally has a handful of stages/gates); add the query param only
  if that ever actually matters.

## Build notes

All of the above is built. A few things that came up during the split,
worth knowing if this area changes again:

- `apps/web/src/format.ts` holds the pure formatting/lookup helpers
  (`formatDuration`, `stageName`, `isOnline`, etc.) shared across pages —
  extracted once splitting `App.vue` actually required sharing them, not
  ahead of time.
- Each page fetches its own reference data (`stages`, `gates`, `vehicles`)
  in its own `onMounted`, same pattern `App.vue` used — no shared store.
  Revisit only if duplicate fetches become an actual, visible problem.
- `/results/overall` and `/results/stages/:stageId` cross-link to each
  other (a stage-jump select on Overall, an "Overall Classification" link
  on the stage page) since the doc's route split otherwise left no way to
  navigate between them from the UI.
- Stage creation needed the caller-supplied `id` field flagged in the
  original plan (`SetupStagesView.vue`) — `PUT /stages/:id` takes it, no
  auto-generated id.
- `/setup`'s Gates/Drivers shortcut tiles (to Hardware/Vehicles) were
  removed after they started to feel redundant with the nav drawer, which
  already reaches both permanently. Only the Stages tile survives, since
  Stages has no nav-drawer entry of its own.
