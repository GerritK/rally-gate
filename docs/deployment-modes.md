# Deployment Modes

One codebase, two ways to run `rally-server`, switched by config
(`DB_TYPE`, see `apps/rally-server/src/config/database.config.ts`):

1. **Standalone / laptop** — SQLite, nothing external to install, UI in a
   browser; no Electron. On Windows it opens its ports in the firewall on
   first start (one UAC prompt), as port rules limited to the local subnet —
   Windows' own "allow node.exe" rule breaks under nvm-windows symlinks.
2. **Headless** — `deploy/docker-compose.yml` with Postgres, on a Pi or mini PC,
   managed through the same web UI.

In both, the MQTT broker, the time server and mDNS discovery run inside
rally-server, so **a gate never needs to know which kind of machine the server
is**. rally-server also serves the built dashboard on its API port; the
frontend calls a relative `/api`, so nothing needs the server's address at
build time.

## Standalone packages

`scripts/package-standalone.js` builds, for the OS it runs on: a Windows `.zip`
with `Rally Gate.cmd`, a macOS `.zip` with `Rally Gate.command`, or a Linux
`.tar.gz` with `rally-gate.sh`. No Windows installer for now: with ~100 files
a zip unpacks quickly, and it needs no admin rights beyond the firewall
prompt. What it costs: no Start menu entry, and Explorer lets a marshal
double-click the launcher *inside* the zip, where it fails. CI builds all three
(`.github/workflows/standalone.yml`, on a `v*` tag or by hand) and starts each
one as a smoke test.

A package is a plain folder of ~100 files (~100MB, most of it the node
binary): rally-server bundled into one `main.js` by rolldown, better-sqlite3
beside it as the only `node_modules` entry (a native addon can't be bundled),
and the built dashboard. Not a single executable: Node SEA/`pkg` can't load a
native addon from inside themselves. The bundle is built from the tsc output
so decorator metadata survives, and with `keepNames` and no minification,
because TypeORM derives table names from entity class names.

Starting it opens a console window (closing it stops the server) and the
dashboard in the browser. The console shows only the dashboard URL, the event
file, warnings and errors (`LOG_LEVEL=warn`; unset it for the full Nest log).
Event files live in `~/Documents/Rally Gate/` (`EVENTS_DIR` overrides the
folder); `DB_PATH` pins one file and turns switching off — see below.

Nothing is code-signed: Windows SmartScreen and macOS Gatekeeper warn on
first start (macOS: right-click → Open). No Intel Mac build.

## Time sync

Gates run chrony with rally-server as their **only** source: `gate-config`
writes `server <MQTT_HOST> port 57432 iburst prefer ...` into
`/run/chrony-rally` and the gate installer comments out Debian's `pool` and DHCP
sources. Only-source rather than preferred, because gates agreeing with *each
other* matters more than being absolutely right — with internet sources in the
mix, chrony marked a laptop server 3.5s off as a falseticker, and gates with and
without internet diverged.

The server side is `NtpService`, an embedded SNTP server on **57432/udp**, not
123, which needs admin rights a double-clicked executable doesn't have. It
answers only client-mode packets (modes 6/7 are the classic reflection
amplifier) with a reply the size of the request. A bind failure logs and
continues: a gate without a time source still delivers detections, and the
offset measurement shows the skew.

Check it without a terminal: `Gate.clockOffsetMs` on the Hardware page should
sit near zero. Reaching the 1000ms correction threshold means sync is broken.

## One database = one event

There is no `Event` table, on purpose. `DB_PATH` (SQLite) / `DB_NAME`
(Postgres) is the event: save is the file, load is pointing at it, transfer is
copying it (`pg_dump` for Postgres). An `Event` entity would only pay off with
several events live in one server at once, which isn't the requirement.

### New / open event

Setup's event card creates and opens events; the app bar always shows
which one is open. Standalone only — with `DB_PATH` or Postgres the event is
fixed and the buttons are hidden.

- **An event is a `.sqlite` file in `EVENTS_DIR`**, and the event list is that
  folder's contents — no register that could disagree with the files. Rename,
  delete and back up in the file explorer.
- **New never clears anything**: it writes a new file,
  `<date> <name>.sqlite`, fully built (schema and rally details) before
  switching, so a failure leaves the server on the old event.
- **`current.json`** in the folder names the open file. A server restart (or
  crash mid-event) reopens it without asking. A missing or stale pointer falls
  back to the most recently changed file, and an empty folder to
  `rally-gate.sqlite` — the file the packages used before, so an existing
  install keeps its data.
- **Switching is a restart.** The DataSource is injected into every repository
  at boot and can't be swapped underneath them, so the server exits with code
  75 and `start.js`, which runs it as a child process, starts it again on the
  new file. That is also why switching needs the launcher: the dev loop has
  nothing to restart it. The dashboard polls `GET /api/event` and reloads.
- **Refused while a stage is `ACTIVE`.** Gates publish at QoS 1 on persistent
  sessions, so a detection in flight across the restart would be replayed on
  reconnect into the *new* event.
- **Known hardware**: `hardware.json` in the folder remembers every gate this
  computer has seen (id and name — heartbeat, clock offset and capabilities
  stay per event), kept from heartbeats and renames. The Hardware page lists
  them with **Add** (into the open event) and **Forget**. Not copied into a
  new event automatically: the roster should hold only the gates meant for
  this event, so one showing offline there is really missing. Keyed by
  `GATE_ID`, so a gate given a new id is a new entry. First started without
  the file, it is seeded from the open event's gates. A plain file so a club
  can copy it to a second laptop.

Not built: carrying entries/stages over from the previous event, and
switching under Postgres (it would need `CREATE DATABASE`; Docker's restart
policy would already do the restart).

## Future: online/spectator mode

Not built. One-way push from the local rally-server to a cloud service, so
spectators get live timing without joining the rally network, which stays
closed.
