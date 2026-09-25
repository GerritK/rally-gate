# Gate Config UI

`apps/gate-config`: a page on each gate Pi, at
`http://<gate-hostname>.local:57439`, so a marshal can check and reconfigure a
gate without SSH or re-running the installer. Built and verified on a Pi.

**Separate from `gate-agent` on purpose.** gate-agent runs under
`Restart=always`, so a config that makes it exit becomes a crash loop — and a UI
living inside it would die with the thing it exists to repair.

## Configuration

The systemd unit is written once by the installer and reads
`EnvironmentFile=/etc/rally-gate/gate.env`; gate-config owns that file. gate-agent
needed no change, since it already reads exactly these env vars. The file is
written atomically (temp + rename), because gates lose power for real.

Settable keys are a **whitelist** (`FIELDS` in `config-file.ts`): the file is
gate-agent's environment, and an arbitrary key would let anyone on the network
set `LD_PRELOAD`. Each field's `group` decides which card it appears in, and
`config-file.spec.ts` fails if a group has no card — such a field would be
unreachable with no error.

- **`GATE_ID` is an identity.** The server keys gates, assignments and
  detections on it, so changing it mid-event orphans the old rows. The page warns
  before saving. It does not re-derive the host name.
- **Nothing server-owned is here** — role and stage assignment are the event's
  plan, not the hardware's.

## What the page shows

Status first: gate-agent active/failed, `chronyc tracking`, the Wi-Fi state and
the last 20 journal lines, each probe failing independently. "Connected to the
broker" is read from the log panel, deliberately not parsed into a field — log
text is not an interface. If a real indicator is ever needed, gate-agent should
write a small status file instead.

## Applying a change

Saving restarts `rally-gate-agent` and updates chrony's source. Privilege comes
from exact sudoers commands, not root, because this service is unauthenticated
and what it can do as root *is* the boundary:

```
<user> ALL=(root) NOPASSWD: /usr/bin/systemctl restart rally-gate-agent
<user> ALL=(root) NOPASSWD: /usr/bin/chronyc reload sources
<user> ALL=(root) NOPASSWD: /usr/local/sbin/rally-gate-net
```

The installer runs `visudo -c` and removes an invalid drop-in, since a broken one
locks out sudo.

**Time source follows the server address.** gate-config writes
`/run/chrony-rally/rally-server.sources` (at every start, since `/run` is wiped
on boot, and on every save) and runs `chronyc reload sources`. Not a chrony
restart: that re-arms `makestep` and can step the clock mid-stage — see "Gate
system clock policy" in `decoder-adapters.md`.

### Wi-Fi goes through a wrapper, not `nmcli` in sudoers

A sudoers rule for `nmcli` needs a wildcard, and that is a root shell:
`nmcli connection import type openvpn file …` runs the file's up-script as root,
and control of routing/DNS on a gate is a man-in-the-middle on timing. Polkit is
no narrower in capability.

So `deploy/rally-gate-net` has three subcommands — `join`, `reset`, `watchdog` —
and **every `nmcli` argument is a literal except the SSID and Wi-Fi password**.
The hotspot password is read from `gate.env` by the wrapper, never passed in, so
the grant can't raise an AP with a password only the caller knows. Keep it that
way: a subcommand passing a property name through would undo all of this.

Read-only calls (`device status`, `wifi list`) run unprivileged. The scan uses
`--rescan auto`: a forced rescan is privileged and drops the radio for seconds,
disconnecting a marshal who is on the hotspot.

## Hotspot fallback

A gate that can reach no Wi-Fi raises `rally-gate-<hostname>` (WPA2,
`HOTSPOT_PASSWORD`, default `rally-gate` — predictable on purpose, it goes on a
sticker). `rally-gate-hotspot.timer` runs `rally-gate-net watchdog` 60s after
boot and every 30s; it raises the hotspot when the radio is associated with
nothing. 60s is long on the bench but short would raise the hotspot over a
network that is still associating.

- **`join` takes the hotspot down first and never restores it on failure** —
  the watchdog does, within a minute. One recovery path for every failure.
- The hotspot has `autoconnect no`, or it races the saved Wi-Fi at boot.
- **Reset Wi-Fi** (`reset`) forgets every saved Wi-Fi network, then raises the
  hotspot. Forgetting, because a saved network in range autoconnects again at
  boot. Confirmed on the page first.
- A lost connection during a join or reset is reported as expected, not failed:
  over the hotspot, the reply has no route back.
- **Captive portal:** on the hotspot every DNS name resolves to the gate
  (`address=/#/10.42.0.1` in NetworkManager's dnsmasq), and gate-config answers
  port 80 (`CAPTIVE_PORT`, via `CAP_NET_BIND_SERVICE`) with a redirect to 57439,
  so a phone opens the page by itself.
- Known ceiling: once up, the hotspot stays until someone joins a network — a
  gate carried back into range of its router doesn't reconnect by itself.

## Access

No authentication; the closed rally network is the boundary. The hotspot's WPA2
password draws the boundary around the gate's own AP, and is readable through
`GET /api/config` like any field. The Wi-Fi client password never touches
`gate.env` — NetworkManager stores it, and gate-config can't read it back.

## Build and testing

Vue + Vuetify through `packages/ui`, like `apps/web`. Built on the gate by the
installer; `vue-tsc` is skipped there for speed.

Everything touching the OS is in `src/system.ts`, which reports failures instead
of throwing — off a Pi every status row reads unavailable and the page still
works. `config-file.ts` and `network.ts` are unit-tested, including injection
cases; `rally-gate-net` was checked against a stub `nmcli` on `PATH`. On a real
Pi everything above is verified except the captive portal redirect.
