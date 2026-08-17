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

0. **Event-based, not a hard-coded call chain.** "Starting a stage" must stay
   consistent with how the rest of `rally-server` is wired: `EventsService`
   never calls the live feed or the rule engine directly — it emits
   `detection.created`/`stage-run.updated`/`stage-run.split` on
   `EventEmitter2` and `LiveController` just listens. Starting a stage should
   follow the same shape: `StagesService` (or wherever "start" ends up living)
   emits one internal `stage.started` event, and separate, independent
   listeners react to it — one flips the stage's active `GateAssignment` rows
   (see "Gate assignment: plan vs. live" below), another (in `BrokerService`
   or a new gate-sync provider) publishes the per-gate MQTT `sync` message
   below. Neither listener needs to know the other exists. This keeps the
   trigger swappable later (today: a marshal's button click via an eventual
   `POST /stages/:id/start`; later: possibly the first `stage_start`
   detection itself) without touching the gate-assignment or MQTT-publish
   code, and keeps `StagesService` from growing a direct dependency on
   `BrokerService`.
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

## Gate discovery & heartbeat

Gates no longer need a pre-existing `Gate` row before their `GATE_ID` means
anything — "plug in a gate, it appears":

- `gate-agent` publishes `rally/gates/<gateId>/heartbeat` every
  `HEARTBEAT_INTERVAL_MS` (default 15s) — gate-initiated and continuous,
  unlike the stage-scoped `sync`/`ready` messages below, since a gate should
  be visible from boot, before any stage exists. No new broker wiring
  needed: `BrokerService`'s `aedes.on('publish', ...)` (`broker.service.ts:19`)
  already sees every topic regardless of subscription; `GatesService`
  subscribes via its own `@OnEvent('mqtt.message')` handler
  (`gates.service.ts`), matching the same pattern `EventsService` uses for
  detections.
- A heartbeat from an unknown `gateId` makes `GatesService.recordHeartbeat`
  auto-create a `Gate` row (unassigned, no active `GateAssignment` yet — sits
  in the list waiting for a marshal to configure it) instead of requiring one
  to pre-exist.
- `gateId` (`Gate.id`) has no format enforced by the server — plain string
  primary key, no global uniqueness required by force. But it should be
  chosen so it *won't collide* if this gate is ever borrowed/loaned to
  another club or used at a joint event: prefix it with a short club code
  (e.g. `CLUB_START_WP1` rather than `START_WP1`), since one database = one
  event (`deployment-modes.md`) means nothing stops two clubs' gates from
  ending up on the same network, and a collision there would silently merge
  two physically different gates into one `Gate` row. `deploy/install-gate-pi.sh`'s
  `GATE_ID` prompt nudges toward this. No central cross-club registry to
  actually enforce it — same "not ruled out, just very low priority" status as the
  cross-event known-gates registry idea in `deployment-modes.md`.
- `Gate.lastHeartbeatAt` (nullable `datetime`) is stamped on every heartbeat.
  "Online/offline" is `now - lastHeartbeatAt > threshold`, computed
  client-side in the dashboard (30s threshold), same pattern as the
  expected-stage-time overdue idea (`development-roadmap.md`).
- The heartbeat payload's `capabilities` field self-reports what the gate is
  running (`{ capabilities: process.env.ADAPTER ?? 'simulated' }` today,
  since real `DecoderAdapter` selection — `decoder-adapters.md` — isn't wired
  up yet), stored as a read-only string field on `Gate`. Purely descriptive:
  helps whoever's building the event plan see what a gate reports running
  before deciding what role to assign it. Not app config — the adapter is
  actually selected on the Pi via the `ADAPTER` env var
  (`decoder-adapters.md:76-79`); the server field just mirrors that fact so
  it doesn't need a second, unsynced copy of it.
- The web dashboard's "Gates" section (table of
  id/name/online/last-heartbeat/capabilities/active-assignment) and
  "Gate Assignments" section (create/activate/deactivate/delete) replace the
  old raw `PUT /gates/:id` role pre-configuration.

## MQTT broker discovery (planned, not built)

