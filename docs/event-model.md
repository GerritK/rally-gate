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

## Notional times

Overall classification is a sum of stage times, so totals only mean anything
if they cover the same stages. A crew that didn't complete one would otherwise
have a *shorter* total and rank higher for having driven less.

Rally's answer, which this follows, is to give them a time anyway: a
**notional time**, defined here as **the slowest real time on that stage,
within the ranking being computed, plus a configurable penalty**
(`notionalPenaltyMs` setting, default 2 min). Anchoring on the slowest time is
what guarantees the notional is worse than every real time in that ranking, so
skipping a stage never pays off on that stage.

Note what that guarantee does *not* cover: it says nothing about whether a
crew who drove more stages finishes ahead of one who drove fewer. That holds
only if the penalty outweighs the advantage the shorter crew built on the
stages it did finish — with a small penalty a quick crew can retire and still
lead, which is legitimate rally arithmetic but rarely what an organiser
intends. The penalty is the knob for this, and it wants to scale with stage
length; roughly one stage duration is a reasonable starting point.

Rules:

- **Only CLOSED stages count.** A stage still running has no result yet, so
  nobody is charged for not having finished it. Same trigger
  `getNonFinishers` uses, so DNF/DNS and the overall table agree on when a
  stage is decided. Practical effect: the overall table moves when a stage
  closes, not continuously during one.
- **A crew must have completed at least one stage to be classified.**
  Otherwise a registered car that never turned up collects notionals for the
  whole rally and lands in the results on an entirely invented total.
- **A closed stage nobody finished is dropped entirely.** With no real time to
  anchor a notional, every crew would get the same invented figure — a
  constant added to all totals, which moves no positions. Skipping it is
  equivalent and avoids fabricating a number.
- **Ranking is then plain lowest-total-wins.** No stages-completed ordering:
  once notionals make totals comparable, a separate stage-count rule would
  actively contradict the times. Note this means a crew quick enough on the
  stages it *did* complete can still lead on fewer stages — the penalty is the
  knob controlling how punishing a retirement is.
- **Notional times are computed per ranking, never stored on a `StageRun`.**
  The basis is the slowest time *within the ranking being computed*: overall
  ranking uses the slowest overall, a class ranking uses the slowest in that
  class. Because a vehicle can belong to several classes at once (see the
  deferred vehicle-classes item in `development-roadmap.md`), the same missed
  stage yields a *different* notional in each ranking it appears in — so it
  cannot be a property of the run. `StageRun` stays purely factual: measured
  times only.

## DetectionEventRecord (stored, `apps/rally-server`)

Adds server-side fields once ingested: `vehicleId` (resolved from
`transponderId`, if a matching vehicle exists), `timestampServer` (server's
own clock — kept separate from `timestampGate` since gate/server clocks
aren't assumed to be perfectly synced), `clockCorrectionMs`, `rawPayload`,
`processed`.

`timestampGate` is never rewritten. When the gate's measured clock offset is
large enough to correct (see "Clock offset" in `architecture.md`), the
correction is recorded separately in `clockCorrectionMs` and the time the
rule engine actually used is `timestampGate + clockCorrectionMs` — so the raw
reading and the adjustment stay independently inspectable.

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
