# Event Model

## DetectionEvent (MQTT payload)

Published by `gate-agent` to `rally/gates/<gateId>/detections`, defined in
`packages/shared/src/detection-event.ts`:

```ts
interface DetectionEvent {
  eventId: string;         // ULID, generated on the gate — the idempotency key
  gateId: string;
  transponderId?: string;  // absent when the gate can't identify the car
  transponderKind?: TransponderKind;  // 'RC' | 'NFC'; absent means RC
  timestampGate: string;   // ISO 8601, the gate's clock
  source: string;          // the gate's ADAPTER, or 'simulated-cli'
  metadata?: Record<string, unknown>;
}
```

The broker is unauthenticated, so ids and timestamps are bounds-checked on
ingest and bad messages dropped with a warning: an unparseable timestamp would
otherwise poison a duration silently.

## DetectionEventRecord (stored)

Adds `transponderKind` (null along with `transponderId`), `entryId` (resolved
from the two, see "Transponders" below), `timestampServer`,
`clockCorrectionMs`, `rawPayload` and `processed`. `timestampGate` is never
rewritten; the time the rules used is `timestampGate + clockCorrectionMs` (see
"Clock offset" in `architecture.md`).

The broker acknowledges a detection (PUBACK) only once it is stored: if the
insert fails (database unreachable), the connection drops unacknowledged and
the gate sends the detection again.

`processed: false` means the rules threw, or a finish or split found no run
for its car at all: a start gate that was off Wi-Fi replays its start after the
finish, so such a passing waits up to 10 minutes (`AWAIT_START_MS`, from
arrival) for the start, then is ignored like any finish without a start. A
finish for a car that already finished is ignored at once. The raw detection
is always saved first, a 30s sweep retries oldest-first with the stored
correction, and `GET /events/pending` plus a dashboard banner make the backlog
visible. An unknown gate or unregistered transponder is marked processed —
retrying changes nothing and would bury real problems.

### Unassigned passings

A detection without a `transponderId` (a light barrier) at a gate with an
active assignment is stored with `awaitingEntry: true` and not timed. So is one
whose transponder is on several entries — it identifies none of them — unless
only one of those is still in the event (a transponder moved off a withdrawn
car is often still registered on it); its picker offers just those cars. Live
Timing lists them; the marshal picks the entry (`POST /events/:id/assign`),
which runs the rules with the stored clock correction, or dismisses one that was
no car (`POST /events/:id/dismiss`). At an idle gate such a passing is just
stored.

The entry is **pre-selected from the start order, never assigned
automatically**: a wrong assignment is a wrong time nobody notices in the
results. (A start passing on a slot stage is the exception, since it sets no
time: "Start slots".) Passings are matched in time order. At a start gate the
suggestion is the first car yet to start, so an early start doesn't skip the cars before it
and a no-show stays suggested until it is marked DNS or withdrawn; at a
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

One row per **attempt**. Created by a `stage_start` detection (on a slot stage
the start time is the slot instead, "Start slots"), finished by the matching
`stage_finish`; `durationMs = finishTime - startTime`, and must be
positive (classification sorts ascending, so a zero or negative time would win).

### Combined start/finish gate

A stage either starts and finishes at separate gates or at one gate in the
`stage_start_finish` role, never both (refused with a 409 on assignment). A
passing there finishes the car's open run, or starts one if it has none; a
finished car passing again is ignored like any restart, except on a
shakedown, where it starts the next run. Within the stage's
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

**At most one non-voided attempt per entry, stage and `run`**, enforced by a
partial unique index (`where "voided" = false`), and at most one open one per
entry+stage by a second (`and "finishTime" is null`). `run` is always 1 on a
counted stage, so there the first index means one attempt per entry+stage.
The invariant is *not voided means it counts*: if several attempts could
survive, a superseded run would show `FINISHED` with a duration while
missing from the results. Results use the surviving one (`countingRuns`); on
a shakedown, where every run survives, the fastest finished one.

