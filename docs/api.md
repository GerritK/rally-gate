# API

`rally-server`, port 57430. **Every path is under `/api`**, because the same
port serves the built dashboard and `/entries` is both a page and a resource.
Anything outside `/api` that isn't a file returns `index.html`.

A refusal the server raises itself (the 400/404/409s below) carries
`{ code, message, params? }`: `code` is an `ApiErrorCode` (`packages/shared`),
which the dashboard translates as `errors.<code>` with `params` filled in;
`message` is English, for logs and curl. Validation 400s and 500s have no
`code`.

| Endpoint | Methods | Notes |
|---|---|---|
| `/version` | GET | `{ version }`, the server's build — see "Gate discovery & heartbeat" in `architecture.md` |
| `/time` | GET | `{ now }`, the server clock; the dashboard shows it instead of the device's, since gates sync to the server |
| `/gates` | GET, `/:id` GET/PUT/DELETE | hardware identity only (PUT sets the name). Auto-created from a first heartbeat unless `autoDiscoverGates` is off |
| `/gates/power-off` | POST | shuts down every online gate through its gate-config; one `{ gateId, ok, error?, detail? }` per gate (`unreachable`, or `refused` with the command output). 409 while a stage is active |
| `/gate-assignments` | GET, POST, `/:id` DELETE | the (gate, stage, role, splitIndex) plan. `active` is not settable — activation is per stage |
| `/entries` | GET, POST, `/:id` GET/PATCH | `startNumber` is unique, POST/PATCH 409 on a clash. Classes are written as `classIds` (replaces the list, 400 on an unknown id) and read back as `classes` |
| `/entry-classes` | GET, POST, `/:id` PUT/DELETE | `{ name, main? }`, name unique (409), main classes listed first. DELETE takes the class off its entries |
| `/penalty-types` | GET, POST, `/:id` PUT/DELETE | `{ name, scope, tiers: [{ fromCount, seconds }] }`, tiers from 1 ascending (400), name unique (409). PUT reprices given penalties, DELETE deletes them |
| `/penalties` | GET `?entryId=`, POST, `/:id` DELETE | `{ entryId, stageId?, typeId?, count?, seconds?, note? }`: a type, or free text with `seconds` and `note` (400). 409 on a stage not started. Read back with its computed `penaltyMs` (`event-model.md` "Penalties") |
| `/stages` | GET, POST, `/:id` GET/PUT/DELETE | sorted by `stageNumber`; `status` is server-owned |
| `/stages/:id/activate` | POST | activates the stage's gate assignments. 409 `otherStageActive` with `params.conflictingStageIds` if a gate is active elsewhere (`?force=true` closes that stage), 409 if already `CLOSED` |
| `/stages/:id/close` | POST | deactivates its gates, marks it `CLOSED`. Terminal |
| `/stages/:id/start-order` | GET | `{ frozen, frozenAt, grouped, entries }`; computed live until frozen. See `event-model.md` "Start order" |
| `/stages/:id/start-order/freeze` | POST | stores the snapshot; no-op if already frozen (activation also freezes) |
| `/stages/:id/start-order/unfreeze` | POST | back to live; 409 unless the stage is `NOT_STARTED` |
| `/stage-runs` | GET, POST, `/:id` PATCH/DELETE | POST/PATCH/DELETE are manual corrections. POST without `startTime` is "Start now", stamped with the server clock. POST 409s while a non-voided attempt exists, and for an entry withdrawn or disqualified. GET includes voided attempts; `?stageId=` narrows to one stage |
| `/stage-runs/splits?stageId=` | GET | every split of every attempt on the stage, one request per page |
| `/stage-runs/:id/finish` | POST | "Finish now": hand-timed finish stamped with the server clock. 409 if already finished, voided or the stage is closed |
| `/stage-runs/:id/void`, `/unvoid` | POST | red flag / reverse it — see "Voiding" in `event-model.md`. Unvoid 409s with `params.blockingAttempt` |
| `/events` | GET | the 100 most recent detections; `?gateId=` for one gate's |
| `/events/awaiting-entry` | GET | unassigned passings (no transponder, or one on several entries) at live gates, oldest first |
| `/events/:eventId/assign` | POST `{ entryId }` | times the passing as that entry; 409 when the rules would do nothing (e.g. finish before start) |
| `/events/:eventId/dismiss` | POST | the passing was no car |
| `/events/pending` | GET, `/retry` POST | detections whose rules threw; retried every 30s, POST forces it and returns `{ recovered }` |
| `/classification/overall` | GET | closed stages only, with notional times — see `event-model.md` |
| `/classification/...` | `?classId=` | every endpoint below and above; repeat it to combine classes (entries in *all* of them). Positions and gaps within that group; 404 on an unknown class |
| `/classification/stages/:stageId` | GET | ranked with gaps |
| `/classification/stages/:stageId/split-gates` | GET | the stage's split points |
| `/classification/stages/:stageId/splits/:splitIndex` | GET | live, includes `STARTED` runs, excludes `CANCELLED` |
| `/classification/stages/:stageId/non-finishers` | GET | DNF; DNS only once the stage is `CLOSED`; DSQ for a disqualified car that drove it, at any time. Disqualified cars are in no ranking (`event-model.md` "Entry status") |
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
