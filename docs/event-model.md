# Event Model

## DetectionEvent (MQTT payload)

Published by `gate-agent` to `rally/gates/<gateId>/detections`, defined in
`packages/shared/src/detection-event.ts`:

```ts
interface DetectionEvent {
  eventId: string;         // ULID, generated on the gate — the idempotency key
  gateId: string;
  transponderId?: string;  // absent when the gate can't identify the car
  timestampGate: string;   // ISO 8601, the gate's clock
  source: string;          // the gate's ADAPTER, or 'simulated-cli'
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

### Unassigned passings

A detection without a `transponderId` (a light barrier) at a gate with an
active assignment is stored with `awaitingVehicle: true` and not timed. Live
Timing lists them; the marshal picks the vehicle (`POST /events/:id/assign`),
which runs the rules with the stored clock correction, or dismisses one that was
no car (`POST /events/:id/dismiss`). At an idle gate such a passing is just
stored.

The vehicle is **pre-selected from the start order, never assigned
automatically**: a wrong assignment is a wrong time nobody notices in the
results. Passings are matched in time order. At a start gate the suggestion is
the next car after the last one that started, so a no-show is skipped; at a
split or finish gate it is the first car on stage in start order (at a split,
one without that split yet). An overtake is just a suggestion the marshal
corrects.

**Assign refuses when the rules would do nothing** — a finish or split for a car
with no running start, a duplicate start, a stage no longer active — with a 409,
leaving the passing listed. Silently consuming it would lose the time. So a
car's start has to be assigned before its finish.

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
- Notionals are computed per ranking and never stored, because a class
  ranking has a different slowest time than the overall one.

## Classes

Organiser-defined data (`VehicleClass`: a name and a `main` flag), not an
enum. **Main classes** (4WD, 2WD) split the field; **categories** (Rookie,
Stock) cut across them. A vehicle can be in any number of either — the flag
only makes the UI offer one main class per vehicle, the server doesn't
enforce it, and rankings treat both alike.

A ranking takes any set of classes and narrows to vehicles in **all** of them
(Stock + Rookie + 2WD), then runs the same calculation as the unfiltered one —
so who is classified, which stages count and every notional come from within
that group. No hierarchy (Rookie *under* 2WD): categories exist in every main
class, and "all Rookies" must stay a ranking of its own. The overall ranking
always includes everyone.

## Start order

The official start list per stage: what the announcer reads out and what gets
posted. It is also the reference for later work: unassigned-passing
suggestions, planned start times, and penalties for starting out of order.

**Computed**, per stage, from three event-wide settings that are independent of
each other:

- **Grouping**: by main class, or none. Blocks go in alphabetical order of class
  name, and vehicles with no main class start last. A vehicle in several main
  classes counts under the first one alphabetically, because the server doesn't
  stop that from happening.
- **Key within a group**: start number, overall time, or last stage time.
- **Direction**: fastest first or slowest first. It has no effect when the key
  is the start number.

Vehicles with no value for the key go to the end of their group. Ties, and those
vehicles at the end, are always ordered by start number. That also covers stage 1
under "last stage time". **Overall time** comes from the group's own ranking
(the main class ranking when grouping by class), because notionals depend on the
ranking. Otherwise the list would contradict the class results posted next to
it. **Last stage time** is from the most recent `CLOSED` stage with a lower
`stageNumber`, which is consistent with overall time counting only closed
stages. Nobody is left off: retired and DNS crews stay in the list, because at
a hobby event a crew that has fixed its car gets to drive again.

**Frozen when published.** Until then the list is computed live, so a time
correction on an earlier stage still moves it. Freezing stores it on the stage
as a snapshot of vehicle ids with `startOrderFrozenAt` (the "as of" on a
posted copy), and it is never recomputed. A marshal freezes it when posting or
announcing it (`POST /stages/:id/start-order/freeze`); otherwise the first
activation does. Unfreezing is only allowed while the stage is `NOT_STARTED`,
to fix a wrongly posted list: once a stage runs, its list is what starts are
measured against. A crew registered after that is added at the end, ordered by
start number. A time-based list that kept moving after it was announced would
be a different list from the one posted.
