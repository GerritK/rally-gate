# Frontend Structure

`apps/web`: a `vue-router` app behind a `v-navigation-drawer`, one `.vue` file
per route in `src/pages/`, API calls in `src/api/` (one module per entity,
sharing `client.ts`). Audience is marshals and organisers only.

| Route | Nav | Contents |
|---|---|---|
| `/` | — | redirect to `/live` |
| `/live` | Live Timing | unassigned passings (assign a vehicle), detections feed, stage runs with corrections, Activate / Close Stage |
| `/results/overall` | Results | overall classification, filterable by class |
| `/results/stages/:stageId` | Results | stage, split and DNF/DNS classification, filterable by class |
| `/vehicles` | Vehicles | registration, inline editing, status, classes |
| `/hardware` | Hardware | gate roster: online, heartbeat, clock offset, active assignment, add/rename/delete, auto-discovery toggle; gates known to this computer: add to this event, forget (standalone only) |
| `/setup` | Setup | the event: rally details, file name, New / Open Event dialogs (standalone only); tiles to Stages, Classes and Scoring. The app bar shows the open event and links here |
| `/setup/stages` | Setup | stage list, create |
| `/setup/stages/:stageId` | Setup | edit stage, its gate assignments (active state read-only) |
| `/setup/classes` | Setup | vehicle classes table: add/rename/delete, main class or category, vehicle count. Assigned on Vehicles |
| `/setup/scoring` | Setup | notional time penalty; later penalties |

## Decisions

- **Split classification is under Results**, although it ranks running cars: it
  answers "who's winning", Live Timing answers "what's happening at the gates".
- **Gate assignments live under their stage**; the gate-centric view of "what
  is every gate doing" is the Hardware page.
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
  `onMounted`; data volumes are tiny. Extract a component once it is actually
  duplicated (`src/components/ClassPicker.vue`, one classes field
  with the main class first and exclusive, used on Vehicles and both Results
  pages). Shared pure helpers are in `src/format.ts`.
- **New / Open Event live in Setup**, on the rally details card: the details
  are the event, and switching is a before-the-event action (refused while a
  stage is active), so it has no nav entry. Known gates are on Hardware,
  where gates are looked for.
- **Switching events reloads the whole app** rather than refetching: every
  page holds the old event's data, and there is no store to reset.
- Stage ids are caller-supplied (`WP1`, `SS2`), so the create form has an id
  field.
