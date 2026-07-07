# RC Rally Timing System

> **Status note (2026-07-07):** This is the original vision document and is kept
> as historical context — the "why" behind the architecture. Several concrete
> decisions below (backend language, message broker, repo layout, database)
> have since changed from what's written here. For the current, accurate state
> of the implementation, see:
> - [`docs/architecture.md`](../docs/architecture.md) — what's actually built
> - [`docs/development-roadmap.md`](../docs/development-roadmap.md) — done / next / deferred
> - [`docs/deployment-modes.md`](../docs/deployment-modes.md) — standalone vs. headless, future online mode
> - [`docs/api.md`](../docs/api.md) — actual current API surface
>
> Sections below that are superseded are marked inline; the core design
> principles (generic gates, centralized rally logic, immutable events,
> parallel stages) are unchanged and still guide the implementation.

## Project Summary

This project aims to build an open, modular timing and event management system for RC rally events using existing WTS / MYLAPS-compatible RC transponders.

The system is not designed as a traditional lap counter. Instead, it should behave like a lightweight rally operating system where every timing gate is a generic sensor node and the central software defines what each gate means.

Typical gate roles may include:

- Parc Fermé entry
- Parc Fermé exit
- Time control
- Pre-start
- Stage start
- Split point
- Stage finish
- Stop control
- Service park entry
- Service park exit

The long-term goal is to support any number of gates, any number of stages, and multiple special stages running in parallel.

---

## Core Design Principle

A gate must not have hardcoded behavior.

A gate only detects transponders and sends events.

The central rally server decides what the event means based on configuration.

```text
Gate
  ↓
Detection Event
  ↓
Event Broker
  ↓
Rally Server
  ↓
Rule Engine
  ↓
State Machine
  ↓
Results / Penalties / Live Timing
```

This makes the system flexible enough to use the same physical gate as a start gate, finish gate, Parc Fermé gate, service gate, or split gate simply by changing configuration.

---

## Technology Decision

### Decoder Base

The recommended decoder base is **OpenStint**.

Reasons:

- Open-source
- Supports RTL-SDR Blog V3 / V4
- Supports HackRF One
- Supports RC3 and RC4 Hybrid transponders
- Supports RC4 learning
- Runs on Linux
- Low hardware requirements
- Suitable for Raspberry Pi based gate nodes
- Better suited for scalable distributed systems than a custom analog-only decoder

### Recommended SDR

For production gates:

```text
RTL-SDR Blog V4
```

Reasons:

- Low cost
- Receive-only is sufficient
- Supported by OpenStint
- Lower power consumption than HackRF
- Suitable for many gates

Optional development hardware:

```text
HackRF One
```

A HackRF One may be useful for protocol research, debugging, and RF experiments, but it is not required for normal rally gates.

**Status:** decision confirmed — hardware has been ordered for two gates on this
basis. RCHourglass (a more proven dedicated decoder) and MYLAPS (commercial)
were both considered and ruled out — MYLAPS on cost, RCHourglass because gate
hardware was already committed to the OpenStint/RTL-SDR path. Software
development is proceeding against the `SimulatedAdapter` first; real OpenStint
RF integration (overhead loop antenna, RC4 hybrid decode) is not yet validated
and is deferred until the event pipeline works end-to-end in simulation.

---

## Gate Node Concept

Each gate should be a self-contained node.

```text
Antenna Loop
  ↓
1:9 HF Balun
  ↓
Optional LNA
  ↓
RTL-SDR Blog V4
  ↓
Raspberry Pi / Linux SBC
  ↓
OpenStint
  ↓
Gate Agent
  ↓
MQTT
  ↓
Rally Server
```

