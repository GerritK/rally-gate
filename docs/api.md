# API

REST (all on `rally-server`, default port 57430; embedded MQTT broker on
57431):

| Endpoint | Methods | Notes |
|---|---|---|
| `/gates` | GET, and `/:id` GET/PUT | PUT upserts a gate by id (name only — hardware identity, no role) |
| `/gate-assignments` | GET, POST, `/:id/activate`\|`/deactivate` POST, `/:id` DELETE | the (gate, stage, role, splitIndex) plan; `active` picks which one the rule engine uses |
| `/vehicles` | GET, POST, `/:id` GET | transponder assignment is `Vehicle.transponderId`; `startNumber` is DB-unique, POST 409s on a clash |
| `/stages` | GET, and `/:id` GET/PUT | sorted by `stageNumber` |
| `/stage-runs` | GET, POST, `/:id` PATCH\|DELETE | derived from gate detections; POST/PATCH/DELETE are the marshal's manual-correction override for missed/bad detections; `(vehicleId, stageId)` is DB-unique, POST 409s on a clash |
| `/stage-runs/:id/splits` | GET | `StageSplit`s for a run, ordered by `splitIndex` |
| `/events` | GET | recent `DetectionEventRecord`s |
| `/classification/stages/:stageId` | GET | ranked per-stage results with gaps |
| `/classification/overall` | GET | ranked overall results with gaps |

Live (Server-Sent Events, plain `EventSource` on the client — no Socket.IO):
- `GET /live/detections` — a new `DetectionEventRecord` as it's ingested
- `GET /live/stage-runs` — a `StageRun` whenever it's created or updated
- `GET /live/stage-run-splits` — a `StageSplit` whenever one is recorded

Not built yet: `/penalties`, `/results`, `/config`, `/gate-nodes`, auth of
any kind. See the original project doc's "API" section for the full
eventual surface.
