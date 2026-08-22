# API

REST (all on `rally-server`, default port 57430; embedded MQTT broker on
57431):

| Endpoint | Methods | Notes |
|---|---|---|
| `/gates` | GET, and `/:id` GET/PUT | PUT upserts a gate by id (name only — hardware identity, no role) |
| `/gate-assignments` | GET, POST, `/:id` DELETE | the (gate, stage, role, splitIndex) plan; `active` picks which one the rule engine uses |
| `/vehicles` | GET, POST, `/:id` GET | transponder assignment is `Vehicle.transponderId`; `startNumber` is DB-unique, POST 409s on a clash |
| `/stages` | GET, and `/:id` GET/PUT, `/:id/activate`\|`/close` POST | sorted by `stageNumber`; `status` is `NOT_STARTED`\|`ACTIVE`\|`CLOSED`; activate flips all of the stage's `GateAssignment`s on and sets `ACTIVE` — 409s with `{ conflictingStageIds }` if another stage is already active on a shared gate (unless `?force=true`, which closes that other stage instead — DNFs anything still `STARTED` on it), or a plain 409 if the stage is already `CLOSED`; close flips the stage's gates back off and marks it `CLOSED` — terminal, no reactivating (no standalone deactivate either — see `architecture.md`) |
| `/stage-runs` | GET, POST, `/:id` PATCH\|DELETE | derived from gate detections; POST/PATCH/DELETE are the marshal's manual-correction override for missed/bad detections; `(vehicleId, stageId)` is DB-unique, POST 409s on a clash |
| `/stage-runs/:id/splits` | GET | `StageSplit`s for a run, ordered by `splitIndex` |
| `/events` | GET | recent `DetectionEventRecord`s |
| `/classification/stages/:stageId` | GET | ranked per-stage results with gaps |
| `/classification/overall` | GET | ranked overall results with gaps, lowest total wins. Counts **CLOSED stages only**; a crew that didn't complete one is charged a **notional time** (slowest real time on that stage + `notionalPenaltyMs`, default 2 min) so all totals cover the same stages — see "Notional times" in `event-model.md`. `stagesCompleted` is stages actually driven and is display-only, not the ranking key; a value below the maximum means notional time is inside that total |

Live (Server-Sent Events, plain `EventSource` on the client — no Socket.IO):
- `GET /live/detections` — a new `DetectionEventRecord` as it's ingested
- `GET /live/stage-runs` — a `StageRun` whenever it's created or updated
- `GET /live/stage-run-splits` — a `StageSplit` whenever one is recorded

Not built yet: `/penalties`, `/results`, `/config`, `/gate-nodes`, auth of
any kind. See the original project doc's "API" section for the full
eventual surface.
