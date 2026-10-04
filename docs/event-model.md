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

Adds `entryId` (resolved from `transponderId`), `timestampServer`,
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
active assignment is stored with `awaitingEntry: true` and not timed. Live
Timing lists them; the marshal picks the entry (`POST /events/:id/assign`),
which runs the rules with the stored clock correction, or dismisses one that was
no car (`POST /events/:id/dismiss`). At an idle gate such a passing is just
stored.

The entry is **pre-selected from the start order, never assigned
automatically**: a wrong assignment is a wrong time nobody notices in the
results. Passings are matched in time order. At a start gate the suggestion is
the next car after the last one that started, so a no-show is skipped; at a
split or finish gate it is the first car on stage in expected arrival order —
most splits passed, then the earlier start (at a split, one without that split
yet). An overtake is just a suggestion the marshal
corrects.

Live Timing lists only the passings at the selected stage's gates, since
only there do suggestions know the start order; passings on another active
stage show as a link to it.

**Closing a stage that ran discards its unassigned passings** (`stage.closed`
→ `EventsService`): they can't be assigned to a closed stage any more, and
once a gate is reused, by a forced activation for instance, they would be
read as the new stage's passings. The records stay as evidence. Live Timing's
close confirmation counts them, since each may be a car without a time. A
passing at a gate no stage owns (one left from before this) stays listed
wherever it is viewed, so it can still be dismissed.

**Assign refuses when the rules would do nothing** — a finish or split for a car
with no running start, a duplicate start, a stage no longer active — with a 409,
leaving the passing listed. Silently consuming it would lose the time. So a
car's start has to be assigned before its finish.

## StageRun

One row per **attempt**. Created by a `stage_start` detection, finished by the
matching `stage_finish`; `durationMs = finishTime - startTime`, and must be
positive (classification sorts ascending, so a zero or negative time would win).

### Combined start/finish gate

A stage either starts and finishes at separate gates or at one gate in the
`stage_start_finish` role, never both (refused with a 409 on assignment). A
passing there finishes the car's open run, or starts one if it has none; a
finished car passing again is ignored like any restart. Within the stage's
`minDurationMs` of the start (optional, default
`DEFAULT_MIN_STAGE_DURATION_MS`, 10 s) a passing is ignored: the same
passing reported twice, or the car pulling away after Start now. That also
makes a marshal's re-run work: the next passing past the minimum finishes it.

Start and finish come from one gate clock, so no offset between two gates
enters the duration. The cost: start or finish is decided by **arrival
order**, not by time. A passing that arrives after a later one (a retried
detection, a beam passing assigned late) is misread; a marshal fixes it with
Correct. A separate role was chosen over assigning one gate twice, which
would break "exactly one active assignment per gate" that the rule engine
and the activation conflict check rely on.

Live Timing suggests a combined gate's beam passing for the car longest on
stage past the minimum, else the next car to start. A passing within the
minimum of a car's start gets no suggestion: it is that car breaking the beam
again, typically pulling away slowly enough to outlast the gate's
`BEAM_LOCKOUT_MS`, and is dismissed.

**At most one non-voided attempt per entry+stage**, enforced by a partial
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

`startManual`/`finishManual` record which ends a marshal set by hand: Start
now, Finish now (both stamped with the server clock) or a correction. A hand
time carries the marshal's reaction time, and a protest turns on exactly
which times were hand-set, so Live Timing marks them. Assigning an
unassigned passing doesn't set them: the time is still the gate's. Clearing a
finish clears its flag.

Duplicate starts and finishes without an active run are logged and ignored —
delivery is at-least-once, so the rules must be idempotent. Marshals correct
runs via `PATCH`/`POST`/`DELETE /stage-runs`.

### Voiding, and how a re-run starts

A re-run is **not** started by a bare start-gate detection: the start gate stays
live while finished cars are recovered back past it, so that would manufacture
phantom runs that replace real times.

Instead the marshal voids the attempt (`POST /stage-runs/:id/void`) — the red
flag. The row stays as evidence (a protest turns on what was originally timed),
stops counting, and leaves the entry with neither an open nor a finished
attempt, so **the start gate opens the re-run by itself** on the next pass. Both
ends stay gate-timed.

`POST /stage-runs/:id/unvoid` reverses it and 409s with `{ blockingAttempt }`
if another attempt already counts. It refuses rather than cascades: discarding a
run the car actually drove is a call the marshal makes explicitly.

## StageSplit

One row per (stage run, split gate), recorded on a `stage_split` detection while
the entry has an active run on that stage. `splitIndex` is copied from the
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
- A crew needs at least one completed stage to be classified, and must not
  be withdrawn or disqualified ("Entry status"). The rest are listed below
  the ranking as "Not classified", with no position or total.
