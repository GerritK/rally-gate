# Architecture

```
Gate hardware (or SimulatedAdapter)
  -> gate-agent (publishes DetectionEvent over MQTT)
  -> embedded Aedes broker inside rally-server
  -> EventsService (stores DetectionEventRecord, looks up gate + vehicle)
  -> rule engine (gate.role -> start/finish/split a StageRun)
  -> EventEmitter2 ("detection.created", "stage-run.updated", "stage-run.split")
  -> LiveController (Server-Sent Events: /live/detections, /live/stage-runs, /live/stage-run-splits) -> web dashboard
```

Gates are dumb: a gate-agent only knows its own `GATE_ID` and publishes
`{ eventId, gateId, transponderId, timestampGate, source }` to
`rally/gates/<gateId>/detections`. All meaning (what a gate *is* — start,
finish, split, parc fermé...) is assigned centrally via the `Gate.role` field
on the server, matching the "gate must not have hardcoded behavior"
principle in the original project doc.

The MQTT broker runs in-process (Aedes) rather than as a separate service —
see [deployment-modes.md](deployment-modes.md) for why.

## Gate control channel (planned, not built)

Everything above is one-way: gates publish, `rally-server` only listens
(`BrokerService.onModuleInit` forwards incoming packets into the internal
event bus but never publishes back out — `broker.service.ts:19-27`). Two
ideas (clock sync accuracy, gate health visibility) converge on adding a
second, server-to-gate direction:

1. Starting a stage (a real action, not the current generic `PUT /stages/:id`
   upsert) makes `rally-server` look up which gates belong to it (active
   `GateAssignment` rows for that `stageId` — see "Gate assignment: plan vs.
   live" below) and publish `{ stageId, stageNumber, serverTime }` to each of
   those gates individually — `rally/gates/<gateId>/sync`, a sibling of the
   existing `rally/gates/<gateId>/detections` topic gates already know from
   publishing detections. **Not a shared/global topic.** Stages can run
   concurrently with no sequencing enforcement (see `development-roadmap.md`
   "Done" — split classification note), so a global broadcast would resync
   every gate whenever *any* stage starts, including gates on a different
   stage that's mid-run right now — reintroducing the mid-event clock-jump
   risk the `-t` decision exists to avoid. Per-gate topics, addressed using
   the gate-assignment mapping the server already has, mean only the gates
   actually starting receive anything; a gate still only ever needs to know
   its own `GATE_ID`, not its `stageId` — stays dumb.
2. On receipt, a gate resyncs its clock from `serverTime` (this replaces the
   earlier bounded-retry-at-boot sync idea in `decoder-adapters.md` — using
   the stage-started message as the trigger is simpler and naturally
   recurring, once per stage, rather than a one-off startup window) and
   publishes back `rally/gates/<gateId>/ready` with its sync/health status.
3. `rally-server` collects the acks and the dashboard shows "gates ready:
   X/Y" before/while the stage is live — a concrete mechanism for the
   "Gate/gate-node health reporting" roadmap item, not just a clock fix.
4. A symmetric `stage-stopped` message on the same per-gate topic when the
   stage ends. `DecoderAdapter` already has `start()`/`stop()`
   (`decoder-adapters.md:6-9`) — `gate-agent` just doesn't call `stop()`
   today except on `SIGINT`. Wiring `stage-started`/`stage-stopped` to
   `adapter.start()`/`adapter.stop()` means the decoder (real hardware, RF
   frontend included) only runs while a stage is actually active — saves
   power/CPU on a field-deployed Pi, and happens to sidestep a real gap:
   `EventsService` doesn't check `Stage.status` at all today, so a stray
   passing at any time (recon run, testing, someone walking through) creates
   a real `StageRun` if it hits a `stage_start`/`stage_finish` gate. Pausing
   the decoder outside an active stage prevents that at the source — but
   isn't a substitute for the server checking `Stage.status` in the rule
   engine, since a gate that's still running for some reason (misconfigured,
   still starting up) shouldn't be trusted to self-enforce this.

Relies on there being a real gap between "stage declared started" and the
first car actually launching — accepted tradeoff, not revisited unless real
usage shows otherwise. Not designed in detail yet (message schema, how long
`rally-server` waits for acks, what happens if a gate never reports ready).

## Gate discovery & heartbeat (planned, not built)

