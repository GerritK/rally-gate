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
  `GATE_ID` prompt nudges toward this — it defaults the prompt to the Pi's
  current hostname (so a pre-imaged/pre-named Pi needs no typing), and
  separately offers (optional, not forced) to rename the Pi's system
  hostname to match `GATE_ID` via `raspi-config nonint do_hostname` if they
  differ. That is what makes the gate reachable as `<hostname>.local` via
  the avahi/mDNS Raspberry Pi OS already runs — nothing in rally-gate
  publishes a record for a gate, and nothing needs one today, since gates
  only ever connect outward to the broker. It matters for the planned gate
  config UI (`development-roadmap.md`), which is reached by connecting *to*
  the gate.

  **The host name is derived from `GATE_ID`, not equal to it.** A host name
  may contain only letters, digits and hyphens (RFC 1123), while the
  recommended `GATE_ID` format is underscore-separated — so `CLUB_START_WP1`
  becomes `club-start-wp1.local`. Passing the ID through verbatim would write
  a host name avahi refuses to publish, leaving the gate unreachable by name,
  which is the one thing renaming it is for. Keeping them separate also means
  the ID is free to change format without constraining the network name.
  No central cross-club registry to actually enforce global
  uniqueness — same "not ruled out, just very low priority" status as the
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

## Clock offset

A stage time is `finishGate.timestampGate - startGate.timestampGate` — two
timestamps from two physically separate Pis. **What matters is not that
either clock is correct, but that the two agree**; if every clock in the
system is wrong by the same amount, durations are still exact and only the
displayed time of day is off. That reframing is what the design follows.

Left alone, they don't agree. A bare Pi crystal (±50ppm) drifts ~1.5s over an
8-hour event, so two can diverge by ~3s; a Pi with no RTC and no internet
boots from `fake-hwclock` with the time of its last shutdown, hours or days
out. Winning margins are tenths of a second. Nothing about this failure is
visible — it just silently changes who won.

Two mechanisms, with different jobs:

1. **Real sync belongs to NTP, not to this codebase.** Gates run chrony
   against `rally-server`, which serves time from its own clock via an
   embedded SNTP server (`NtpService`, 57433/udp, stratum 10) so it works on a
   closed network with no internet and on any machine — see
   `deployment-modes.md` "Time sync". That gets sub-millisecond agreement. The
   gate side is a `conf.d` drop-in written by `deploy/install-gate-pi.sh`;
   "Gate system clock policy" in `decoder-adapters.md` has the
   step-only-at-boot constraint it relies on.
2. **Measured offset, for visibility and gross failures.** The heartbeat
   `gate-agent` already publishes every 15s carries `sentAt` (its own clock
   at publish time). `GatesService.recordHeartbeat` stores
   `arrivedAt - sentAt` as `Gate.clockOffsetMs` — positive means the gate is
   behind. The Hardware page shows it per gate, amber past 250ms and red once
   it's being corrected, which is how anyone finds out chrony *isn't*
   working. Without this the failure stays silent.

**Why a deadband rather than always correcting.** The measurement is one-way,
so it is really `offset + transit latency` and cannot separate the two. Below
roughly the network's latency, "correcting" would inject jitter into clocks
that may be perfectly fine — a well-synced pair would come out slightly
*worse*. So `GatesService.clockCorrectionMsFor` applies the offset only past
a threshold (`clockCorrectionThresholdMs` setting, default 1000ms), where the
gate's clock is unambiguously wrong rather than merely noisy. The correction
is self-effacing: once chrony is deployed, offsets sit under the threshold
and it never fires.

Correction is applied **at ingest, on the server** (`EventsService`), not on
the gate:

- the gate's clock never moves, so there is no mid-stage clock jump — the
  same hazard the per-gate `sync` topic above is designed around;
- `timestampGate` stays raw evidence and the applied correction is stored
  alongside it as `DetectionEventRecord.clockCorrectionMs`, so effective time
  is always `timestampGate + clockCorrectionMs` and any run can be recomputed
  or undone later;
