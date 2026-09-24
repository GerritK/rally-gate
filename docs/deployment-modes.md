# Deployment Modes

`rally-server` is meant to run two ways from one codebase:

1. **Standalone / laptop mode** — a rally official double-clicks a packaged
   executable. SQLite (`DB_TYPE` unset or `sqlite`) and the embedded MQTT
   broker mean there's nothing external to install. The browser opens to
   `localhost:PORT` for the UI; a console window staying open is fine (no
   Electron/Tauri wrapper — deliberately kept low-effort). Packaging via
   Node SEA/`pkg` lives under `apps/rally-server/packaging/standalone/`
   (not built yet).
2. **Headless / server mode** — runs as a Docker/systemd service on a
   separate device (Pi, mini PC), set `DB_TYPE=postgres` and point at the
   `deploy/docker-compose.yml` Postgres instance. Managed entirely over the
   network through the same web UI.

Switching modes is a config change (`DB_TYPE`, `DB_HOST`, etc. — see
`apps/rally-server/src/config/database.config.ts`), not a code fork.

The MQTT broker (Aedes) is embedded in-process in both modes — there is no
separate Mosquitto/NATS container to run or configure.

## Serving the dashboard

In headless mode `rally-server` serves the built `apps/web` itself, on the
same port as the API (57430). One service, one port, and the frontend calls a
relative `/api/...` so nothing needs to know the server's address at build
time — the old `VITE_API_URL` default pointed every browser at its *own*
localhost, which only worked when the dashboard happened to run on the same
machine as the server.

That is also why the API sits under `/api`: `/vehicles` is both a REST
resource and a page in the dashboard, so serving both from one origin needs
them separated. `main.ts` skips static serving entirely when
`apps/web/dist` is absent, which is the normal dev loop — there Vite serves
the dashboard on 57440 and talks to the API on 57430.

## Time sync

Gates timestamp their own detections and a stage time subtracts two gates'
clocks, so the gates have to agree with each other — see "Clock offset" in
`architecture.md` for why that, and not absolute correctness, is the
requirement.

`rally-server` serves time itself (`NtpService`, an embedded SNTP server), for
the same reason the MQTT broker is embedded: **a gate must never have to know
what kind of machine the server runs on.** So the time reference is rally-server
in both modes, at the same address a gate already uses for MQTT, and neither
mode needs a host time service installed.

It listens on **57432/udp**, not 123, because 123 needs root/admin that a
double-clicked standalone executable does not have. Gates reach it with
chrony's `port` option (`server <host> port 57432 iburst prefer`), written by
`deploy/install-gate-pi.sh`. In headless mode `deploy/docker-compose.yml`
publishes no ports at all — rally-server runs on `network_mode: host` so that
its mDNS advertisement reaches the LAN, and therefore binds this port on the
host directly. If it is ever moved back to bridge networking, the mapping it
needs is `57432:57432/udp` **with the suffix**: compose defaults to TCP and
would otherwise publish a port nothing listens on, leaving gates with no time
source and no error.

Stratum is 10, deliberately poor, so that a gate which *can* see a real
upstream prefers it. The address is not typed in either: chrony points at
`rally-server.local`, the mDNS name the server advertises for itself — see
"Server discovery" in `architecture.md`, including why that does not work in
headless/Docker mode yet.

Whether sync works is visible without touching a terminal: `Gate.clockOffsetMs`
on the Hardware page should sit near zero for every gate. Anything reaching the
1000ms correction threshold means sync is broken, not merely noisy.

## Event model: one database = one event

A rally ("event") doesn't need its own `Event` table, and this is how the
schema is actually built — there is no `Event` entity, and adding one is
explicitly not wanted. `DB_PATH` (SQLite) / `DB_NAME` (Postgres) is
configurable per deployment
(`database.config.ts:4,21`), so mapping "event" to "one database" instead of
a new entity inside a shared multi-tenant DB gets save/load/transfer almost
for free:

- **Save** — the SQLite file already *is* the saved event (stages, gates,
  vehicles, everything in it).
- **Load** — point `DB_PATH` at that file.
- **Transfer to another PC running the same software** — copy the file.
- Same idea for headless/Postgres mode via `DB_NAME` + `pg_dump`/`restore`
  instead of a file copy.

A real `Event` table (with an `eventId` FK migrated across every entity, plus
an event-switcher in the UI) would be strictly more work for something the
filesystem already gives for free — only worth it if multiple events need to
be live in one running server simultaneously, which isn't the requirement
here.

"Global" gates (Parc Fermé, service park — not tied to one stage) already
work with no schema change: `Gate.stageId` is nullable (`gate.entity.ts:15`).

What's actually missing is UX, not data model: a "new event" (create + name
a fresh DB file) / "open event" (pick an existing one) flow — a detail of
the standalone packaging work already on the roadmap (Node SEA/pkg + tray
icon), where "File > New/Open" is a normal desktop-app pattern.

**Known gates across events**: a fresh event file has no gates in it.
Considered a persistent cross-event device registry to avoid re-discovering
the same physical hardware every event — not ruled out, just very low
priority for now. Gates just re-announce via the heartbeat/auto-discovery
mechanism (`architecture.md` "Gate discovery & heartbeat") each time a new
event file is loaded; no extra infrastructure needed unless running enough
events with enough overlapping hardware makes re-assigning gates each time
genuinely annoying.

## Future: online/spectator mode

Not built. The idea is a one-way, **push-based** sync from the local
rally-server to a cloud service, so spectators can see live timing on their
own phones without joining the local rally network (which should stay closed
to outsiders). See the `/live/*` and `/results`-style endpoints as the
natural "public-safe" data boundary if this gets built later.
