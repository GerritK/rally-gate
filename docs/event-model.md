# Event Model

## DetectionEvent (wire format, MQTT payload)

Published by `gate-agent` to `rally/gates/<gateId>/detections`, defined in
`packages/shared/src/detection-event.ts`:

```ts
interface DetectionEvent {
  eventId: string;         // ULID
  gateId: string;
  transponderId: string;
  timestampGate: string;   // ISO 8601, gate-agent's clock
  source: string;          // 'simulated' | 'simulated-cli' | future: 'openstint', ...
  metadata?: Record<string, unknown>;
}
```

## DetectionEventRecord (stored, `apps/rally-server`)

Adds server-side fields once ingested: `vehicleId` (resolved from
`transponderId`, if a matching vehicle exists), `timestampServer` (server's
own clock — kept separate from `timestampGate` since gate/server clocks
aren't assumed to be perfectly synced), `rawPayload`, `processed`.

## StageRun

One row per vehicle+stage attempt, enforced by a `@Unique(['vehicleId',
'stageId'])` DB constraint on `StageRun` — a vehicle can only run a stage
once. Created on a `stage_start` detection, closed on the matching
`stage_finish` detection. `durationMs` is `finishTime - startTime` in server
time. See `apps/rally-server/src/modules/stage-runs/stage-runs.service.ts`
for the current (intentionally simple) rule: one active run per
vehicle+stage, duplicate start events are ignored (the pre-insert check
handles the common case; a race that slips past it and hits the DB
constraint falls back to returning the existing row rather than erroring), a
finish event with no active run is ignored (logged, not stored) rather than
erroring. A marshal can also correct a run directly (missed or bad
detection) via `PATCH /stage-runs/:id` (startTime/finishTime, `durationMs`
recomputed server-side) or create one outright via `POST /stage-runs` when
the start detection never arrived at all (409s if the vehicle already has a
run on that stage) — see `stage-runs.service.ts`
`correctRun`/`createManual`.

`StageRun` has no `status` column — STARTED/FINISHED/CANCELLED is derived on
read (`deriveStageRunStatus` in `stage-runs.service.ts`), never stored:
FINISHED once `finishTime` is set, otherwise STARTED unless the run's stage
has been closed, in which case it's CANCELLED (DNF). This means
`Stage.close()` (`stages.service.ts`) no longer needs to sweep/write
anything to `StageRun` rows — every still-unfinished run on a closed stage
reports CANCELLED for free, with no risk of the two drifting out of sync.

## StageSplit

One row per (stage run, split gate). Recorded on a `stage_split` detection
at a gate whose `stageId` matches the vehicle's currently active
`StageRun` on that stage. `splitIndex` is copied from the gate's
`splitIndex` at record time (lets a stage have multiple ordered split
points), `elapsedMs` is time since the run's `startTime`. A split
detection with no active run, or a duplicate detection at a gate already
recorded for that run, is ignored (logged, not stored/duplicated) — same
"intentionally simple" idempotent-ignore pattern as `StageRun`. No
split-based ranking/classification exists yet — splits are recorded and
displayed only.