- it works for a gate with no RTC and no NTP at all, including the window
  before chrony's first sync — the case that otherwise produces a stage time
  measured in days.

Upgrade path: once the server-to-gate `sync` channel above exists, a
round-trip probe (NTP's own arithmetic) separates offset from latency
properly and the deadband stops being needed. Only the estimate changes —
where it's stored and how it's applied stay as they are.

## Server discovery

A gate used to need `rally-server`'s address typed in (`MQTT_HOST`), which is
one more thing a marshal can get wrong and which breaks silently when the
server's IP changes (DHCP re-lease, moved machine). `DiscoveryService`
(`apps/rally-server/src/modules/discovery/`) removes that: it advertises
`_rally-gate._tcp` over mDNS when the server starts, under the name
**`rally-server.local`** (overridable with `MDNS_HOST`, disable with
`MDNS_DISABLE=1`).

**The gate side is deliberately codeless.** What gates use is the advertised
*name*, not a service browse: `gate-agent` resolves `rally-server.local` through
plain `getaddrinfo` like any hostname, and so does chrony for the time source
(see `deployment-modes.md` "Time sync"). One advertisement therefore covers both
MQTT and NTP with no discovery logic to write, test or debug in the field, and
`deploy/install-gate-pi.sh` just defaults `MQTT_HOST` to that name. On the gate
this works because Raspberry Pi OS already ships `avahi-daemon` plus
`libnss-mdns` — the latter is what puts mDNS behind `getaddrinfo`, and the
installer installs both explicitly since the whole path fails silently without
them. The installer verifies it with `getent hosts`, which exercises exactly
that path.

The TXT record still carries `mqtt`/`ntp`/`api` ports. Nothing reads them yet;
they are there for the planned gate config UI, which needs to *show* what it
found rather than resolve one known name.

Consequences and limits:

- **Manual entry stays the fallback, not a legacy path.** mDNS/multicast is
  blocked or not forwarded by some consumer/travel routers, so an IP typed into
  `MQTT_HOST` still wins over the default.
- **mDNS is LAN-only by nature**, so this fits the closed-rally-WiFi model for
  free — it cannot leak the server's existence off the event network the way a
  cloud registry would.
- **Headless mode needs host networking, and has it.** A bridged container can
  neither send nor receive LAN multicast, so `deploy/docker-compose.yml` runs
  rally-server with `network_mode: host` — otherwise the advertisement reaches
  only the Docker bridge and no gate ever sees it. Consequences worth knowing
  before editing that file: the service publishes no ports, it reaches Postgres
  over `127.0.0.1` rather than by service name (Postgres is published on
  loopback only, and that address prefix is the whole protection), and
  `docker-compose.dev.yml`'s simulated gate-agents reach it through
  `host.docker.internal:host-gateway` since the service name no longer resolves.
- The name is fixed rather than per-event, so two clubs' servers on one network
  would collide — the same hazard `GATE_ID` prefixing addresses above. `MDNS_HOST`
  is the escape hatch.

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
- Exactly one assignment per gate is `active` at a time, but activation is
  triggered **per stage, not per assignment** — a marshal activates "SS2",
  not each of SS2's gates individually. `POST /stages/:id/activate` (via
  `StagesService.activate` → `GateAssignmentsService.activateForStage`)
  flips every assignment for that `stageId` to `active` in one transaction,
  same moment `PUT /gates/:id` used to flip `Gate.stageId`/`role` directly,
  just relocated to a flag on the right plan rows instead of a copy. It's a
  manual marshal action from the Live Timing page today (`/setup/stages/:stageId`
  shows assignments read-only, deliberately — that page plans a stage's
  gates, Live Timing runs them) — there's no automatic `stage.started`
  trigger yet. When that lands (see "Gate control channel" below), it should
  be an additional event listener alongside this, not a replacement — same
  event-based shape as the rest of the pipeline.