`attempt` is an explicit counter rather than a creation timestamp because
`@CreateDateColumn` stores only seconds on sqlite, and `startTime` is editable.
Application-set `Date`s keep milliseconds on both drivers —
`timestamp-precision.spec.ts` pins that against real sqlite.

`status` is derived on read, never stored (`deriveStageRunStatus`): `FINISHED`
once `finishTime` is set, otherwise `STARTED`, or `CANCELLED` (DNF) once
`retired`; `VOIDED` if voided. Nothing in it depends on the stage: closing
writes DNF and DNS ("DNF and DNS").

`startManual`/`finishManual` record which ends a marshal set by hand: Start
now, Finish now (both stamped with the server clock) or a correction. A hand
time carries the marshal's reaction time, and a protest turns on exactly
which times were hand-set, so Live Timing marks them. Assigning an
unassigned passing doesn't set them: the time is still the gate's. Clearing a
finish clears its flag.

Duplicate starts, and finishes without an active run, are logged and
ignored. Marshals correct runs via `PATCH`/`POST`/`DELETE /stage-runs`.

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

### DNF and DNS

Both are per stage and stored, so a result never derives them. Withdrawn is
a different thing: the car is out of the rally (an entry status, set at the
desk); DNF and DNS say what happened on one stage. A marshal sets either at
once in Live Timing, which is why neither waits for the stage to close: a
broken-down car otherwise stayed "On stage", and an absent one stayed
suggested in Up next and on the start card. Both and their undo take the
correction permission (a stage marshal on their own stages, the
organiser), are locked once the rally is closed, and end with the stage: a
closed stage's DNF and DNS are final (`stageAlreadyClosed`). In the change
history.

**DNF** is `StageRun.retired` (`POST /stage-runs/:id/retire`, undone by
`/unretire`), only on an open run. The run reads `CANCELLED`, leaves On stage
and the live split ranking, and is listed among the stage's non-finishers at
once; in the overall it costs the notional time like any missing finish. It
still counts, so a counted stage refuses a restart. A finish passing after
it is stored as evidence and times nothing; a finish entered by Correct
clears it, being the marshal's explicit call. On a shakedown DNF only ends
the open run: the car may start again (the open-run index skips retired
runs), and undoing the old DNF then 409s like unvoid.

**DNS** is a `DidNotStart` row `(entryId, stageId)` (`POST /stage-runs/dns`,
undone by `/dns/undo`), not a run: a run has a start time, and a DNS row must
stay out of the open-run index and `countingRuns`. Only on a running stage,
for a car with no counting run, never for a car out of the event or on a
shakedown. An untouched slot run (no start passing, no split) doesn't count:
DNS deletes it like Cancel deletes a countdown, so the slot stays empty and
nobody moves up; the start card skips the car. The car leaves Up next and is
listed as DNS in the stage results. If it turns up after all, a start
passing, Start now, a countdown or a run entered by hand deletes the row and
starts it normally.

**Closing a stage writes both**, in the transaction that sets `CLOSED`
(`writeClose`, also when a forced activation closes a stage): every open run
becomes DNF; a slot run without a start passing becomes DNF if it has a
split, else it is deleted and becomes DNS (on a shakedown just deleted); and
every car without a counting run gets a DNS row, except one out of the event
and except on a shakedown. A run typed in on a closed stage without a finish
is DNF at once, and so is one whose finish a correction clears there: no run
is open on a closed stage. A crew registered (or reinstated) after the stage
closed gets no row there and isn't listed as DNS, but still the notional
time, which depends on having no counting run, not on the label.

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
- Only stages scored `OVERALL` count ("Stages outside the overall").
- A crew needs at least one completed stage to be classified, and must not
  be withdrawn or disqualified ("Entry status"). The rest are listed below
  the ranking as "Not classified", with no position or total.
- A closed stage nobody finished is dropped — a notional with no anchor would
  add the same constant to everyone.
