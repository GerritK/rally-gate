# API

`rally-server`, port 57430. **Every path is under `/api`**, because the same
port serves the built dashboard and `/vehicles` is both a page and a resource.
Anything outside `/api` that isn't a file returns `index.html`.

| Endpoint | Methods | Notes |
|---|---|---|
| `/version` | GET | `{ version }`, the server's build — see "Gate discovery & heartbeat" in `architecture.md` |
| `/gates` | GET, `/:id` GET/PUT/DELETE | hardware identity only (PUT sets the name). Auto-created from a first heartbeat unless `autoDiscoverGates` is off |
| `/gates/power-off` | POST | shuts down every online gate through its gate-config; one `{ gateId, ok, message? }` per gate. 409 while a stage is active |
| `/gate-assignments` | GET, POST, `/:id` DELETE | the (gate, stage, role, splitIndex) plan. `active` is not settable — activation is per stage |
| `/vehicles` | GET, POST, `/:id` GET/PATCH | `startNumber` is unique, POST/PATCH 409 on a clash. Classes are written as `classIds` (replaces the list, 400 on an unknown id) and read back as `classes` |
| `/vehicle-classes` | GET, POST, `/:id` PUT/DELETE | `{ name, main? }`, name unique (409), main classes listed first. DELETE takes the class off its vehicles |
| `/stages` | GET, POST, `/:id` GET/PUT/DELETE | sorted by `stageNumber`; `status` is server-owned |
| `/stages/:id/activate` | POST | activates the stage's gate assignments. 409 `{ conflictingStageIds }` if a gate is active elsewhere (`?force=true` closes that stage), 409 if already `CLOSED` |
| `/stages/:id/close` | POST | deactivates its gates, marks it `CLOSED`. Terminal |
| `/stages/:id/start-order` | GET | `{ frozen, frozenAt, grouped, entries }`; computed live until frozen. See `event-model.md` "Start order" |
| `/stages/:id/start-order/freeze` | POST | stores the snapshot; no-op if already frozen (activation also freezes) |
| `/stages/:id/start-order/unfreeze` | POST | back to live; 409 unless the stage is `NOT_STARTED` |
| `/stage-runs` | GET, POST, `/:id` PATCH/DELETE | POST/PATCH/DELETE are manual corrections. POST 409s while a non-voided attempt exists. GET includes voided attempts; `?stageId=` narrows to one stage |
| `/stage-runs/splits?stageId=` | GET | every split of every attempt on the stage, one request per page |
| `/stage-runs/:id/void`, `/unvoid` | POST | red flag / reverse it — see "Voiding" in `event-model.md`. Unvoid 409s with `{ blockingAttempt }` |
| `/stage-runs/:id/splits` | GET | ordered by `splitIndex` |
| `/events` | GET | recent detections |
| `/events/awaiting-vehicle` | GET | unassigned passings (no transponder) at live gates, oldest first |
| `/events/:eventId/assign` | POST `{ vehicleId }` | times the passing as that vehicle; 409 when the rules would do nothing (e.g. finish before start) |
| `/events/:eventId/dismiss` | POST | the passing was no car |
| `/events/pending` | GET, `/retry` POST | detections whose rules threw; retried every 30s, POST forces it and returns `{ recovered }` |
| `/classification/overall` | GET | closed stages only, with notional times — see `event-model.md` |
| `/classification/...` | `?classId=` | every endpoint below and above; repeat it to combine classes (vehicles in *all* of them). Positions and gaps within that group; 404 on an unknown class |
| `/classification/stages/:stageId` | GET | ranked with gaps |
| `/classification/stages/:stageId/split-gates` | GET | the stage's split points |
| `/classification/stages/:stageId/splits/:splitIndex` | GET | live, includes `STARTED` runs, excludes `CANCELLED` |
| `/classification/stages/:stageId/non-finishers` | GET | DNF; DNS only once the stage is `CLOSED` |
| `/rally-info` | GET, PUT | the event's name/details; singleton, since one database is one event |
| `/event` | GET, POST `{ name, date }`, `/open` POST `{ file }` | the open event file and the others in the folder, `switchable: false` when fixed by config. POST creates/opens by restarting the server (202, then poll GET); 409 while a stage is `ACTIVE` — see `deployment-modes.md` |
| `/event/known-gates` | GET, `/:id` DELETE | gates this computer remembers across events (standalone only); DELETE forgets one, the open event keeps it |
| `/settings/:key` | GET, PUT | `autoDiscoverGates`, `clockCorrectionThresholdMs`, `notionalPenaltyMs`, `startOrderGrouping`/`startOrderKey`/`startOrderDirection` (enums in `packages/shared/src/start-order.ts`; an unknown value reads as the default) |

Every mutating endpoint binds a DTO class, and unknown fields are a 400 — see
`CLAUDE.md` for which fields are deliberately absent.

Live: **one** SSE stream, `GET /live`, with the kind of update as the SSE
event type (`LiveEventType` in `packages/shared`). One stream, not one per kind:
each open `EventSource` holds one of the browser's six connections per host,
shared across tabs, and once they are all streams every fetch queues behind them
and the dashboard freezes. Clients refetch in `onopen`, which also fires on every
reconnect.

- `detection`, `stage-run`, `stage-run-split` — the record as it changes
- `gate` — a `Gate` on each heartbeat
- `pending-detections` — `{ pending }`, `awaiting-detections` — `{ awaiting }`:
  the whole list on every change, not a delta

A gate's own configuration is not here: `apps/gate-config` serves it on the gate
itself, port 57439 (`/api/config`, `/api/status`, `/api/network`,
`/api/network/reset`) — see `gate-config-ui.md`.
