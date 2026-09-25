# Frontend Structure

`apps/web`: a `vue-router` app behind a `v-navigation-drawer`, one `.vue` file
per route in `src/pages/`, API calls in `src/api/` (one module per entity,
sharing `client.ts`). Audience is marshals and organisers only.

| Route | Nav | Contents |
|---|---|---|
| `/` | — | redirect to `/live` |
| `/live` | Live Timing | unassigned passings (assign a vehicle), detections feed, stage runs with corrections, Activate / Close Stage |
| `/results/overall` | Results | overall classification |
| `/results/stages/:stageId` | Results | stage, split and DNF/DNS classification |
| `/setup` | Setup | rally name/details, tiles to Stages and Scoring |
| `/setup/stages` | Setup | stage list, create |
| `/setup/stages/:stageId` | Setup | edit stage, its gate assignments (active state read-only) |
| `/setup/scoring` | Setup | notional time penalty; later classes/penalties |
| `/hardware` | Hardware | gate roster: online, heartbeat, clock offset, active assignment, add/rename/delete, auto-discovery toggle |
| `/vehicles` | Vehicles | registration, inline editing, status |

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
  duplicated. Shared pure helpers are in `src/format.ts`.
- Stage ids are caller-supplied (`WP1`, `SS2`), so the create form has an id
  field.