- Lowest total wins; `stagesCompleted` is display-only.
- Notionals are computed per ranking and never stored, because a class
  ranking has a different slowest time than the overall one.

## Penalties

Time added to a crew's **overall total**, never to a stage time: a stage's
results show what was driven, and its notionals anchor on that too, so one
crew's penalty never changes what another's retirement costs.

A **penalty type** is the rally's catalogue entry ("Jump start"): a name and
tiers `{ fromCount, seconds }`, starting at 1 and ascending. One tier is a
flat price per offence; more make each offence dearer the more an entry
already has (1st 0:10, from the 2nd 0:30, from the 5th 1:00: three cost
1:10, five 2:40). Its **scope** says where offences are counted: from 1
again on every stage, or on through the rally.

A **penalty** is an entry, a stage or none (the whole rally), a type and a
count of offences, plus a note; or **free text**, a reason with seconds
typed in (a jury decision). Seconds are whole and positive: a car held up
on a stage is a time correction on its run, not a credit.

- **The price is never stored.** Offences are counted per entry and type in
  stage order (no stage after every stage, then by entry time), so a
  correction on WP2 can reprice WP5, and editing a type reprices penalties
  already given (`pricePenalties`).
- **Counted when the overall counts their stage:** a stage's penalties join
  the total once it is closed, a whole-rally one at once; on a stage outside
  the overall, never.
- Only on a stage that has started, which is also why deleting a stage (only
  possible before it starts) never orphans one. Deleting a type deletes its
  penalties.

## Stages outside the overall

`Stage.scoring` is `OVERALL` (default), `QUALIFYING` or `NONE` (shakedown,
trial run). Any stage is timed, ranked, printed and podiumed alike; one
outside the overall is marked "Qualifying" or "Not counted" beside its name,
on its results and their PDF. **Nothing global reads it** (`countsInOverall`):
the overall skips it, so driving only it classifies no one and it sets no
notional; its penalties never reach a total and count from 1 on that stage
alone, even for a type counted through the rally.

**A shakedown (`NONE`) is driven as often as a car likes**, until the stage
closes. A finished car's next start, at the gate or by Start now, opens a new
run with `run = attempt`; a start while its run is open is refused as a
duplicate, and one from before its last finish is a late passing, ignored, so
runs never overlap. Every non-voided run counts: the results rank each car's
fastest finished run with its splits and show how many it drove (`runs`), so
a car with one finished run is never DNF. Live Timing and Up next suggest the
car off stage with the fewest runs, then start order; the entry page lists
every run. A combined gate has no lockout after a finish beyond the beam's
own: a car rolling back through starts a phantom run, harmless since only
finished runs count, and voided like any other.

The one exception is the start order, and only for `QUALIFYING`: under
"overall time", while no counted stage has closed, a stage is ordered by the
latest closed qualifying stage before it. Qualifying sets the first stage,
the overall the rest, with no extra start-order key.

## Rally status

`RallyInfo.status`: `SETUP` → `RUNNING` → `CLOSED`, moved only by Start,
Close and Reopen on Setup (`POST /rally-info/start|close|reopen`). The app
bar's chip only links there, so a tap on a tablet never ends a rally.

