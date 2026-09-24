# Gate Config UI (design, not built)

A local web interface on the gate Pi, so a marshal can set up and check a gate
without SSH and without re-running the installer. Roadmap item 1; this document
is the design that item asked for, not a description of existing code.

The requirement it serves is "Zero-config gates" in `development-roadmap.md`: a
gate must be installable without knowing anything about the rally it will be
used at, and reconfigurable in the field. Discovery and time sync already
removed the install-time questions; this removes the need to ever SSH into a
gate afterwards.

## What it is

A separate service, `apps/gate-config`, on **port 57434** (next free in the
project's 57430-57439 range). Reached at `http://<gate-hostname>.local:57434`
— the name the Pi already publishes via avahi, see "Gate discovery & heartbeat"
in `architecture.md`.

**Separate from `gate-agent`, deliberately.** The obvious saving would be to add
an HTTP server to `gate-agent` and skip a whole app. That breaks exactly when
it is needed: `gate-agent` runs under `Restart=always`, so a config that makes
it exit — a malformed value, a bad adapter selection — becomes a crash loop, and
if the config UI lives inside it, the one tool that could fix the config dies
with it. In the field that means SSH, which is the thing being removed. The
config service must be the thing that survives a broken gate-agent.

## Where configuration lives

Today the installer bakes values into the systemd unit as `Environment=` lines.
The UI must not edit that unit: a unit file is code, `daemon-reload` is
required, and a partial write bricks the service.

Instead, split data from unit:

```ini
# /etc/systemd/system/rally-gate-agent.service  (written once by the installer)
EnvironmentFile=/etc/rally-gate/gate.env
```

```ini
# /etc/rally-gate/gate.env  (owned by gate-config, rewritten atomically)
GATE_ID=CLUB_START_WP1
MQTT_HOST=rally-server.local
MQTT_PORT=57431
ADAPTER=simulated
```

Consequences, all of them wanted:

- **`gate-agent` needs no code change at all.** It already reads exactly these
  env vars (`apps/gate-agent/src/main.ts`), so the config surface is the one
  that exists rather than a new one.
- Written atomically (temp file + `rename`) so a power cut mid-save leaves
  either the old file or the new one, never half a line. A gate loses power for
  real; it sits on a battery in a forest.
- The installer keeps writing initial values, so a fresh gate is already
  working before anyone opens the UI.

## Applying a change

Saving writes `gate.env` and restarts `rally-gate-agent`. Two privileged
actions are needed, and the service should not run as root for them:

```
# /etc/sudoers.d/rally-gate-config  (installed by install-gate-pi.sh)
rally ALL=(root) NOPASSWD: /usr/bin/systemctl restart rally-gate-agent
rally ALL=(root) NOPASSWD: /usr/bin/chronyc reload sources
rally ALL=(root) NOPASSWD: /usr/bin/nmcli *
```

Exact commands rather than a blanket rule, since this service is reachable by
anyone on the rally network (see "Access" below). `nmcli` needs a wildcard
because Wi-Fi arguments vary; that one is the weak entry and worth revisiting
if the UI ever gains authentication.

### The time source must follow the server address

If a marshal changes `MQTT_HOST`, chrony still points at the old host and the
gate's clock silently drifts away from the rally's — the failure "Clock offset"
in `architecture.md` exists to prevent. So a save also updates the chrony
source.

**Not by rewriting `/etc/chrony/conf.d/` and restarting chrony.** Debian's
default `makestep 1 3` steps the clock on the first few updates after start, so
restarting chrony mid-event can write a step straight into a running `StageRun`
— precisely what "Gate system clock policy" in `decoder-adapters.md` forbids.
Use chrony's mechanism for dynamically supplied servers instead:

```
# /etc/chrony/conf.d/rally-gate.conf  (installer, unchanged afterwards)
sourcedir /run/chrony-rally
```

`gate-config` writes `/run/chrony-rally/rally-server.sources` and runs
`chronyc reload sources`, which adds or replaces sources without a restart and
without a step. This is the same path the distro uses for DHCP-provided NTP
servers (`/run/chrony-dhcp`), so it is a supported configuration rather than a
trick.

## What the page shows

Status first, settings second. A marshal standing at a gate needs "is this
working" far more often than "change this value", and today the only answer is
on the server's Hardware page, a walk away.

- **gate-agent**: active/failed, from `systemctl is-active`.
- **Broker**: connected or not.
- **Clock**: chrony's current offset, from `chronyc tracking`.
- **Network**: current SSID and signal, from `nmcli`.
- **Recent log**: the last ~20 journal lines, verbatim.

On "connected": the honest cheap version is that the journal already says
`connected to broker at …`, so the log panel answers it without any new
mechanism. Deliberately **not** parsing those lines into a status field — log
text is not an interface and would break the next time a message is reworded.
If a real indicator is wanted, the right fix is `gate-agent` writing a small
JSON status file on state change (~10 lines), not a regex over its output. Start
without it; add it when the log panel proves insufficient in the field.

## What it sets

`GATE_ID`, `MQTT_HOST`, `MQTT_PORT`, `ADAPTER`, plus the simulator's
`TRANSPONDERS`/`SIMULATE_INTERVAL_MS` while `SimulatedAdapter` is the only one.

Two of those need care:

- **`GATE_ID` is an identity, not a label.** The server keys `Gate`,
  `GateAssignment` and every stored detection on it. Changing it on a gate
  mid-event makes the old rows orphans and the gate reappear as a new,
  unassigned one. The UI must say so before saving, not after.
- Changing `GATE_ID` should also re-derive the Pi's hostname, the same
  transformation `install-gate-pi.sh` does (letters/digits/hyphens only) —
  otherwise the gate stays reachable under its old `.local` name, which is
  confusing at exactly the wrong moment.

Nothing server-owned appears here, mirroring the DTO rule in `CLAUDE.md`: gate
*role* and stage assignment stay on the server, because that is the plan for the
event, not a property of the hardware.

## Reachability before the gate has a network

The UI is useless if you can only reach it once the gate is already on the
right Wi-Fi — that is the state you need it in. So the gate serves its own
access point when it cannot join anything.

Pi OS Bookworm ships **NetworkManager**, which makes this one command rather
than a hostapd + dnsmasq stack:

```bash
nmcli device wifi hotspot ifname wlan0 ssid "rally-gate-<hostname>" password "<...>"
```

A watchdog decides when to use it: if no saved connection comes up within a
timeout after boot, start the hotspot; when a marshal saves Wi-Fi credentials
through the UI, stop it and join. Crucially it must also fall back **after** a
previously working setup fails — wrong password, gate moved out of range, a
different router at the next event — not only on a virgin gate. That is the
difference between a gate a marshal can rescue and one that needs a keyboard.

Verify on hardware before building: NetworkManager's hotspot and station modes
may not coexist on one radio on every Pi model, which decides whether switching
is instant or needs a drop.

## Access

No authentication, consistent with the deferred-auth decision in
`deployment-modes.md`: the closed rally network is the boundary.

That reasoning does not survive hotspot mode, though. **The hotspot must have a
WPA2 password**, otherwise the gate broadcasts an open network on which anyone
at the event can repoint timing hardware. Derive it from the gate's identity so
it is predictable for the organiser and printable by the installer, rather than
random and lost. Worth deciding deliberately rather than inheriting "no auth"
from the server.

## Open decision: how the page is built

This is the one choice that changes the amount of work, and it is not obvious.

**Plain server-rendered HTML from the Node service.** No build step, no bundle,
nothing for `install-gate-pi.sh` to compile on a Pi, and no CI addition. Six
fields and a status panel do not need a framework. Cost: it is visibly not the
same product as the dashboard, and `packages/ui`'s theme would be copied as a
few CSS variables rather than used.

**Vue + Vuetify via `packages/ui`.** The roadmap names this UI as that package's
planned second consumer, existing precisely so every rally-gate interface reads
as one product, and it would prove the shared-component pattern that
`CLAUDE.md` says needs a second consumer. Cost: a Vite build in the install
path — slow on modest Pi hardware — or shipping prebuilt assets, plus a new
workspace in CI and `optimizeDeps` care for `.vue` files pulled from a
workspace package.

Recommendation: **plain HTML first.** The gate UI is a utility one person opens
on a phone while kneeling next to a Pi, the install path should stay fast on the
weakest hardware, and `packages/ui` gets its second consumer honestly when
there is a second *dashboard-like* surface rather than a settings form. Revisit
if this page grows past a form and a status list.
