# Gate Config UI

A local web interface on the gate Pi, so a marshal can set up and check a gate
without SSH and without re-running the installer.

**Status: built; hotspot and join verified on a Pi, the failure paths not yet.**
Settings, status, the UI, joining a Wi-Fi network and the hotspot fallback are
all written; what no developer machine can check is whether station and hotspot
mode coexist on a given Pi's radio, which decides whether switching between them
is instant or needs a drop. See "What is verified, and what is not".

The requirement it serves is "Zero-config gates" in `development-roadmap.md`: a
gate must be installable without knowing anything about the rally it will be
used at, and reconfigurable in the field. Discovery and time sync already
removed the install-time questions; this removes the need to ever SSH into a
gate afterwards.

## What it is

A separate service, `apps/gate-config`, on **port 57439** (see the port table in
`CLAUDE.md`). Reached at `http://<gate-hostname>.local:57439`
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

### Wi-Fi goes through a wrapper, not a sudoers rule for `nmcli`

`nmcli`'s arguments vary with the network being joined, so a sudoers rule for it
would need a wildcard — and that grant is **effectively a root shell** on a
service with no authentication:

- `nmcli connection import type openvpn file …` runs that file's `up` script as
  root, so anyone who can reach this page can execute arbitrary code.
- Short of that trick, arbitrary control of routing and DNS on a gate is a
  man-in-the-middle on the timing path.
- sudoers wildcards are leaky in their own right: `nmcli device wifi connect *`
  matches across spaces, so a caller can append further arguments.

Polkit was considered as the native alternative — NetworkManager has its own
action names — and rejected: `org.freedesktop.NetworkManager.settings.modify.system`
still permits creating a VPN connection with an up-script, so it is no narrower
in capability, only in mechanism, and it adds a second permission system whose
behaviour on Pi OS would have to be verified.

What is installed instead is `deploy/rally-gate-net`, a wrapper at
`/usr/local/sbin/rally-gate-net` with three subcommands (`join`, `hotspot`,
`watchdog`) in which **every argument passed to `nmcli` is a literal except the
SSID and the Wi-Fi password**, in fixed positions:

```
<user> ALL=(root) NOPASSWD: /usr/local/sbin/rally-gate-net
```

The grant therefore reads "join a network / raise the hotspot" rather than "be
root". Two details that carry weight:

- **The hotspot password is read by the wrapper from `gate.env`, not passed in.**
  Otherwise the grant could be used to raise an access point with a password
  only the caller knows.
- Read-only calls — `nmcli device status`, `nmcli device wifi list` — do not go
  through it at all and run unprivileged. The scan uses `--rescan auto` rather
  than `yes`: a forced rescan is privileged *and* takes the radio off its
  current network for a few seconds, which disconnects a marshal who is reading
  this page over the gate's own hotspot.

Keep it that way when extending it. A subcommand that passes a *property name*
through to `nmcli connection modify` would hand back everything this design
removes.

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
- **Network**: which Wi-Fi the gate is on, or that it is on its own hotspot,
  from `nmcli device status`. Built.

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

`GATE_ID`, `MQTT_HOST`, `MQTT_PORT`, `HEARTBEAT_INTERVAL_MS` and
`HOTSPOT_PASSWORD`, plus `ADAPTER` and the simulator's
`TRANSPONDERS`/`SIMULATE_INTERVAL_MS` while `SimulatedAdapter` is the only one.

The decoder settings sit in their own card: they are the one group that follows
the hardware in the box rather than the rally, and all of them but `ADAPTER`
disappear the moment an adapter other than the simulator exists. Which card a
field lands in is a `group` on its spec in `config-file.ts`, not a list in the
Vue component — the page renders one card per group and nothing outside them, so
a field with a group the component does not know about would be a setting a
marshal simply cannot reach, with no error to say so. `config-file.spec.ts`
fails on exactly that. Both cards are one `<v-form>` and one PUT, so the save
button sits after them rather than in either.

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

The watchdog is `rally-gate-net watchdog`, run by `rally-gate-hotspot.timer`
(`OnBootSec=60s`, then every 30s). It raises the hotspot when the radio is
associated with nothing and the hotspot is not already up, so it covers both the
virgin gate and — the case that actually matters — a gate whose previously
working network stops working: wrong password, moved out of range, a different
router at the next event. That is the difference between a gate a marshal can
rescue and one that needs a keyboard.

Two deliberate consequences:

- **Joining never restores the hotspot on failure.** `join` takes the hotspot
  down first (the radio cannot hold both on most Pi models), attempts the
  connection, and leaves recovery to the watchdog a minute later. One recovery
  path, exercised by every failure mode, instead of error handling that is only
  ever reached by one of them.
