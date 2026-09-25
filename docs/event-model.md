# Event Model

## DetectionEvent (MQTT payload)

Published by `gate-agent` to `rally/gates/<gateId>/detections`, defined in
`packages/shared/src/detection-event.ts`:

```ts
interface DetectionEvent {
  eventId: string;         // ULID, generated on the gate — the idempotency key
  gateId: string;
  transponderId: string;
  timestampGate: string;   // ISO 8601, the gate's clock
  source: string;          // 'simulated' | 'simulated-cli' | later 'openstint', ...
  metadata?: Record<string, unknown>;
}
```

The broker is unauthenticated, so ids and timestamps are bounds-checked on
ingest and bad messages dropped with a warning: an unparseable timestamp would
otherwise poison a duration silently.

## DetectionEventRecord (stored)

Adds `vehicleId` (resolved from `transponderId`), `timestampServer`,
`clockCorrectionMs`, `rawPayload` and `processed`. `timestampGate` is never
rewritten; the time the rules used is `timestampGate + clockCorrectionMs` (see
"Clock offset" in `architecture.md`).

`processed: false` means the rules threw. The raw detection is always saved
first, a 30s sweep retries oldest-first with the stored correction, and
`GET /events/pending` plus a dashboard banner make the backlog visible. An
unknown gate or unregistered transponder is marked processed — retrying changes
nothing and would bury real problems.

## StageRun

One row per **attempt**. Created by a `stage_start` detection, finished by the
matching `stage_finish`; `durationMs = finishTime - startTime`, and must be
positive (classification sorts ascending, so a zero or negative time would win).

**At most one non-voided attempt per vehicle+stage**, enforced by a partial
unique index (`where "voided" = false`). The invariant is *not voided means it
counts*: if several attempts could survive, a superseded run would show
`FINISHED` with a duration while missing from the results. Results use the
highest surviving `attempt` (`latestAttempts`).

`attempt` is an explicit counter rather than a creation timestamp because
`@CreateDateColumn` stores only seconds on sqlite, and `startTime` is editable.
Application-set `Date`s keep milliseconds on both drivers —
`timestamp-precision.spec.ts` pins that against real sqlite.

`status` is derived on read, never stored (`deriveStageRunStatus`): `FINISHED`
once `finishTime` is set, otherwise `STARTED`, or `CANCELLED` (DNF) once the
stage is closed; `VOIDED` if voided. Closing a stage therefore writes nothing to
its runs.

Duplicate starts and finishes without an active run are logged and ignored —
delivery is at-least-once, so the rules must be idempotent. Marshals correct
runs via `PATCH`/`POST`/`DELETE /stage-runs`.

### Voiding, and how a re-run starts

A re-run is **not** started by a bare start-gate detection: the start gate stays
live while finished cars are recovered back past it, so that would manufacture
phantom runs that replace real times.

Instead the marshal voids the attempt (`POST /stage-runs/:id/void`) — the red
flag. The row stays as evidence (a protest turns on what was originally timed),
stops counting, and leaves the vehicle with neither an open nor a finished
attempt, so **the start gate opens the re-run by itself** on the next pass. Both
ends stay gate-timed.

`POST /stage-runs/:id/unvoid` reverses it and 409s with `{ blockingAttempt }`
if another attempt already counts. It refuses rather than cascades: discarding a
run the car actually drove is a call the marshal makes explicitly.

## StageSplit

One row per (stage run, split gate), recorded on a `stage_split` detection while
the vehicle has an active run on that stage. `splitIndex` is copied from the
assignment, `elapsedMs` is time since `startTime`. Duplicates are ignored. Split
classification ranks by `elapsedMs` and includes runs still `STARTED`, which is
what makes it a live leaderboard.

## Notional times

The overall classification sums stage times, which only compares crews if the
totals cover the same stages — otherwise retiring makes a total *shorter*. A
crew missing a stage is charged a **notional time: the slowest real time on that
stage within the ranking being computed, plus `notionalPenaltyMs`** (default
2 min), so skipping never pays off on that stage.

That does not guarantee a crew with more stages finishes ahead of one with
fewer: a quick crew can retire and still lead if the penalty is small. The
penalty is the knob; roughly one stage duration is a sensible start.

- Only `CLOSED` stages count, so the overall table moves when a stage closes.
- A crew needs at least one completed stage to be classified.
- A closed stage nobody finished is dropped — a notional with no anchor would
  add the same constant to everyone.
- Lowest total wins; `stagesCompleted` is display-only.
- Notionals are computed per ranking and never stored, because a future class
  ranking has a different slowest time than the overall one.
