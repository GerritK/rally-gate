# API

`rally-server`, port 57430. **Every path is under `/api`**, because the same
port serves the built dashboard and `/vehicles` is both a page and a resource.
Anything outside `/api` that isn't a file returns `index.html`.

| Endpoint | Methods | Notes |
|---|---|---|
| `/gates` | GET, `/:id` GET/PUT/DELETE | hardware identity only (PUT sets the name). Auto-created from a first heartbeat unless `autoDiscoverGates` is off |
| `/gate-assignments` | GET, POST, `/:id` DELETE | the (gate, stage, role, splitIndex) plan. `active` is not settable — activation is per stage |
| `/vehicles` | GET, POST, `/:id` GET/PATCH | `startNumber` is unique, POST/PATCH 409 on a clash |
| `/stages` | GET, POST, `/:id` GET/PUT/DELETE | sorted by `stageNumber`; `status` is server-owned |
| `/stages/:id/activate` | POST | activates the stage's gate assignments. 409 `{ conflictingStageIds }` if a gate is active elsewhere (`?force=true` closes that stage), 409 if already `CLOSED` |
| `/stages/:id/close` | POST | deactivates its gates, marks it `CLOSED`. Terminal |
| `/stage-runs` | GET, POST, `/:id` PATCH/DELETE | POST/PATCH/DELETE are manual corrections. POST 409s while a non-voided attempt exists. GET includes voided attempts |
| `/stage-runs/:id/void`, `/unvoid` | POST | red flag / reverse it — see "Voiding" in `event-model.md`. Unvoid 409s with `{ blockingAttempt }` |
| `/stage-runs/:id/splits` | GET | ordered by `splitIndex` |
| `/events` | GET | recent detections |
| `/events/pending` | GET, `/retry` POST | detections whose rules threw; retried every 30s, POST forces it and returns `{ recovered }` |
| `/classification/overall` | GET | closed stages only, with notional times — see `event-model.md` |
| `/classification/stages/:stageId` | GET | ranked with gaps |
| `/classification/stages/:stageId/split-gates` | GET | the stage's split points |
| `/classification/stages/:stageId/splits/:splitIndex` | GET | live, includes `STARTED` runs, excludes `CANCELLED` |
| `/classification/stages/:stageId/non-finishers` | GET | DNF; DNS only once the stage is `CLOSED` |
| `/rally-info` | GET, PUT | the event's name/details; singleton, since one database is one event |
| `/settings/:key` | GET, PUT | `autoDiscoverGates`, `clockCorrectionThresholdMs`, `notionalPenaltyMs` |

Every mutating endpoint binds a DTO class, and unknown fields are a 400 — see
`CLAUDE.md` for which fields are deliberately absent.

Live (SSE, plain `EventSource`), each resynced by a refetch in `onopen`:

- `/live/detections`, `/live/stage-runs`, `/live/stage-run-splits`
- `/live/gates` — a `Gate` on each heartbeat
- `/live/pending-detections` — the whole pending list on every change, not a
  delta

A gate's own configuration is not here: `apps/gate-config` serves it on the gate
itself, port 57439 (`/api/config`, `/api/status`, `/api/network`,
`/api/network/reset`) — see `gate-config-ui.md`.