The gate agent publishes over MQTT to a broker embedded directly inside the
rally server process (Aedes, in-process) — there is no separate broker
container to run in either deployment mode. See [Network Architecture](#network-architecture)
and [Database](#database) below.

The gate node should:

- Detect transponder passages
- Timestamp detections
- Store events locally
- Work without permanent network access
- Synchronize with the server once the network returns
- Report health/status information
- Receive configuration from the central server
- Support remote updates later

---

## Gate Hardware v1

Recommended baseline hardware per gate:

| Component | Purpose |
|---|---|
| Raspberry Pi 3B+ / Pi 4 | Runs Linux, OpenStint, and the Gate Agent |
| RTL-SDR Blog V4 | Receives transponder signal |
| 1:9 HF Balun | Matches loop antenna to SDR input |
| Overhead loop antenna | Detects cars passing through the gate |
| DS3231 RTC module | Keeps local time without internet |
| OLED display | Local status / diagnostics |
| Status LEDs | Power, network, detection, error |
| Buzzer | Optional audible feedback |
| Ethernet | Reliable network connection |
| Wi-Fi | Optional wireless connection |
| Local storage | Stores unsent detections |

Optional hardware:

| Component | Purpose |
|---|---|
| GPS module | Accurate independent time source |
| PoE HAT | Power and network through one cable |
| LTE router/modem | Remote standalone operation |
| LiFePO4 battery | Field operation |
| Outdoor enclosure | Weather protection |
| Ferrite cores | Reduce cable noise |
| Metal shielding | Reduce RF noise from the Raspberry Pi |

---

## Raspberry Pi Performance

A Raspberry Pi 5 is not required for the first version.

OpenStint is expected to run on modest Linux hardware, and Raspberry Pi 3B+ / Pi 4 class devices are a better cost/performance choice for gate nodes.

Recommended approach:

```text
Gate v1: Raspberry Pi 3B+ or Raspberry Pi 4
Development / server: Mini PC or Raspberry Pi 5
```

A Raspberry Pi Zero 2 W may be tested later as a low-cost option, but it should not be the first guaranteed target until performance has been verified.

---

## Antenna Concept

The current concept assumes an overhead antenna.

The antenna will run above the RC rally track rather than being buried under the track.

Recommended initial setup:

```text
Overhead Loop
  ↓
1:9 HF Balun
  ↓
Short coax cable
  ↓
RTL-SDR Blog V4
  ↓
Short USB extension
  ↓
Raspberry Pi
```

### Notes

- Keeping the SDR close to the antenna is beneficial.
- Short coax cables reduce losses and interference.
- The Raspberry Pi should not sit directly inside the loop.
- Keep the Pi approximately 20–50 cm away from the antenna/balun.
- Use a short USB extension between RTL-SDR and Raspberry Pi.
- Add ferrite cores to USB and power cables.
- Use a clean power supply.
- Test whether an LNA is actually needed before adding one.
- With very short cable runs, an LNA may be unnecessary or may even overload the SDR.

### Balun

A balun is recommended because the loop is a balanced antenna while the SDR input is unbalanced.

Initial recommendation:

```text
1:9 HF Balun
```

The balun should be placed close to the loop.

---

## Autarkic Gate Operation

Each gate should continue working even when the network is unavailable.

Local gate behavior:

1. Detect transponder
2. Timestamp detection
3. Store event locally
4. Try to send event to broker/server
5. Mark event as synced after acknowledgement
6. Retry unsent events until successful

Example local detection record:

```json
{
  "event_id": "01JZ8HD2W7Q2R0B8ZRA7K4CMVK",
  "gate_id": "START_WP1",
  "transponder_id": "1234567",
  "timestamp": "2026-07-06T12:00:00.123Z",
  "source": "openstint",
  "signal_strength": 82,
  "synced": false
}
```

---

## Time Synchronization

Accurate timestamps are important when multiple gates are used.

Possible time sources:

1. NTP over local network
2. RTC module for offline time retention
3. GPS module for independent precise time

Recommended v1:

```text
RTC on every gate
NTP when network is available
Optional GPS for high-end gates
```

For stage timing, start and finish gates must have sufficiently synchronized clocks. If the event server receives raw gate events from distributed nodes, it should store both:

- The timestamp generated by the gate
- The timestamp when the server received the event

---

## Network Architecture

```text
Gate Nodes
  ↓
MQTT (embedded Aedes broker, in-process inside Rally Server)
  ↓
Rally Server
  ↓
SQLite (standalone) or PostgreSQL (headless) — config-driven, one codebase
  ↓
Web UI / API
```

**Decided:** MQTT, not NATS — simpler to set up for a hardware-oriented
prototype, as originally reasoned below. The broker (Aedes) runs embedded
in-process inside the rally-server rather than as a separate container, so
standalone/laptop mode has zero external services to install. See
[`docs/deployment-modes.md`](../docs/deployment-modes.md) for the two run
modes this enables.

Original comparison, for reference:

MQTT advantages:

- Simple
- Common in IoT
- Easy to debug
- Many libraries

NATS advantages:

- High performance
- Simple pub/sub
- Good for distributed systems
- Request/reply patterns

---

## Event Model

Every detection should be represented as an immutable event.

Example event:

```json
{
  "event_id": "01JZ8HD2W7Q2R0B8ZRA7K4CMVK",
  "event_type": "transponder_detected",
  "gate_id": "START_WP1",
  "transponder_id": "1234567",
  "timestamp": "2026-07-06T12:00:00.123Z",
  "source": "openstint",
  "metadata": {
    "signal_strength": 82,
    "decoder": "openstint",
    "node_id": "gate-start-wp1"
  }
}
```

Events should never be modified after creation.

Derived state should be calculated by the Rally Engine.

---

## Gate Configuration

Example gate configuration:

```yaml
gates:
  PF_IN:
    name: "Parc Fermé Entry"
    role: "parc_ferme_in"

  PF_OUT:
    name: "Parc Fermé Exit"
    role: "parc_ferme_out"

  TC_WP1:
    name: "Time Control WP1"
    role: "time_control"
    stage: "WP1"

  START_WP1:
    name: "Start WP1"
    role: "stage_start"
    stage: "WP1"

  SPLIT1_WP1:
    name: "Split 1 WP1"
    role: "stage_split"
    stage: "WP1"
    split_index: 1

  FINISH_WP1:
    name: "Finish WP1"
    role: "stage_finish"
    stage: "WP1"

  STOP_WP1:
    name: "Stop Control WP1"
    role: "stop_control"
    stage: "WP1"

  SERVICE_IN:
    name: "Service Park Entry"
    role: "service_in"

  SERVICE_OUT:
    name: "Service Park Exit"
    role: "service_out"
```

---

## Supported Gate Roles

Initial gate roles:

```text
parc_ferme_in
parc_ferme_out
time_control
pre_start
stage_start
stage_split
stage_finish
stop_control
service_in
service_out
manual_checkpoint
```

The software should allow new roles later.

---

## Rally State Machine

The system should maintain state per vehicle and optionally per stage.

Possible vehicle states:

```text
REGISTERED
SCRUTINEERING
PARC_FERME
RELEASED_FROM_PARC_FERME
AT_TIME_CONTROL
PRE_START
READY_TO_START
ON_STAGE
FINISHED_STAGE
STOP_CONFIRMED
IN_SERVICE
RETIRED
DISQUALIFIED
```

Possible stage run states:

```text
NOT_STARTED
READY
STARTED
FINISHED
CONFIRMED
CANCELLED
```

Important principle:

```text
vehicle_id + stage_id = independent stage run state
```

This allows multiple stages to run in parallel.

---

## Parallel Special Stages

The system must not assume that there is only one active stage.

Example:

```text
Car 12 → ON_STAGE WP1
Car 27 → ON_STAGE WP2
Car 34 → PARC_FERME
Car 51 → IN_SERVICE
```

Each stage can have its own start gate, finish gate, split gates, and control points.

The system must support:

- Multiple active stages
- Multiple cars on different stages
- Multiple gates reporting at the same time
- Independent timing per stage
- Independent penalties per stage or per event

---

## Rule Engine

The rule engine converts detection events into actions.

Example rules:

```yaml
rules:
  - name: "Start stage run"
    when:
      gate_role: "stage_start"
    actions:
      - type: "start_stage_run"

  - name: "Finish stage run"
    when:
      gate_role: "stage_finish"
    actions:
      - type: "finish_stage_run"

  - name: "Record split"
    when:
      gate_role: "stage_split"
    actions:
      - type: "record_split"

  - name: "Enter Parc Fermé"
    when:
      gate_role: "parc_ferme_in"
    actions:
      - type: "set_vehicle_state"
        state: "PARC_FERME"

  - name: "Exit Parc Fermé"
    when:
      gate_role: "parc_ferme_out"
    actions:
      - type: "check_parc_ferme_release"
      - type: "set_vehicle_state"
        state: "RELEASED_FROM_PARC_FERME"

  - name: "Enter service"
    when:
      gate_role: "service_in"
    actions:
      - type: "start_service_timer"

  - name: "Exit service"
    when:
      gate_role: "service_out"
    actions:
      - type: "finish_service_timer"
```

Rules should be configurable and not hardcoded where possible.

**Status:** not yet built this way. `stage_start`/`stage_finish`/`stage_split`
rules are currently hardcoded in `EventsService` on the server — fine at the
current scale. A YAML-driven rule engine like the one above is deliberately
deferred (see `docs/development-roadmap.md`), not abandoned.

---

## RC4 Learning Concept

RC4 / RC4 Hybrid transponder learning should only be required once per transponder.

Recommended flow:

```text
Learning Gate
  ↓
OpenStint RC4 learning
  ↓
Local registry update
  ↓
Upload to Rally Server
  ↓
Central Transponder Registry
  ↓
Synchronize registry to all gates
```

Each gate should maintain a local copy of the transponder learning registry.

The server should track:

- Known transponders
- Learning status
- Assigned vehicle
- Assigned driver
- Last seen gate
- Last seen time

Example status values:

```text
UNKNOWN
LEARNING_REQUIRED
LEARNED
ASSIGNED
DISABLED
```

---

## Data Model

### Vehicle

```text
id
start_number
driver_name
co_driver_name
transponder_id
class
status
```

### Transponder

```text
id
transponder_code
type
learning_status
assigned_vehicle_id
created_at
updated_at
```

### Gate

```text
id
name
role
stage_id
node_id
enabled
location
metadata
```

### Gate Node

```text
id
hostname
ip_address
software_version
openstint_version
last_seen_at
health_status
time_source
battery_status
```

### Stage

```text
id
name
stage_number
status
planned_start_time
configuration
```

### Detection Event

```text
id
event_id
gate_id
transponder_id
vehicle_id
timestamp_gate
timestamp_server
raw_payload
processed
```

### Stage Run

```text
id
vehicle_id
stage_id
start_time
finish_time
duration_ms
status
```

### Split Time

```text
id
stage_run_id
gate_id
split_index
timestamp
elapsed_ms
```

### Penalty

```text
id
vehicle_id
stage_id
reason
seconds
source
created_at
```

### Service Session

```text
id
vehicle_id
service_area_id
entry_time
exit_time
duration_ms
status
```

---

## Database

**Decided:** database choice is config-driven per [deployment mode](../docs/deployment-modes.md),
not a single fixed recommendation:

- **Standalone/laptop mode:** SQLite — nothing external to install.
- **Headless/server mode:** PostgreSQL, via `deploy/docker-compose.yml`.

Same TypeORM entities, same codebase — switching is a config change
(`DB_TYPE`, `DB_HOST`, ...), not a fork. Redis is not currently used; the
original idea of Redis for live-timing cache / temporary queues is not
ruled out for later, but Server-Sent Events + the primary DB have been
sufficient so far.

---

## API

The server should expose a REST API and optionally WebSocket streams.

Initial API areas:

```text
/events
/gates
/gate-nodes
/vehicles
/transponders
/stages
/stage-runs
/penalties
/live
/results
/config
```

WebSocket / SSE streams:

```text
/live/detections
/live/stage-runs
/live/results
/live/gate-health
```

**Status:** this is the full eventual target surface, not what's live today.
Actual current API (Server-Sent Events, not WebSocket): `/gates`, `/vehicles`,
`/stages`, `/stage-runs`, `/stage-runs/:id/splits`, `/events`,
`/classification/stages/:stageId`, `/classification/overall`, plus
`/live/detections`, `/live/stage-runs`, `/live/stage-run-splits`. No
`/penalties`, `/results`, `/config`, `/gate-nodes`, or `/live/gate-health` yet,
and no auth. See [`docs/api.md`](../docs/api.md) for the authoritative list.
Default ports: rally-server API on `57430`, embedded MQTT broker on `57431`
(this project's own services use the dedicated `57430`–`57439` range instead
of framework defaults, to avoid colliding with other local services).

---

## Web UI

Suggested modules:

- Event dashboard
- Gate status
- Live detections
- Vehicle management
- Transponder assignment
- RC4 learning status
- Stage configuration
- Gate role configuration
- Parc Fermé overview
- Service overview
- Live timing
- Results
- Penalty management
- Import/export

---

## Gate Agent

The Gate Agent is a small program running on every gate node.

Responsibilities:

- Start/monitor OpenStint
- Read detections from OpenStint
- Normalize detection events
- Add gate metadata
- Add timestamps
- Store locally
- Publish to MQTT/NATS
- Retry unsent events
- Receive configuration
- Report health status

Gate Agent should be independent from rally logic.

---

## OpenStint Integration

Possible integration paths:

1. Read OpenStint output directly
2. Use ZeroMQ if available
3. Wrap OpenStint process and parse messages
4. Add an adapter layer

Recommended internal abstraction:

```text
DecoderAdapter
```

This allows support for other decoder systems later.

Example adapters:

```text
OpenStintAdapter
RCHourglassAdapter
ManualEntryAdapter
SimulatedAdapter
```

---

## Simulation Mode

The project should include a simulation mode from the beginning.

Simulation mode should allow development without physical gates.

Example simulated event:

```bash
rallyctl simulate detection \
  --gate START_WP1 \
  --transponder 1234567 \
  --timestamp now
```

This is important for:

- UI development
- Rule engine testing
- State machine testing
- CI tests
- Demo environments

---

## Repository Structure

**Superseded** — the structure below (Python-shaped `services/` + separate
`simulator` service + `web/` + a `deploy/mqtt/` container) was the original
sketch. The actual repo (`rally-gate`), adapted for the
[NestJS/TypeScript stack](#suggested-tech-stack) and the
[standalone/headless deployment model](../docs/deployment-modes.md), is an
npm-workspaces monorepo:

```text
rally-gate/
  package.json                 # npm workspaces root
  README.md
  docs/
    architecture.md
    hardware.md
    decoder-adapters.md
    deployment-modes.md
    event-model.md
    api.md
    development-roadmap.md
  apps/
    rally-server/               # NestJS
      src/modules/{gates,gate-nodes,vehicles,transponders,stages,stage-runs,events,penalties,rules-engine,live,config}/
      packaging/standalone/     # Node SEA/pkg build, tray-icon assets (not built yet)
      Dockerfile                 # headless mode only
    gate-agent/                 # runs on Pi or locally; no Dockerfile (needs raw USB/SDR access)
      src/adapters/{openstint,rchourglass,simulated,manual-entry}.adapter.ts
    web/                        # Vue 3 + TS + Vite
  packages/
    shared/                     # event model, gate-role enums, DTOs shared across all apps
  deploy/
    docker-compose.yml          # headless/full-dev: postgres + rally-server + gate-agent(s)
    docker-compose.dev.yml
    postgres/
  config/
    sample-gates.yaml
    sample-stages.yaml
  scripts/
    seed-demo-data.js
```

Key differences from the original sketch:

- No separate `simulator` service — it's `simulated.adapter.ts` inside
  gate-agent's `DecoderAdapter` set.
- No `deploy/mqtt/` — the MQTT broker is embedded (Aedes) in both deployment
  modes, not a separate container.
- A `packages/shared` workspace exists because the whole stack is TypeScript
  now (wasn't applicable when this doc assumed a Python backend + React
  frontend).
- Plain npm workspaces, deliberately not Nx/Turborepo.

---

## Tech Stack

**Decided** (superseding the Python/FastAPI recommendation originally
written here): the whole stack is Node.js/TypeScript, chosen to stay in the
team's area of expertise rather than introduce Python as an additional
unknown alongside the hardware/RF work.

### Backend

```text
Node.js / TypeScript
NestJS
TypeORM
SQLite (standalone mode) or PostgreSQL (headless mode) — config-driven
MQTT (embedded Aedes broker, in-process)
```

### Frontend

```text
Vue 3 (Composition API)
TypeScript
Vite
```

Not React, not Angular — Vue is the team's current day-to-day framework.

### Deployment

Two modes from one codebase — see [`docs/deployment-modes.md`](../docs/deployment-modes.md):

```text
Standalone: single packaged Node executable (Node SEA / pkg), SQLite, no install ceremony
Headless: Docker Compose, PostgreSQL, managed remotely over the web UI
```

---

## Development Phases

**Status:** Phases 1–2 are done and Phase 3 is partially done (splits and
classification work; gate health dashboard doesn't exist yet). This section
is kept for the original long-term shape of the plan — for the actual
up-to-date done/next/deferred list, see
[`docs/development-roadmap.md`](../docs/development-roadmap.md).

### Phase 1 – Core Event Pipeline (done)

Goals:

- Create repository
- Set up Docker Compose
- Add PostgreSQL
- Add MQTT broker
- Build Rally Server
- Build Gate Agent stub
- Store detection events
- Show live detections in Web UI

### Phase 2 – Start / Finish Timing (done)

Goals:

- Configure gates as stage start / stage finish
- Assign transponders to vehicles
- Create stage runs
- Calculate duration
- Display results

### Phase 3 – Multiple Gates and Multiple Stages (partially done)

Goals:

- Support any number of gates
- Support any number of stages
- Support parallel stages
- Add split points — done (`stage_split` role, `StageSplit` entity, live SSE stream)
- Add gate health dashboard — not started

### Phase 4 – Rally Controls

Goals:

- Parc Fermé
- Time control
- Pre-start
- Stop control
- Service park
- Manual penalties

### Phase 5 – Autarkic Gate Nodes

Goals:

- Local gate storage
- Offline queue
- Sync after reconnect
- RTC support
- Gate node health reporting

### Phase 6 – RC4 Learning Registry

Goals:

- Learning gate workflow
- Central transponder registry
- Sync learned transponder data to all gates
- UI for learning status

### Phase 7 – Event Operations

Goals:

- Import/export event data
- Printable results
- Live spectator view
- Backup/restore
- Multi-day event support

---

## MVP Definition

**Status: achieved and exceeded.** All of the below is working end-to-end via
simulated detections, plus split timing and per-stage/overall classification
that go beyond the original MVP scope. See
[`docs/development-roadmap.md`](../docs/development-roadmap.md) for what's
built next.

The first useful MVP should support:

- One event
- One or more vehicles
- Transponder assignment
- Two gates: start and finish
- One special stage
- Live detection list
- Automatic stage time calculation
- Manual correction
- Results table

MVP hardware:

```text
2 x Gate Node
1 x Rally Server
```

MVP gate roles:

```text
stage_start
stage_finish
```

---

## Example MVP Flow

1. Create event
2. Add vehicles
3. Assign transponder IDs
4. Configure START_WP1 gate
5. Configure FINISH_WP1 gate
6. Vehicle crosses START_WP1
7. Server creates StageRun
8. Vehicle crosses FINISH_WP1
9. Server closes StageRun
10. Result appears in live timing

---

## Important Architectural Requirements

- Events are immutable
- Gates are generic
- Rally logic is centralized
- Gate roles are configurable
- Rules should be extendable
- Multiple stages must be supported
- Offline gate operation must be possible
- Manual correction must be possible
- All automatic actions should be auditable
- The system must support simulation mode

---

## Future Vision

The project should become a modular RC rally operating system, not just timing software.

Long-term features may include:

- Multiple event formats
- Class-based results
- Seeding and start orders
- Automatic start countdown
- Driver display
- Spectator display
- Remote gates over LTE
- Battery monitoring
- GPS time synchronization
- Rule presets for different clubs
- Plugin system for custom gate roles
- Support for non-OpenStint decoders
- Mobile-friendly event control UI
- Offline-first rally operation

On "Spectator display" specifically: the decided shape for this is a
one-way, **push-based** sync from the local rally-server to a cloud service
(never inbound to the rally network, which stays closed to outsiders for
security/stability of the actual timing gates). See
[`docs/deployment-modes.md`](../docs/deployment-modes.md#future-onlinespectator-mode)
for the current thinking — not built yet.

---

## Original Bootstrap Task (completed)

This was the original instruction used to scaffold the repository — kept here
as historical record. It's done: the repo exists at `rally-gate` with a
working event pipeline over simulated detections (NestJS instead of FastAPI,
npm-workspaces monorepo instead of standalone `services/`, SQLite dev DB
instead of Postgres-only — see the status notes throughout this doc for what
changed).

1. ~~A Docker Compose development environment~~
2. ~~PostgreSQL~~ → SQLite for dev/standalone, Postgres for headless (config-driven)
3. ~~MQTT broker~~ → embedded Aedes, in-process
4. ~~FastAPI rally-server~~ → NestJS rally-server
5. Simple gate-agent simulator — done (`SimulatedAdapter`, interval + one-off CLI)
6. Database schema for gates, vehicles, transponders, detection events, stages, and stage runs — done, plus `StageSplit`
7. REST API for creating vehicles, gates, stages, and detection events — done
8. WebSocket or Server-Sent Events endpoint for live detections — done (SSE)
9. Minimal web UI showing live detections and calculated stage times — done (Vue dashboard), plus splits and classification

Real OpenStint integration has not started — the software side was, and
still is, deliberately built and validated against simulated events first.
For what to work on next, use
[`docs/development-roadmap.md`](../docs/development-roadmap.md), not this
section — treat this as an existing, runnable codebase to extend, not a
green field.