- The hotspot connection is created with `connection.autoconnect no`, or
  NetworkManager races the saved Wi-Fi at every boot and the gate comes up on
  its own island instead of the rally network.

Known ceiling: once the hotspot is up, it stays up until someone joins a network
through the page — a gate carried back into range of its own router does not
reconnect by itself, because the hotspot holds the radio. Acceptable because a
marshal is standing at the gate anyway in that situation; the upgrade, if it
ever bites, is for the watchdog to drop the hotspot periodically and retry saved
connections.

**Reset Wi-Fi** on the page (`rally-gate-net reset`) forgets every saved Wi-Fi
network and raises the hotspot. Forgetting, not just disconnecting, because a
saved network in range autoconnects at the next boot — so it is the one way to
force a gate into hotspot mode while its old network is still around, e.g.
before it goes to an event with a different router, or to test the fallback.
The page asks for confirmation first, since it takes the gate off the network
the marshal is probably reading it over.

The UI treats a lost connection during a join as success-shaped rather than as a
failure: when the page is being read *over* the hotspot, taking the hotspot down
means the reply has no route back. Reporting "failed" there would send a marshal
to re-enter a password that is in fact being used.

**Captive portal.** Joining the hotspot opens the config page by itself on a
phone, the way hotel Wi-Fi does. Two pieces: the installer drops
`address=/#/10.42.0.1` into `/etc/NetworkManager/dnsmasq-shared.d/`, so on the
hotspot every DNS name resolves to the gate, and gate-config listens on port 80
too (`CAPTIVE_PORT`, set only in the unit, bound via `CAP_NET_BIND_SERVICE`
rather than root), answering everything there with a 302 to
`http://<address the client reached>:57439/`. The phone's connectivity probe
gets that redirect instead of the answer it expects and shows the page. Also
unverified on hardware.

**Still unverified on hardware:** whether NetworkManager's hotspot and station
modes coexist on one radio on a given Pi model, which decides whether switching
is instant or needs a drop.

## Access

No authentication, consistent with the deferred-auth decision in
`deployment-modes.md`: the closed rally network is the boundary.

That reasoning does not survive hotspot mode, though. **The hotspot has a WPA2
password**, otherwise the gate broadcasts an open network on which anyone at the
event can repoint timing hardware.

It is `HOTSPOT_PASSWORD` in `gate.env`, defaulting to `rally-gate` and asked for
by the installer — predictable on purpose rather than generated, because the
organiser needs it on a sticker and a random one nobody wrote down is a gate
that needs a keyboard. The SSID is `rally-gate-<hostname>`, matching the `.local`
name the gate is already reachable under.

It is readable through `GET /api/config` like every other field, which is
consistent rather than an oversight: anyone already on the rally network is
inside the boundary, and this password exists to draw a boundary around the
gate's *own* access point. The **Wi-Fi client** password is different and never
touches `gate.env` — it goes to NetworkManager, which stores it 0600 under
`/etc/NetworkManager/system-connections`, so this service neither writes it nor
can read it back.

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

- `config-file.ts` and `network.ts` under unit test (63 cases), including every
  injection case below, `nmcli --terse` escaping, and the SSID/password rules.
- `deploy/rally-gate-net`'s branches against a stub `nmcli` on `PATH`: the
  watchdog raises the hotspot only when the radio is associated with nothing and
  the hotspot is not already up; `join` drops the hotspot before connecting and
  omits the password argument entirely for an open network; the hotspot password
  comes from `gate.env` and falls back to the default when absent; an SSID or
  subcommand `nmcli` would read as one of its own options exits 64. Argument
  vectors were checked directly, so an SSID or password containing spaces stays
  one argument.
- The API end to end against the running service: field list, save, validation
  rejection, the chrony source file's contents, static serving and SPA fallback.
- That failing system calls degrade rather than break — with no `systemctl` or
  `chronyc` present, `/api/status` returns 200 with per-probe failures, and a
  save reports `saved: true` with the restart failure alongside.
- `tsc`/`vue-tsc`/`vite build`.

Verified on a real Pi (2026-09-25):

- Booted with no network to join, the gate raised its hotspot and the page was
  reachable over it.
- Joining a Wi-Fi network from that page worked, and after a reboot the gate came
  back up on that network rather than the hotspot, so `autoconnect no` on the
  hotspot connection does its job.

Not verified, and only real hardware can:

- That the restart, chrony reload, wrapper and sudoers rules work as root on a
  real Pi.
- That the page renders as intended — there is no headless browser in this repo.
- The rest of what `nmcli` actually does: whether hotspot and station mode
  coexist on the radio, whether the watchdog brings the hotspot back after a
  previously working network fails (e.g. a wrong password), and whether its 60s
  boot delay is long enough for a slow access point.
  The stub above proves which `nmcli` commands run and with what arguments,
  never what NetworkManager does with them.
