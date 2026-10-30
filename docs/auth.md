# Access and authentication

Designed 2026-10-30. Built so far: roles, invitations, devices, the
organiser login and the public page (step 1 in `development-roadmap.md` "Next"); gates, the
broker and gate-config are still open.

## What it protects against

Curious people on the rally Wi-Fi (spectators, drivers who know its password)
clicking around, and marshals changing things outside their job (the SS2 start
marshal correcting SS1). Plus: no device can inject or impersonate detections.
No TLS — certificates on an offline laptop are not something a club can run —
so an attacker *on the same Wi-Fi* is handled by keeping participants off it
(next section), not by the protocol.

## Participants on the timing Wi-Fi

A competitor with a motive and Wireshark is in the paddock. With WPA2, anyone
who knows the Wi-Fi password can decrypt the other devices' traffic (the key
derives from the password plus a handshake they can capture), and everything
here is plain HTTP and MQTT. What such a person gets:

| Attack | Gets | Status |
|---|---|---|
| Sniff a marshal's or organiser's request | the device cookie: that login, until blocked | built, open |
| Sniff `POST /auth/login` | the organiser password | built, open |
| Sniff `/join/:code` | the invitation code (shows up as an extra device under it) | built, open |
| Sniff a gate's MQTT CONNECT | the gate key, if it is sent as the password: impersonate the gate | planned, avoided below |
| Answer as `rally-server.local` (mDNS spoof, ARP) | invitation codes from phones scanning the `.local` QR; gates connect, and the gate drops each detection on the fake broker's PUBACK — drivers with no time | open, step 2 decides |
| Brute-force `/auth/login` | the organiser password, if weak — 5 wrong per address and minute, then 429 | built, limited |
| Brute-force an invitation code | 8 of 31 characters, ~10¹² — not feasible over Wi-Fi | fine |
| Flood the airtime, rogue DHCP | gates drop offline; QoS 1 delivers late, the dashboard shows them offline | operating rule |

Consequences:

- **Operating rule: participants never join the timing Wi-Fi.** One closed
  network for server, gates and staff devices; a guest network for
  everyone else. Most routers have one. This is the actual boundary — the
  design below assumes it, and the README and the login page say so.
  Open: a guest network's client isolation usually blocks the public page
  too, so participants get it through online mode, a printout, or a router
  that forwards only `57430` from the guest network.
- **WPA3 where the hardware allows:** with SAE, knowing the password no longer
  decrypts others' traffic. Pi and ESP32-S3 support it; older phones
  partly. It doesn't help against a spoofed server.
- **A gate's key never goes on the wire**, so neither sniffing nor a fake
  server learns it (step 2, see "Gates").
- **`/auth/login` has a rate limit**: 5 wrong passwords per client address,
  then refused until a minute after the first; a right one clears it. In
  memory, so a restart forgets it.

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
| Organiser | everything, plus invitations and gate approval; alone disqualifies and reinstates (a jury decision) |
| Timing | every stage: corrections, voiding, penalties, assigning passings, activate/close; withdraws entries |
| Stage marshal | only the stages on its invitation: assigning passings, manual start/finish, corrections |
| Check-in | entries and transponders, check-in and scrutineering steps, withdrawing |

The table is `PERMISSIONS` in `packages/shared/src/permissions.ts`, read by
both sides: rally-server's `@Requires` and the dashboard's `can()`. The
dashboard **hides** what a role may never do (button, menu entry, Save; a
form turns read-only) instead of letting the server answer 403, and keeps
every page visible, since reading is any login's. Not logged in, every page
but `/public`, `/login` and `/join` sends the browser to `/public`, which
has no drawer and a Log in button in the app bar; the server refuses those
reads too (`api.md`). It reloads the session on every navigation and after any 401/403, so a
blocked device falls back at once. A stage marshal's Live Timing opens on
its own stage.

## People: invitations, not accounts

A login is a **device with a role**, not a person with a password.

- The organiser creates an invitation per role on the dashboard ("Anna – Start
  SS2", role Stage marshal, stages SS2). It shows as a QR code plus a short
  code to type in when the camera fails, meant to be printed.
- The QR holds **`rally-server.local`** by default (`MDNS_HOST`), since sheets
  are often printed at home, where the server's IP is not the rally's. Older
  Android resolves `.local` unreliably, so the page also offers the current
  LAN IPs for printing on site. The setup QR in the server log uses the IP:
  it is scanned right then.
- Scanning it makes the device a login: an httpOnly cookie, `SameSite=Strict`
  (`EventSource` on `/api/live` can't send headers, so a cookie it is). No
  expiry: a marshal logged out mid-stage is worse than the remaining risk.
- One invitation, many devices. The organiser sees each redeemed device and
  can block one or the whole invitation. Scanning again on a known device is
  the same device, so the list doesn't fill up.
- Invitations and devices live in the **event database**: opening another
  event logs every device out, and no old access survives into the next rally.
  Closing and reopening the same event keeps them. A cookie belongs to the
  address it was set on, so a tablet logged in at home through
  `rally-server.local` stays logged in at the rally; through an IP only if the
  server gets the same one there.
- Invitations and devices are never deleted, only blocked: every hand-made
  change to a result is a `ChangeRecord` with the **device id** (null: the
  server machine) and the value before and after, and the entry page's
  History names it "Anna – Start SS2 · device 2". Recorded: Start now, Finish
  now, typed and corrected times, void/restore/delete, penalties added and
  deleted, passings assigned and dismissed, entry status changes. Not
  recorded: setup edits, gate-timed passings (those are `DetectionEventRecord`
  already). Append-only, written in the change's own transaction. What it
  is for: undoing a correction on the wrong car (the old value is there) and
  settling "my time was different a minute ago". A device is a login, not a
  person: a sniffed cookie is the same device ("Participants on the timing
  Wi-Fi"). Dismissed passings have no entry and show nowhere yet.

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
  and, as password, **not the key** but `expiry + HMAC(key, gateId + expiry)`
  with an expiry a minute ahead: MQTT 3.1.1 has nothing but username and
  password, and a key sent as one would go to anyone who sniffs the Wi-Fi or
  answers as `rally-server.local` (see "Participants on the timing Wi-Fi").
  A sniffed token can be replayed only until it expires. Gates follow the
  server's clock, so the expiry check holds; allow a few seconds of slack for
  a gate whose clock isn't synced yet. Pairing sends the key once (it has to
  reach the server somehow) — the reason pairing is a short, deliberate
  window.
- **Open, step 2:** a fake broker that acks detections makes the gate drop
  them. Candidate fix: the server proves it knows the key once per connection
  (signs a nonce the gate sends on its own topic) before the gate releases
  anything from its buffer. Decide when building step 2; until then the
  operating rule above is the protection.
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
