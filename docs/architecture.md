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
   upsert) makes `rally-server` look up which gates belong to it
   (`Gate.stageId`, `gate.entity.ts:16`) and publish
   `{ stageId, stageNumber, serverTime }` to each of those gates
   individually — `rally/gates/<gateId>/sync`, a sibling of the existing
   `rally/gates/<gateId>/detections` topic gates already know from
   publishing detections. **Not a shared/global topic.** Stages can run
   concurrently with no sequencing enforcement (see `development-roadmap.md`
   "Done" — split classification note), so a global broadcast would resync
   every gate whenever *any* stage starts, including gates on a different
   stage that's mid-run right now — reintroducing the mid-event clock-jump
   risk the `-t` decision exists to avoid. Per-gate topics, addressed using
   the `Gate.stageId` mapping the server already has, mean only the gates
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

## Current scope vs. full vision

This implementation covers Phase 1/2 from the original doc's roadmap: a
working event pipeline with `stage_start`/`stage_finish`/`stage_split` gate
roles producing timed `StageRun`s and `StageSplit`s. Parc Fermé, service
park, penalties, the full rule engine YAML DSL, and the RC4 learning
registry are not built yet — the `Gate.role` enum and `GateRole` in
`packages/shared` already include those roles so the schema doesn't need to
change when they're added.
