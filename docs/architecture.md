# Architecture

```
Gate hardware (or SimulatedAdapter)
  -> gate-agent (DetectionEvent + heartbeat over MQTT)
  -> embedded Aedes broker inside rally-server
  -> EventsService (stores DetectionEventRecord, looks up gate + vehicle)
  -> rule engine (active GateAssignment.role -> start/finish/split a StageRun)
  -> EventEmitter2 ("detection.created", "stage-run.updated", "stage-run.split")
  -> LiveController (SSE /api/live/*) -> web dashboard
```

Gates are dumb: a gate-agent only knows its own `GATE_ID` and publishes to
`rally/gates/<gateId>/detections` and `.../heartbeat`. What a gate *is* —
start, finish, split — is assigned on the server through `GateAssignment`.

The broker runs in-process rather than as a separate Mosquitto, so standalone
mode has nothing external to install.

## Gate discovery & heartbeat

- `gate-agent` publishes a heartbeat every `HEARTBEAT_INTERVAL_MS` (15s) with
  `sentAt` and `capabilities` (the adapter it runs). A heartbeat from an unknown
  `gateId` auto-creates a `Gate` row, unless the `autoDiscoverGates` setting is
  off. Gates can also be added by hand on the Hardware page.
- Online/offline is `now - lastHeartbeatAt > 30s`, computed in the dashboard.
- **`GATE_ID` should carry a club prefix** (`CLUB_START_WP1`). The server
  enforces no format, and two clubs' gates on one network with the same id
  would silently merge into one `Gate` row.
- **The Pi's host name is derived from `GATE_ID`, not equal to it.** Host names
  allow only letters, digits and hyphens, so `CLUB_START_WP1` becomes
  `club-start-wp1.local`; the verbatim id is a name avahi refuses to publish.
  The installer offers the rename. `gate-config` does not re-derive it when
  `GATE_ID` changes there — the gate then keeps its old `.local` name.

## Clock offset

A stage time is `finish.timestampGate - start.timestampGate`: two timestamps
from two separate Pis. **What matters is that the two clocks agree**, not that
either is right. Left alone they don't — a bare Pi crystal drifts ~1.5s over an
event day, and a Pi with no RTC boots with the time of its last shutdown —
against winning margins of tenths of a second, and nothing about that failure is
visible.

Two mechanisms with different jobs:

1. **Real sync is NTP.** Gates run chrony against rally-server's embedded SNTP
   server as their only source — see `deployment-modes.md` "Time sync".
2. **Measured offset, for visibility and gross failures.** `GatesService`
   stores `arrivedAt - sentAt` of each heartbeat as `Gate.clockOffsetMs`
   (positive = gate behind). The Hardware page shows it, amber past 250ms, red
   once it is being corrected — that is how anyone notices chrony *isn't*
   working.

**Deadband, not always-correct.** The measurement is one-way, so it is offset
plus network latency and cannot separate the two; correcting below that would
make a well-synced pair worse. `clockCorrectionMsFor` applies the offset only
past `clockCorrectionThresholdMs` (default 1000ms), where the clock is
unambiguously wrong. With chrony working it never fires.

**Correction happens at ingest, on the server**, never on the gate: the gate's
clock never jumps mid-stage, it works before chrony's first sync, and
`timestampGate` stays raw with the applied amount stored as
`DetectionEventRecord.clockCorrectionMs` — effective time is always
`timestampGate + clockCorrectionMs`, so any run can be recomputed.

## Server discovery

`DiscoveryService` advertises `_rally-gate._tcp` over mDNS as
**`rally-server.local`** (`MDNS_HOST` to override, `MDNS_DISABLE=1` to turn
off). Gates use the *name*, not a service browse: gate-agent (MQTT) and chrony
(time) both resolve it through plain `getaddrinfo`, so there is no discovery
code on the gate at all. That needs `avahi-daemon` + `libnss-mdns`, which the
gate installer installs and checks with `getent hosts`.

- Only reachable LAN IPv4 addresses are advertised. bonjour-service would
  announce every address, and nss-mdns picks one, so a Hyper-V switch or
  link-local address on a Windows laptop sent gates somewhere unreachable.
  Virtual adapters are filtered by name (a heuristic, see the `ponytail:` note).
- A typed `MQTT_HOST` still wins, for networks that block multicast.
- Headless mode runs rally-server with `network_mode: host`, because a bridged
  container can't multicast to the LAN. Consequences in `CLAUDE.md` "Field
  deployment scripts". Docker Desktop's "host" is a VM, so there gates still
  need a typed IP.
- The name is fixed, so two rally-servers on one network collide; `MDNS_HOST`
  is the escape hatch.

## Gate assignment: plan vs. live

One physical gate serves several stages in different roles (gate 7: start of
SS1, finish of SS2). `GateAssignment` (`gateId`, `stageId`, `role`,
`splitIndex`, `active`) is that plan, one row per (gate, stage), created during
setup. `Gate` itself is hardware identity only.

- **Activation is per stage.** `POST /stages/:id/activate` flips all of that
  stage's assignments to `active` in one transaction; a marshal thinks "SS2 is
  running", and per-assignment toggles left stages half-active. Exactly one
  assignment per gate is active, and that is what `applyRules` looks up.
- **Gate conflict:** if one of the stage's gates is active for another stage,
  activate 409s with `{ conflictingStageIds }`. `?force=true` **closes** the
  other stage first — merely deactivating it would leave its `STARTED` runs
  stranded forever, since their finish gate is gone. This is a confirmation
  prompt, not a lock.
- **`Stage.status` and `GateAssignment.active` both exist on purpose.** `active`
  is the per-gate fact the hot path indexes by; `Stage.status`
  (`NOT_STARTED` → `ACTIVE` → `CLOSED`) is the per-stage summary the dashboard
  reads. Deriving one from the other would create a `GatesModule` ↔
  `StagesModule` cycle, so `StagesService` keeps them in step at every
  transition.
- **No standalone deactivate.** Gates only turn off through close, so there is
  no "gates off but stage open" state that looks resumable.
- **Closing is terminal.** Activate 409s on a `CLOSED` stage, so new detections
  can't mutate results already being reported. Fixes after close go through the
  stage-run correction endpoints.
- `StageRun`/`StageSplit` snapshot `stageId` at creation, so reassigning a gate
  never rewrites history.
- Known gap: `applyRules` checks only `GateAssignment.active`, never
  `Stage.status`.

## Gate control channel (planned, not built)

Today everything is gate → server. The planned server → gate direction:

- Starting a stage emits one internal `stage.started` event with independent
  listeners — one activates the gates, one publishes to each of the stage's
  gates — same event-bus shape as the rest of the server, so the trigger (a
  button now, maybe the first start detection later) can change without
  touching either.
- **Per-gate topics** (`rally/gates/<gateId>/sync`), not a global one: stages
  run concurrently, and a broadcast would reach gates mid-run on another stage.
  The gate still only knows its own `GATE_ID`.
- Gates answer on `rally/gates/<gateId>/ready`, so the dashboard can show
  "gates ready X/Y" — the mechanism for gate health reporting.
- A matching `stage-stopped` would call `adapter.stop()`, so the decoder only
  runs during a live stage. That also stops stray passings (recon, testing) from
  creating runs, but doesn't replace the server-side `Stage.status` check above.
- Once this exists, a round-trip probe can replace the one-way offset
  measurement and its deadband.

Not designed in detail: message schema, ack timeout, what a missing ack means.
