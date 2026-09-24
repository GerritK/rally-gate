# Gate Config UI

A local web interface on the gate Pi, so a marshal can set up and check a gate
without SSH and without re-running the installer.

**Status: settings, status and the UI are built (`apps/gate-config`). Wi-Fi and
the AP/hotspot fallback are not** — the sections below describing them are still
design. Until they land, the page is reachable only once the gate is already on
a network, which covers changing the gate's identity or the server address but
not first-time onboarding of a gate with no Wi-Fi.

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

The installer used to bake values into the systemd unit as `Environment=`
lines. The UI must not edit that unit: a unit file is code, `daemon-reload` is
required, and a partial write bricks the service. So data and unit are split:

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
<user> ALL=(root) NOPASSWD: /usr/bin/systemctl restart rally-gate-agent
<user> ALL=(root) NOPASSWD: /usr/bin/chronyc reload sources
```

Exact commands rather than a blanket rule, since this service is reachable by
anyone on the rally network and has no authentication (see "Access" below) —
what it can do as root *is* the boundary. The installer runs `visudo -c` over
the drop-in and removes it if invalid, because a malformed sudoers file locks
out sudo entirely.

The Wi-Fi work will need `nmcli`, whose arguments vary and so would need a
wildcard rule. That is a materially weaker grant than the two above and should
be decided when it is written, not pre-authorised here.

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

- **gate-agent**: active/failed, from `systemctl is-active`. Built.
- **Clock**: `chronyc tracking` output. Built.
- **Recent log**: the last 20 journal lines, verbatim. Built.
- **Network**: current SSID and signal from `nmcli`. Not built, with the rest
  of the Wi-Fi work.

Each probe reports independently, so one failing shows as unavailable for that
row rather than failing the page — a gate without chrony is a real state, not
an error.

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

## How the page is built

**Vue + Vuetify through `packages/ui`** — decided, and this is that package's
second consumer, which `CLAUDE.md` said the shared-component pattern needed
before growing further. Every rally-gate interface therefore reads as one
product, and the theme's conventions apply here too: the running/stopped chip
carries an icon and text rather than colour alone, and `chronyc tracking` output
uses `.rg-timing`.

The cost this was weighed against — a Vite build in the install path — turned
out smaller than it looked: `install-gate-pi.sh` already runs `npm install` at
the repo root, so Vite and Vuetify are downloaded onto every gate Pi today
regardless. What is added is build time, not dependencies. The build is
`tsc && vue-tsc && vite build`; the `vue-tsc` step matters because this app has
no test suite over its `.vue` file, exactly as noted for `apps/web` in
`CLAUDE.md`.

The bundle is roughly 680 kB of JS and 850 kB of CSS including MDI fonts. Large
for a settings form, irrelevant over a local link, and worth revisiting only if
the page is ever served over something slower than Wi-Fi in the same field.

## What is verified, and what is not

Everything touching the operating system is confined to `src/system.ts` for this
reason: systemd, chrony and NetworkManager do not exist on a developer machine,
so that file is the untested surface and the rest is not.

Verified on a developer machine:

- `config-file.ts` under unit test, including every injection case below.
- The API end to end against the running service: field list, save, validation
  rejection, the chrony source file's contents, static serving and SPA fallback.
- That failing system calls degrade rather than break — with no `systemctl` or
  `chronyc` present, `/api/status` returns 200 with per-probe failures, and a
  save reports `saved: true` with the restart failure alongside.
- `tsc`/`vue-tsc`/`vite build`.

Not verified, and only real hardware can:

- That the restart, chrony reload and sudoers rules work.
- That the page renders as intended — there is no headless browser in this repo.
- Anything about Wi-Fi or hotspot mode, which is not written.