- `Stage.status` also gets a matching `ACTIVE` value (alongside
  `NOT_STARTED`/`CLOSED`), set the moment `activate` succeeds. This is
  deliberately **not** a replacement for `GateAssignment.active` — the two
  answer different questions, and collapsing them would need a join across
  a module boundary that doesn't otherwise exist:
  - `GateAssignment.active` is what the hot path (`EventsService.applyRules`,
    run per incoming detection) indexes by: "which of this *gate's* several
    planned (stage, role) rows is live right now." A gate can be planned for
    many stages at once, so this is inherently a per-gate fact.
    `GatesModule` owns it and never needs to know about `Stage`.
  - `Stage.status` is the per-stage lifecycle summary the dashboard reads —
    `NOT_STARTED` → `ACTIVE` → `CLOSED`, one-way. Reintroducing a
    computed-from-`GateAssignment` version of "is this stage active" would
    force `GatesModule` to depend on `Stage`, while `StagesModule` already
    depends on `GatesModule` for `GateAssignmentsService` — a cycle, for a
    value `StagesService` can just set directly since it already touches
    both.
  - Because both exist, `StagesService` is responsible for keeping them in
    sync at every transition — `activate` sets `ACTIVE` right after
    `GateAssignmentsService` flips the rows, `close` sets `CLOSED` right
    after it clears them. Critically, a forced activate that steals gates
    from another active stage **closes** that other stage (`activate`
    calls `this.close(bumpedStageId)` for each id `activateForStage` reports
    back via `deactivatedStageIds`) rather than merely resetting its status.
    Deactivating alone isn't enough: the bumped stage's gates are gone
    either way, so anything still `STARTED` on it can never receive a real
    finish detection again — `close` is what turns that into `CANCELLED`
    (DNF) instead of leaving it stuck `STARTED` forever. Resetting to
    `NOT_STARTED` was tried first and was wrong on both counts: it left
    in-progress runs stranded, and it mislabeled a stage that had already
    run cars as "not started."
- Because gates are shared across stages by design (e.g. gate 7 above),
  activating one stage can silently steal a gate that's mid-run for another.
  `activateForStage` checks for this first: if any of the stage's gates are
  currently `active` under a *different* `stageId`, it throws `409` with
  `{ conflictingStageIds }` instead of proceeding. The dashboard surfaces
  that as a warning dialog — cancel, or confirm and retry with `?force=true`,
  which closes the conflicting stage (see above) before activating this one.
  There's no lock preventing the conflict from recurring seconds later (two
  marshals racing the same gate); this is a confirmation prompt, not
  concurrency control.
- There is deliberately no standalone "deactivate stage" action. Turning a
  stage's gates off only ever happens via `StagesService.close`, which calls
  `GateAssignmentsService.deactivateForStage` before flipping `Stage.status`
  to `CLOSED` — one action, not two similar-looking ones a marshal could
  confuse (an earlier version exposed both `POST /stages/:id/activate` and
  `POST /stages/:id/deactivate`; the standalone deactivate was removed
  because "gates off but stage still open" wasn't a state anything actually
  needed, and gave a false impression that a paused stage could safely be
  resumed later without re-checking for gate conflicts). Practical effect:
  closing is the only way to stop a stage from recording detections. Without
  deactivation happening somewhere, a closed stage could otherwise keep
  silently recording detections against it, since `EventsService.applyRules`
  only checks `GateAssignment.active`, never `Stage.status` (see "Current
  scope vs. full vision" for that gap).
- **Closing is terminal.** `StagesService.activate` (backing
  `POST /stages/:id/activate`) refuses with `409` if `Stage.status` is
  already `CLOSED` — there's no reopening a closed stage, matching the
  frontend hiding the Activate button once closed. Deliberate: once a
  stage's results are final, "just reactivate it" would let new detections
  quietly mutate a stage marshals may already be reporting on. Fixing a
  single missed/bad detection after close still goes through the stage-run
  correction endpoints (`PATCH/POST/DELETE /stage-runs`), which don't depend
  on the stage being active.
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
registry are not built yet — `GateRole` in `packages/shared` already includes
those roles, so the schema doesn't need to change when they're added. (The
role lives on `GateAssignment`, not on `Gate`; see "Gate assignment: plan vs.
live" above.)
