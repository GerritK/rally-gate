# API

**Every path below is prefixed with `/api`** (`app.setGlobalPrefix('api')` in
`main.ts`). `rally-server` serves the built dashboard from the same port, so
the prefix is what keeps `/vehicles` the *page* and `/api/vehicles` the
*resource* — without it the two collide, and a new endpoint could silently
shadow a page later. Anything outside `/api` that isn't a real file returns
`index.html`, so vue-router's history-mode deep links resolve.

REST (all on `rally-server`, default port 57430; embedded MQTT broker on
57431):

| Endpoint | Methods | Notes |
|---|---|---|
| `/gates` | GET, and `/:id` GET/PUT | PUT upserts a gate by id (name only — hardware identity, no role) |
| `/gate-assignments` | GET, POST, `/:id` DELETE | the (gate, stage, role, splitIndex) plan; `active` picks which one the rule engine uses |
| `/vehicles` | GET, POST, `/:id` GET | transponder assignment is `Vehicle.transponderId`; `startNumber` is DB-unique, POST 409s on a clash |
| `/stages` | GET, and `/:id` GET/PUT, `/:id/activate`\|`/close` POST | sorted by `stageNumber`; `status` is `NOT_STARTED`\|`ACTIVE`\|`CLOSED`; activate flips all of the stage's `GateAssignment`s on and sets `ACTIVE` — 409s with `{ conflictingStageIds }` if another stage is already active on a shared gate (unless `?force=true`, which closes that other stage instead — DNFs anything still `STARTED` on it), or a plain 409 if the stage is already `CLOSED`; close flips the stage's gates back off and marks it `CLOSED` — terminal, no reactivating (no standalone deactivate either — see `architecture.md`) |
| `/stage-runs` | GET, POST, `/:id` PATCH\|DELETE | derived from gate detections; POST/PATCH/DELETE are the marshal's manual-correction override for missed/bad detections. A vehicle has **at most one non-voided attempt per stage** (partial unique index), so POST 409s while one still counts — void it first. GET returns every attempt including voided ones |
| `/stage-runs/:id/void` | POST | strikes out an attempt (red flag). The row stays as evidence with status `VOIDED` but stops counting, and the vehicle is freed so the **start gate opens the re-run itself** on its next pass — both ends stay gate-timed, no restart time is typed in. see "Voiding" in `event-model.md` |
| `/stage-runs/:id/unvoid` | POST | reverses a void. 409s with `{ blockingAttempt }` if another attempt already counts for that stage — a vehicle has at most one non-voided attempt, so that one must be voided first. Never cascades: discarding a run the car actually drove is the marshal's call to make explicitly |
| `/stage-runs/:id/splits` | GET | `StageSplit`s for a run, ordered by `splitIndex` |
| `/events` | GET | recent `DetectionEventRecord`s |
| `/events/pending` | GET, `/retry` POST | detections stored but never timed, because rule application threw. The raw passing is always saved before the rules run, so a failure costs the timing, not the evidence — `processed: false` marks it. The server re-runs these every 30s (idempotent: the rule engine ignores repeats); POST forces a sweep now and returns `{ recovered }`. A non-empty list means passings are missing from the results, so the dashboard surfaces the count |
| `/classification/stages/:stageId` | GET | ranked per-stage results with gaps |
| `/classification/overall` | GET | ranked overall results with gaps, lowest total wins. Counts **CLOSED stages only**; a crew that didn't complete one is charged a **notional time** (slowest real time on that stage + `notionalPenaltyMs`, default 2 min) so all totals cover the same stages — see "Notional times" in `event-model.md`. `stagesCompleted` is stages actually driven and is display-only, not the ranking key; a value below the maximum means notional time is inside that total |

Live (Server-Sent Events, plain `EventSource` on the client — no Socket.IO):
- `GET /live/detections` — a new `DetectionEventRecord` as it's ingested
- `GET /live/stage-runs` — a `StageRun` whenever it's created or updated
- `GET /live/stage-run-splits` — a `StageSplit` whenever one is recorded
- `GET /live/gates` — a `Gate` on each heartbeat
- `GET /live/pending-detections` — `{ pending: DetectionEventRecord[] }` whenever the failed-detection backlog changes (a failure or a recovery). Carries the whole list, not a delta, so a reconnecting client is correct again on the next change

Not built yet: `/penalties`, `/results`, `/config`, `/gate-nodes`, auth of
any kind. See the original project doc's "API" section for the full
eventual surface.
