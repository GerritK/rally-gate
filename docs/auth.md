# Access and authentication

Designed 2026-10-30, not built yet; the build order is in
`development-roadmap.md` "Next". Until it lands, the closed rally network is
the only boundary.

## What it protects against

Curious people on the rally Wi-Fi (spectators, drivers who know its password)
clicking around, and marshals changing things outside their job (the SS2 start
marshal correcting SS1). Plus: no device can inject or impersonate detections.
Not a goal: an attacker sniffing the LAN. No TLS — certificates on an offline
laptop are not something a club can run.

## Who sees what

- **Anonymous** (anyone on the Wi-Fi): a separate, slimmed-down public page —
  start lists, live stage state (who's on stage, times), results, penalties as
  a sum. Not a greyed-out marshal view.
- **Logged in, any role:** everything internal — unassigned passings, the
  detection feed, transponder ids, Hardware (health, clock offsets, addresses),
  Setup, penalty details and reasons, correction history.

Roles decide what a login may **change**:

| Role | May change |
|---|---|
| Organiser | everything, plus invitations and gate approval |
| Timing | every stage: corrections, penalties, assigning passings, activate/close |
| Stage marshal | only the stages on its invitation: assigning passings, manual start/finish, corrections |
| Check-in | entries and transponders |

## People: invitations, not accounts

A login is a **device with a role**, not a person with a password.

- The organiser creates an invitation per role on the dashboard ("Anna – Start
  SS2", role Stage marshal, stages SS2). It shows as a QR code plus a short
  code to type in when the camera fails, meant to be printed.
- The QR holds the server's **LAN IP**, not `rally-server.local`: Android
  resolves `.local` unreliably. `DiscoveryService` already knows the reachable
  addresses.
- Scanning it makes the device a login: an httpOnly cookie, `SameSite=Strict`
  (`EventSource` on `/api/live` can't send headers, so a cookie it is). No
  expiry: a marshal logged out mid-stage is worse than the remaining risk.
- One invitation, many devices. The organiser sees each redeemed device and
  can block one or the whole invitation. Scanning again on a known device is
  the same device, so the list doesn't fill up.
- Invitations and devices live in the **event database**: opening another
  event logs every device out, and no old access survives into the next rally.
  Closing and reopening the same event keeps them. A cookie belongs to the
  address it was set on, so preparing tablets at home only works if the server
  has the same IP at the rally — the documented way is printing the QR codes.
- Invitations and devices are never deleted, only blocked: every correction,
  penalty and passing assignment stores the **device id**, and the correction
  history shows "Anna – Start SS2 · device 2". That's what a protest needs.

### The organiser

- **On the server machine itself** (`localhost`, checked on the socket
  address, never a header) the browser is always the organiser. That covers
  the standalone laptop with no password at all.
- **From elsewhere** (headless, or a second laptop): one organiser password,
  hashed in `organiser.json` next to the event files, like `known-gates`
  (headless: `CONFIG_DIR`, a volume in `deploy/docker-compose.yml`).
- **First start:** while no password exists, the server logs a setup link as a
  terminal QR code (installer output, `journalctl`, `docker logs`); scan it,
  set the password on the phone. One dependency, `qrcode`, draws both this and
  the invitation QR codes.
- **Forgotten password:** standalone — set a new one on the laptop. Headless —
  `npm run reset-admin` (or via `docker exec`) prints a new setup QR. No email
  reset; the rally is offline.
- A co-organiser gets an invitation with the Organiser role, so only one
  person ever knows the password.

## Gates: a key of their own, approved once

Nothing is typed on a gate (`development-roadmap.md` "Zero-config gates").

- At install the gate generates its own random key: Pi in
  `/etc/rally-gate/gate.key` (its own file — the installer rewrites
  `gate.env` on every update, and creates the key only when missing), ESP32 in
  NVS (`esp_random()`). It logs in to the broker with its gate id as username
  and the key as password.
- **Updates keep the key**: re-running the installer, USB flashing and OTA
  leave it alone. A new SD card or erasing the ESP32's flash is a new
  identity. There is deliberately no "new identity" button — one pressed
  mid-rally un-approves a gate.
- **Pairing**, like Bluetooth: normally an unknown gate, or a known gate id
  with a different key, is refused at MQTT connect and shows up only in the
  server log. "Add gates" on the Hardware page opens pairing for 10 minutes;
  while no gate is known at all, pairing is open. During pairing, unknown gates
  appear as **waiting for approval** (at most 20, the rest refused), and the
  organiser accepts each with a click. The server stores the key with the
  gate in the cross-event file next to `known-gates`. A changed key on a known
  gate id shows as "key changed, accept?"; the old key stays valid until then.
- Pairing state is in memory only: a server restart (an event switch too)
  closes it.
- Detections of a gate that is waiting are **stored but not timed**, and
  processed on approval — a dropped passing is a driver with no time, and the
  pipeline is idempotent. Rejecting the gate deletes them. A refused gate keeps
  retrying, so a replacement gate added mid-rally shows up as soon as pairing
  opens: the ESP32 keeps its taps in flash, a Pi in mqtt.js's in-memory queue
  (lost if gate-agent restarts before approval).
- This replaces the `autoDiscoverGates` setting, which goes entirely.
- Dev only: `GATES_AUTO_ACCEPT=1` on the server skips pairing and approval for
  `npm run simulate`, the simulated agents in `docker-compose.dev.yml`,
  `seed-demo-data` and `npm run screenshots`. No dashboard switch for it.

## gate-config: a signed pass from the server

The config page on the gate (Pi `gate-config`, ESP32 `web.cpp`, same rules
for both):

- **On its own hotspot:** open, as today. The WPA2 password on the sticker is
  the boundary, and the hotspot only comes up when the gate is on no Wi-Fi.
- **On the rally Wi-Fi:** status is readable, every action needs a pass. The
  organiser clicks "Configure" on the Hardware page; the server signs
  `gateId + expiry` with that gate's key (HMAC-SHA256, mbedtls on the ESP32)
  and the browser opens `http://<gate>:57439/?t=<pass>`. The gate checks it
  locally, with no call back to the server, and sets a cookie. The link is
  valid 60 s (it sits in the browser history), the session 1 h. The server
  signs its own pass for "Shut down all gates" the same way, so the
  "No server → gate commands" rule (`architecture.md`) is untouched.
- **Server unreachable:** physical access is trust. From power-on, gate-config
  is open until the gate reaches the server or 3 minutes pass, whichever comes
  first; the buzzer says so. A session opened in that window lasts its normal
  hour. With a server present the window closes within seconds.

## Comes with it

- No CORS: a cookie login doesn't work across origins anyway, and any web
  page open on a server laptop with internet could otherwise reach
  `localhost:57430` as the organiser. `apps/web` proxies `/api` in Vite.

## Deliberately not in it

TLS on the LAN, the login for online mode's cloud push, carrying invitations
over to a new event, and rights per single action instead of per role.