Heartbeat/discovery above assumes a gate already knows where the broker is
(`MQTT_HOST`/`MQTT_PORT`, currently typed in by hand — an interactive prompt
in `deploy/install-gate-pi.sh`, or plain env vars). That's one more thing a
marshal can get wrong or that breaks silently if `rally-server`'s IP changes
(DHCP re-lease, moved to a different machine) — a layer *before* heartbeat-based
discovery even applies, since a gate can't publish a heartbeat to a broker it
doesn't know the address of.

- `rally-server` advertises itself via mDNS/Bonjour (e.g. a service type like
  `_rally-mqtt._tcp.local`, TXT record carrying the MQTT port) when
  `BrokerService` starts listening.
- `gate-agent` tries resolving that service first at startup, before falling
  back to the manual `MQTT_HOST` env var. Manual entry stays as the fallback,
  not something autodiscovery replaces — mDNS/multicast is unreliable on some
  consumer/travel router hardware (blocked or not forwarded), so a rally site
  with flaky APs still needs the escape hatch.
- Fits the "closed rally WiFi" model for free: mDNS is LAN-only by nature (it
  doesn't route off the local network), so it can't leak the broker's
  existence to anything outside the event's own WiFi the way a
  cloud-registry-based discovery scheme would.
- New dependency on both ends (something like `bonjour-service` in Node) —
  Raspberry Pi OS also ships `avahi-daemon`, which is an alternative
  implementation path (shell out / system mDNS) worth weighing against a
  pure-JS library once this gets built.
- Directly relevant to the "Gate config web interface" roadmap item
  (`development-roadmap.md`) — that item's config page already needs an
  "MQTT host" field; autodiscovery would just make that field default to the
  resolved address instead of requiring manual entry, with manual override
  still available in the same UI.

## Gate assignment: plan vs. live

Preparing an event means assigning one physical gate to *every* stage it'll
serve, each with a possibly different role, before the event runs (e.g. gate
7 is `stage_start` for SS1, `stage_finish` for SS2, `time_control` for SS3).
That's inherently one-to-many — several (stage, role) pairs planned ahead of
time for the same hardware — which a single `stageId`/`role` pointer on
`Gate` can't hold.

- `GateAssignment` (`gateId`, `stageId`, `role`, `splitIndex`, `active`) is
  the plan: one row per (gate, stage), created via `POST /gate-assignments`
  during event setup, long before any of them go live.
- Exactly one assignment per gate is `active` at a time.
  `GateAssignmentsService.activate` flips it in a transaction (deactivate the
  gate's other assignments, activate the one being requested) — same moment
  `PUT /gates/:id` used to flip `Gate.stageId`/`role` directly, just
  relocated to a flag on the right plan row instead of a copy. Activation is
  a manual marshal action today (`POST /gate-assignments/:id/activate` from
  the dashboard) — there's no "start stage" server action yet to trigger it
  automatically. When that lands (see "Gate control channel" below), it
  should be a `stage.started` event listener, not a direct call from
  `StagesService` — same event-based shape as the rest of the pipeline.
- `EventsService.applyRules` (`events.service.ts`) queries `GateAssignment`
  where `gateId = X AND active = true` instead of reading
  `gate.stageId`/`gate.role`. `Gate` itself carries no live assignment
  fields — just hardware identity (`id`, `name`, `lastHeartbeatAt`,
  `capabilities`). One source of truth instead of two
  copies that can drift (edit the plan, forget to flip the live pointer).
- Reassigning a gate across stages doesn't corrupt history since
  `StageRun`/`StageSplit` snapshot `stageId` at creation instead of
  live-joining back to `Gate`/`GateAssignment`.
- Deactivating (rather than deleting) an assignment leaves it in the table as
  an audit trail of what a gate used to be — `GET /gate-assignments` returns
  inactive rows too.

## Current scope vs. full vision

This implementation covers Phase 1/2 from the original doc's roadmap: a
working event pipeline with `stage_start`/`stage_finish`/`stage_split` gate
roles producing timed `StageRun`s and `StageSplit`s. Parc Fermé, service
park, penalties, the full rule engine YAML DSL, and the RC4 learning
registry are not built yet — the `Gate.role` enum and `GateRole` in
`packages/shared` already include those roles so the schema doesn't need to
change when they're added.