- **Setup.** Only a stage outside the overall can be activated; a counted
  one refuses (`startRallyFirst`), so a rally never starts unnoticed and
  trial runs leave nothing to delete. Gate and transponder tests need no
  stage: a passing at a gate with no active assignment is stored untimed,
  but still matched to its car (Hardware shows each gate's latest read).
- **Start** opens a check in the dashboard: no car or no counted stage
  blocks it; a stage without a start or finish gate, a planned gate offline
  or unsynced, cars without a transponder, sharing one or without a class
  only warn, since a marshal knows things the check doesn't.
- **Running** locks only what reinterprets results already timed: renaming
  or deleting classes, a start number once its car has a run, the
  start-order rules. Late entries, transponder swaps, withdrawals and
  corrections stay open, or marshals would unlock and forget.
- **Close** is refused while a car is on stage and closes the stages still
  running (the dashboard names them before asking). **Closed** locks
  everything that changes a result: stage activation, corrections,
  penalties and penalty types, passing assignments, an entry's status,
  classes and start number, the notional penalty. Detections are still
  stored, as evidence, but time nothing (no stage is active). What only
  changes how results look (a misspelt name, display settings) stays open.
- **Reopen** returns to Running, for a protest. There is no way back to
  Setup.

Results PDFs say "Provisional" until Closed: a closed stage can still move
by a penalty or a protest. Route locks are `@LockedWhen(...)` on the
controller method; a lock on some fields only (an entry, one setting key)
is checked in code, as a form sends every field.

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

## Transponders

An entry has a list of `EntryTransponder`s: a `kind` (`TransponderKind`, a
fixed enum, not free text — matching keys on it), an `identifier`, and an
optional `label` ("spare car"). A spare car, a replacement for a dead
transponder, an NFC tag the driver taps in with beside the car's RC
transponder. The entry dialog and the check-in desk edit the list as a whole;
`PATCH /entries/:id` with `transponders` replaces it.

A detection matches by kind and identifier, so an NFC tap never times a car
whose RC transponder shares the number. Nothing is unique: several of one kind
on a car, or one transponder on several cars, is allowed and only warned
about — refusing would block the desk mid-swap. No match is an unregistered
transponder, one match is timed, several are held for a marshal (see
"Unassigned passings").

A car that really carries two of a kind makes one passing two detections for
one entry. The rules ignore the repeat start, finish or split; a gate that
counts passings would have to dedupe per entry, not per identifier.

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
and it is the reference for a timetable's slots ("Start slots") and will be
for penalties for starting out of order.

**Computed**, per stage, from three event-wide settings that are independent of
each other:

- **Grouping**: by main class, or none. Blocks go in alphabetical order of class
  name, and entries with no main class start last. An entry in several main
  classes counts under the first one alphabetically, because the server doesn't
  stop that from happening.
- **Key within a group**: start number, overall time, or last stage time.
- **Direction**: fastest first or slowest first. It has no effect when the key
  is the start number.

Entries with no value for the key (everyone on stage 1 under "last stage
time") go to the end of their group; ties and those are ordered by start
number. **Overall time** comes from the group's own ranking, since notionals
depend on it, so the list matches the class results posted beside it. **Last
stage time** is from the most recent `CLOSED` counted stage before this one.
A qualifying stage can order the first counted one ("Stages outside the
overall"). Nobody is left off: at a hobby event a retired crew that has fixed
its car drives again.

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

## Start slots

How a car's start is timed is `Stage.startMode`, changeable
only while the stage is `NOT_STARTED` so a start never changes meaning mid-run:

- `GATE` — today's behaviour: the start passing is the start time.
- `SLOT_SCHEDULE` — every car has a planned start from a timetable.
- `SLOT_MANUAL` — a countdown is triggered per car, by a marshal or a
  pre-start gate. For a casual meet without a timetable.

Built: all three modes and the pre-start gate. Start lights at a gate are
not built (`development-roadmap.md`).

A slot is a `StageRun` created by the trigger, `startTime` and
`plannedStartTime` both the slot: no slot table and no server timer, and the
`finish > start` check covers it unchanged. Until slot + 5 s (green shown)
the dashboard shows the car as counting down rather than on stage. On a slot
stage a start or combined-gate passing never opens a run; the slot did.

### The slot is the start time

In both slot modes a run's start time is its **slot** (`plannedStartTime`,
server clock), as at a real rally: the clock runs from the slot whether the
car leaves on green or stalls and leaves 20 s later. Gates sync to the server
clock (`architecture.md` "Clock offset"), so finish minus slot is a duration
like any other, and `finish > start` is checked as everywhere. The start
passing stays stored, raw time untouched, beside the slot; a car without one
is still timed from its slot.

The start gate becomes a **jump-start detector**. A start passing earlier
than slot − `jumpStartToleranceMs` (200 ms: chrony and the beam edge, not
reaction time) is marked a jump start in Live Timing, which suggests the
penalty type set as `jumpStartPenaltyTypeId` for the marshal to confirm or
dismiss; with no type set it only marks. Never priced automatically: a wrong
automatic penalty is a wrong result nobody notices. The earliest start passing
counts (`startPassingAt`), so a repeat or the car breaking the beam again
changes nothing. The mark is derived from it and the current tolerance, which
is why the tolerance is locked once the rally runs; the suggestion goes once a
penalty of that type exists for the car on the stage, or the marshal dismissed
it (`jumpStartDismissed`, in the change history).

A start passing is **assigned automatically** to a slot within slot − 10 s
to slot + 60 s, also from a light barrier. This is the one exception to
"never assigned automatically" ("Unassigned passings"): the passing sets no
time, only the jump-start mark the marshal confirms. Outside that window it
stays unassigned as today. A transponder passing is checked against that
car's slots only; outside its window it is stored untimed.

A light-barrier passing goes first to a slot that has begun (slot −
tolerance) and has no start passing yet, the latest of them; only without
one, to the nearest slot. A car that stalls and leaves 25 s late is nearer
the next slot than its own, and would hand that car a false jump start.
The latest, so a no-show doesn't take the next car's passing and shift
every one after it. A passing given to a begun slot is never a jump start.

On a combined start/finish gate, passings before slot + `minDurationMs` are
the start passing (checked for a jump start); the first one after is the
finish.

A slot nobody drove becomes DNS when the stage closes: closing deletes the
slot run and writes a DNS row ("DNF and DNS"). "Nobody drove" is no start
passing, no split and no finish, so a car the start gate missed that never
reached a split reads DNS too, which costs the same notional time.

### Countdown

`countdownMs` (event-wide, default 10 s) is shown before every slot. The
start lights are always the last 5 s, one light out per second, then green:
the convention, and what a light at the gate shows later
(`architecture.md` "No server → gate commands"). A tone at 10 s, every second
of the lights, a long one on green.

Countdowns run only on an active stage. A timetable activates nothing by
itself: activation is a deliberate call about the gates.

### Manual: `SLOT_MANUAL`

A trigger sets the slot to **trigger time + `countdownMs`**, the trigger time
being when the server received it, never the gate's timestamp (a tap may
carry `timeUnknown`). Triggers are the Countdown button on the start card or a
detection at a `stage_pre_start` gate; a light-barrier passing there needs a
marshal to assign it first, and then the assignment is the trigger, so a late
assignment never makes a slot in the past.
A gate's own detection triggers only while its effective time is at most
`PRE_START_TRIGGER_MAX_AGE_MS` (30 s) before now: a gate that was offline
replays its taps on reconnect, and a slot from now for a tap minutes old would
be a phantom run on a shakedown. An older one only marks the car at the start;
one retried by the sweep is judged against now too, since its slot would be
from now. A tap with `timeUnknown` has no age and always triggers.

- Slots queue: the next is at earliest the previous + `minStartGapMs`
  (event-wide, default 30 s), since two cars can't start from one line.
- Tap order is start order. The frozen start order is not checked.
- Cancel deletes a slot until its car's first start passing, and is recorded
  in the change history; then trigger again.
- A trigger for a car that already has an open slot or is on stage is stored
  and ignored: a loop reads a car near it many times. The Countdown button
  answers 409 instead, also for a car that finished a counted stage (void its
  run first for a re-run): a person needs to hear it.
- Countdown and Cancel are in the change history.
- On a shakedown every trigger is the car's next run.

### Timetable: `SLOT_SCHEDULE`

Per stage a first start (time only, the date from context) and an interval
(default 60 s), one interval for everyone, no gaps between class blocks.
Slot = first start + interval × position in the frozen start order.

- Slots are **fixed when the start order freezes**: first start and
  interval lock with the snapshot, so a posted start list with times never
  moves silently. A withdrawn
  car keeps its slot, leaving a gap; nobody moves up. A crew registered
  later gets a slot after the last.
- **New slot**: a car not ready goes after the last slot (last + interval),
  never into a gap, which would give it a slot earlier than it could expect.
- **Delay**: all slots not yet reached move back by a given time, also while
  the stage runs, recorded in the change history. Never forward: a driver is
  never due earlier than announced. A stage activated after its first slot
  offers exactly this.
- Not offered on a shakedown: a timetable for unlimited runs means nothing.
- The slot times are on the printed start list.

**Slots are derived until activation, slot runs from then on.** Before
activation a car's slot is first start + interval × (position − 1) on the
frozen list, so nothing but the two stage fields is stored and unfreezing
has nothing to discard. Both fields are locked while the list is frozen
(`timetableFrozen`): unfreeze, edit, freeze again, so a posted time never
moves silently. Activation turns every slot into a slot run, exactly as a
countdown makes one, so timing from the slot, jump starts, DNS, the one
open run per entry+stage and Live Timing's queue work unchanged. Runs on a
stage that hasn't run would have shown as started on every results page.

- A car already out of the event at activation gets no run and leaves its
  gap; one withdrawn later keeps its run, which closing deletes if nobody
  drove it, writing no DNS (out of the event is neither).
- Before activation a late crew is appended to the list and takes the next
  slot by position; after it, a run at last slot + interval, none for a crew
  registered as out of the event.
- "The last slot" is the latest slot run (voided too) or the end of the
  posted list, whichever is later, so New slot never lands in a gap left by
  withdrawn cars at the end.
- New slot works until the car has a start passing (`slotAlreadyLeft`),
  before or after its slot, and gives a car without a run there one (a
  voided run's re-run). In the change history.
- A slot is reached once it is now or past. Delay before activation moves
  the first start, the whole timetable; while the stage runs, every slot
  run still ahead whose car hasn't left, a countdown already showing
  included. One change record with no entry. Delay and the interval are
  typed like every duration in the dashboard ("2:00").
- Activating a timetable stage whose first slot is past, or nearer than
  `countdownMs`, offers Delay first, prefilled with the whole minutes that
  put the first slot a full countdown away, or activating without one.
  Without a first start activation is refused (`noFirstStart`), as is
  freezing.
- The Countdown button is `SLOT_MANUAL` only. The start card shows New slot
  per car and Delay in its header, and before activation the slot times
  from the start list.
- A pre-start mark shows beside the slot: a timetable slot still ahead
  whose car hasn't left doesn't end "its last run" ("Pre-start gate").

### Pre-start gate

`stage_pre_start` marks a car **at the start** in every start mode: Up next
shows who is waiting at the line and who is unknown. Derived from the
detections, never stored: from the car's latest pre-start detection after the
end of its last run, until it starts. In `SLOT_MANUAL` the same detection also
triggers the countdown. Any detection counts, NFC tap, loop or an assigned
beam passing, so a loop at the line works as well as a tap.

"Its last run" is on **any stage**, its end the finish, else the start: a
pre-start gate reused on the next stage then never marks a car with the
tap it made for the stage before. Times are the server's receive times,
since a tap may carry `timeUnknown`. A car counting down shows its slot
rather than the mark, so in `SLOT_MANUAL` the mark is only seen on a car
whose trigger was ignored. In `SLOT_SCHEDULE` every car has a slot run
long before it is due, so one still ahead whose car hasn't left doesn't
count as its last run, and the mark shows beside the slot. The role is assignable in every start mode and
next to any other gates; it times nothing.

A beam passing there is an unassigned passing like any other, suggested for
the next car to start. Assigning it to a car already queued or on stage
answers 409 `entryAlreadyStarting` and leaves it listed, as the Countdown
button does. A gate's trigger is in the change history with no device (the
server); an assigned one with the marshal's.
