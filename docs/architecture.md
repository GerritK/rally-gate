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

## Current scope vs. full vision

This implementation covers Phase 1/2 from the original doc's roadmap: a
working event pipeline with `stage_start`/`stage_finish`/`stage_split` gate
roles producing timed `StageRun`s and `StageSplit`s. Parc Fermé, service
park, penalties, the full rule engine YAML DSL, and the RC4 learning
registry are not built yet — the `Gate.role` enum and `GateRole` in
`packages/shared` already include those roles so the schema doesn't need to
change when they're added.