- A closed stage nobody finished is dropped — a notional with no anchor would
  add the same constant to everyone.
- Lowest total wins; `stagesCompleted` is display-only.
- Notionals are computed per ranking and never stored, because a class
  ranking has a different slowest time than the overall one.

## Classes

Organiser-defined data (`EntryClass`: a name and a `main` flag), not an
enum. **Main classes** (4WD, 2WD) split the field; **categories** (Rookie,
Stock) cut across them. An entry can be in any number of either — the flag
only makes the UI offer one main class per entry, the server doesn't
enforce it, and rankings treat both alike.

A ranking takes any set of classes and narrows to entries in **all** of them
(Stock + Rookie + 2WD), then runs the same calculation as the unfiltered one —
so who is classified, which stages count and every notional come from within
that group. No hierarchy (Rookie *under* 2WD): categories exist in every main
class, and "all Rookies" must stay a ranking of its own. The overall ranking
always includes everyone.

## Entry status

An entry's way through the event (`EntryStatus`): **Registered**, then
**Checked in** at the desk, then **Scrutineered** (passed the technical
check), or out of it: **Withdrawn** or **Disqualified**. A small event with
no technical check does both steps at the desk in one ("Check in and pass").
Any status can be set back; Reinstate takes a car out of the event back to
Registered.

What each one does (`isOutOfEvent`, `isScrutineered` in `packages/shared`):

- **Not yet scrutineered** (Registered, Checked in) still starts. A forgotten
  click at the desk must not cost a crew its start; Live Timing marks such a
  car on the start list and in Up next, and Freeze and Activate name them
  and ask first.
- **Withdrawn or disqualified** gets no place on a start list still
  computed. A frozen list keeps it, since a posted list's positions must not
  shift; Live Timing shows it as out. A gate's passing for it is stored as
  evidence but times nothing (`EventsService.applyRules`), and a manual
  start is a 409. Neither is a DNS.
- **Disqualified** also leaves every result: stage, split and overall
  rankings drop it before anything is computed, so the notional times the
  others are charged are set as if it had never run (`rankable` in
  `ClassificationService`). A stage it drove lists it among the
  non-finishers as **DSQ**, whether the stage still runs or not. Its runs
  stay stored; reinstating brings it back.
- **Withdrawn** is retired: it won't drive again ("can't go on", "out of
  time"). It keeps the times it drove in each stage's results, but leaves
  the overall, listed below it as not classified, and collects no notional
  times. Its real times still anchor the others' notionals, so a withdrawal
  never moves anyone else's total. A car that broke down but will drive
  again is not withdrawn: it stays ranked on notionals for what it misses.
  Reinstating brings a withdrawn car back, with notionals for the stages it
  missed.

## Start order

The official start list per stage: what the announcer reads out and what gets
posted. Unassigned-passing suggestions and Live Timing's Up next follow it,
and it will be the reference for planned start times and penalties for
starting out of order.

**Computed**, per stage, from three event-wide settings that are independent of
each other:

- **Grouping**: by main class, or none. Blocks go in alphabetical order of class
  name, and entries with no main class start last. An entry in several main
  classes counts under the first one alphabetically, because the server doesn't
  stop that from happening.
- **Key within a group**: start number, overall time, or last stage time.
- **Direction**: fastest first or slowest first. It has no effect when the key
  is the start number.

Entries with no value for the key go to the end of their group. Ties, and those
entries at the end, are always ordered by start number. That also covers stage 1
under "last stage time". **Overall time** comes from the group's own ranking
(the main class ranking when grouping by class), because notionals depend on the
ranking. Otherwise the list would contradict the class results posted next to
it. **Last stage time** is from the most recent `CLOSED` stage with a lower
`stageNumber`, which is consistent with overall time counting only closed
stages. Nobody is left off: retired and DNS crews stay in the list, because at
a hobby event a crew that has fixed its car gets to drive again.

**Frozen when published.** Until then the list is computed live, so a time
correction on an earlier stage still moves it. Freezing stores it on the stage
as a snapshot of entry ids with `startOrderFrozenAt` (the "as of" on a
posted copy), and it is never recomputed. A marshal freezes it when posting or
announcing it (`POST /stages/:id/start-order/freeze`); otherwise the first
activation does. Unfreezing is only allowed while the stage is `NOT_STARTED`,
to fix a wrongly posted list: once a stage runs, its list is what starts are
measured against. A crew registered after that is added at the end, ordered by
start number. A time-based list that kept moving after it was announced would
be a different list from the one posted.