Today a `Gate` row must already exist (via `PUT /gates/:id` or
`config/sample-gates.yaml`, which nothing actually loads yet) before its
`GATE_ID` means anything — you have to know the exact ID in advance.
Heartbeat-driven discovery flips that to "plug in a gate, it appears":

- Gates periodically publish `rally/gates/<gateId>/heartbeat` — gate-
  initiated and continuous, unlike the stage-scoped `sync`/`ready` messages
  above, since a gate should be visible from boot, before any stage exists.
  No new broker wiring needed: `BrokerService`'s `aedes.on('publish', ...)`
  (`broker.service.ts:19`) already sees every topic regardless of
  subscription.
- A heartbeat from an unknown `gateId` makes `GatesService` auto-create a
  `Gate` row (unassigned, no active `GateAssignment` yet — sits in the list
  waiting for a marshal to configure it) instead of requiring one to
  pre-exist.
- Add `lastHeartbeatAt` to `Gate` — one nullable column, no new table.
  "Online/offline" is `now - lastHeartbeatAt > threshold`, computed
  client-side, same pattern as the expected-stage-time overdue idea
  (`development-roadmap.md`).
- Heartbeat payload can also self-report what the gate is capable of (which
  `DecoderAdapter`/sensors it's running — `decoder-adapters.md`), stored as a
  read-only field on `Gate` (e.g. `capabilities`). Purely descriptive: helps
  whoever's building the event plan see "gate 7 has OpenStint + through-beam"
  before deciding what role to assign it. Not app config — the adapter is
  actually selected on the Pi via the `ADAPTER` env var
  (`decoder-adapters.md:76-79`); the server field just mirrors that fact so
  it doesn't need a second, unsynced copy of it. Deferred along with the rest
  of heartbeat — no mechanism yet for a gate to report anything about itself.
- New "gate list" page in the web dashboard — today's `App.vue` is a
  read-only live/results view with no setup UI at all. Table of gates
  (name/capabilities/enabled/last-heartbeat/online), plus a per-stage
  assignment screen for creating/activating `GateAssignment` rows (see
  below), replacing today's raw `PUT /gates/:id` pre-configuration.

## Gate assignment: plan vs. live

Preparing an event means assigning one physical gate to *every* stage it'll
serve, each with a possibly different role, before the event runs (e.g. gate
7 is `stage_start` for SS1, `stage_finish` for SS2, `time_control` for SS3).
That's inherently one-to-many — several (stage, role) pairs planned ahead of
time for the same hardware — which a single `stageId`/`role` pointer on
`Gate` can't hold.

- `GateAssignment` (`gateId`, `stageId`, `role`, `splitIndex`, `active`) is
  the plan: one row per (gate, stage), created during event setup, long
  before any of them go live.
- Exactly one assignment per gate is `active` at a time. Starting a stage
  flips it in a transaction (deactivate the gate's other assignments,
  activate the one for the stage being started) — same moment `PUT
  /gates/:id` used to flip `Gate.stageId`/`role` directly, just relocated to
  a flag on the right plan row instead of a copy.
- `EventsService.applyRules` (`events.service.ts:79-98`) queries
  `GateAssignment` where `gateId = X AND active = true` instead of reading
  `gate.stageId`/`gate.role`. `Gate` itself carries no live assignment
  fields — just hardware identity (`id`, `name`, `enabled`,
  `lastHeartbeatAt`, `capabilities`). One source of truth instead of two
  copies that can drift (edit the plan, forget to flip the live pointer).
- Reassigning a gate across stages doesn't corrupt history since
  `StageRun`/`StageSplit` snapshot `stageId` at creation instead of
  live-joining back to `Gate`/`GateAssignment`.
- An audit trail of *inactive* assignments (what a gate used to be, not what
  it's planned to be) falls out of this for free if `GateAssignment` rows are
  soft-deactivated rather than deleted — not needed yet, but no extra schema
  work if it turns out to matter later.

## Current scope vs. full vision

This implementation covers Phase 1/2 from the original doc's roadmap: a
working event pipeline with `stage_start`/`stage_finish`/`stage_split` gate
roles producing timed `StageRun`s and `StageSplit`s. Parc Fermé, service
park, penalties, the full rule engine YAML DSL, and the RC4 learning
registry are not built yet — the `Gate.role` enum and `GateRole` in
`packages/shared` already include those roles so the schema doesn't need to
change when they're added.
