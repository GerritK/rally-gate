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

One row per vehicle+stage attempt. Created on a `stage_start` detection,
closed on the matching `stage_finish` detection. `durationMs` is
`finishTime - startTime` in server time. See
`apps/rally-server/src/modules/stage-runs/stage-runs.service.ts` for the
current (intentionally simple) rule: one active run per vehicle+stage,
duplicate start events are ignored, a finish event with no active run is
ignored (logged, not stored) rather than erroring.

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
