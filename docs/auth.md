# Access and authentication

Designed 2026-10-30. Built so far: roles, invitations, devices, the
organiser login and the public page (step 1 in `development-roadmap.md` "Next"),
the broker login with gate pairing (step 2), and gate-config's pass (step 3)
on the Pi; the ESP32's settings page is still open.

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
| Sniff a gate's MQTT CONNECT | a token, valid once and for a minute; the key only while a pairing window is open | built, limited |
| Answer as `rally-server.local` (mDNS spoof, ARP) | invitation codes from phones scanning the `.local` QR; gates connect, and the gate drops each detection on the fake broker's PUBACK — drivers with no time. A fake answering CONNACK 4 gets the gate's key | open, operating rule |
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
- **A gate's key goes on the wire only while pairing**, so sniffing outside
  a pairing window learns nothing that lasts (see "Gates").
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

- On its first start the gate generates its own random key: Pi gate-agent
  in `gate.key` next to `gate.env` (`/etc/rally-gate/`; its own file, since
  the installer rewrites `gate.env` on every update, and nothing but the
  agent writes it), ESP32 in NVS (`esp_random()`). It logs in to the broker
  with its gate id as username and client id and, as password, **not the
  key** but `<expiry>.<HMAC-SHA256(key, gateId + "." + expiry)>` (hex, expiry
  in ms a minute ahead; `GATE_KEY_PASSWORD_PREFIX` in `packages/shared`):
  MQTT 3.1.1 has nothing but username and password. The server allows 10 s
  past the expiry for a gate whose clock hasn't synced yet, and takes each
  token once: a gate's expiry must grow, so a sniffed token can't push the
  real gate off and then stay connected.
- **The key goes out only when a server asks**: CONNACK 4 (bad username or
  password), which the broker answers an unknown or changed key while
  pairing is open; the gate sends `key:<hex>` on its next attempt. Otherwise
  the answer is CONNACK 5 and the gate keeps trying with tokens every 5 s
  (mqtt.js retries a refused login only with `reconnectOnConnackError`). A
  gate lent to another club pairs with that club's server like a new one,
  and logs in at home again with no step.
- **A fake server is left to the operating rule.** One answering as
  `rally-server.local` can answer CONNACK 4 and get the key, and ack
  detections the gate then drops. Having the server prove it knows the key
  before a gate releases detections (a signed nonce) was weighed and left
  out: without TLS it doesn't stop a server that relays, and with
  participants off the timing Wi-Fi nobody is there to run the fake.
- **No TLS for MQTT either.** Offline there is no CA, so a gate would pin the
  server's self-signed certificate at pairing, with the same window as the
  key and the same problem for lent gates, while browser traffic stays plain
  anyway. The token scheme works unchanged under TLS should that change.
- **Updates keep the key**: re-running the installer, USB flashing and OTA
  leave it alone. A new SD card or erasing the ESP32's flash is a new
  identity. There is deliberately no "new identity" button — one pressed
  mid-rally un-approves a gate.
- **Pairing**, like Bluetooth: normally an unknown gate, or a paired gate id
  with a different key, is refused at MQTT connect and shows up only in the
  server log (once per gate and 10 minutes). "Pair gates" on the Hardware
  page opens pairing for 10 minutes; while no gate is paired at all, it is
  open. During pairing a gate that sent its key appears as **waiting for
  approval** (at most 20, the rest refused), and the organiser accepts or
  rejects each with a click; a rejected one stays refused until pairing is
  opened again. The server keeps the keys in `gate-keys.json` next to
  `organiser.json` (headless: `CONFIG_DIR`), across events. A changed key on
  a paired gate id shows as "key changed"; the old key stays valid until it
  is accepted. A gate added by hand is a roster entry only: the real one
  behind it still pairs.
- Pairing and the waiting gates are in memory only: a server restart (an
  event switch too) closes pairing, and a waiting gate sends its key again
  once it reopens.
- **A waiting gate stays refused**, so its detections stay on the gate and
  arrive once it is approved: the ESP32 keeps its taps in flash, a Pi in
  mqtt.js's in-memory queue (lost if gate-agent restarts before approval).
- The broker lets a gate publish only under `rally/gates/<its id>/` and
  subscribe to nothing, and ignores a detection whose `gateId` isn't its
  topic's.
- This replaced the `autoDiscoverGates` setting.
- Dev only: `GATES_AUTO_ACCEPT=1` on the server keeps pairing open, approves
  every key at once and lets clients without a login publish for any gate
  (`npm run simulate`, `npm run screenshots`). `npm run dev:server` (its
  `dev.env`) and `docker-compose.dev.yml` set it. No dashboard switch.

## gate-config: a signed pass from the server

The config page on the gate (Pi `gate-config`, ESP32 `web.cpp`, same rules
for both):

- **On its own hotspot:** open, as today. The WPA2 password on the sticker is
  the boundary, and the hotspot only comes up when the gate is on no Wi-Fi.
- **On the rally Wi-Fi:** status is readable, every change needs a session,
  else 403 `locked`; the page shows read-only and leaves the hotspot password
  out of the settings, or anyone here could join the hotspot later. The
  organiser opens the gate config from the Hardware page (organiser only):
  `GET /api/gates/:id/configure` redirects to
  `http://<gate>:57439/?t=<pass>`, a link and not a fetch, so no popup
  blocker gets in the way. The pass is `<expiryMs>.<hex HMAC-SHA256(key,
  "config." + gateId + "." + expiry)>` (`gateConfigPassMessage` in
  `packages/shared`): the `config.` keeps a sniffed broker token from opening
  the page, and a pass from passing as a token. The gate checks it locally,
  with no call back to the server, 10 s of clock slack as for the token, sets
  the session cookie and redirects to `/`, out of the address bar. The link
  is valid 60 s (it sits in the browser history), the session 1 h.
- **The session** is `<expiryMs>.<HMAC(key, "session." + expiry)>`, httpOnly,
  `SameSite=Strict`, stateless: nothing to store on the gate, and it outlasts
  a restart of gate-config. No logout. Neither pass nor session is single
  use: a sniffed cookie is as good as a sniffed link, and the operating rule
  covers both.
- The server signs its own pass for "Shut down all gates" the same way
  (`POST /api/power-off?t=`), so the "No server → gate commands" rule
  (`architecture.md`) is untouched.
- **Open without a pass:** the gate's own hotspot (a Pi tells by the address
  the request came in on, `10.42.0.1`; the ESP32 by its AP address) and
  loopback (SSH, and the Vite proxy in the dev loop). These get a session
  cookie too, so its hour outlasts the hotspot.
- **Server unreachable:** physical access is trust. From power-on, gate-config
  is open until the broker accepts the gate's login or 3 minutes pass,
  whichever comes first. Refused counts as not reached: an unpaired gate can
  get no pass, so it stays open for those minutes to be fixed. A session
  opened in that window lasts its normal hour. No sound of its own: the page
  says it is locked. On a Pi gate-agent creates `server-reached` in its
  runtime directory, and gate-config latches the closed window, since that
  directory goes when the agent restarts.
- Without its key (the agent never ran) a gate opens no session: only its
  hotspot and the window.

## Comes with it

- No CORS: a cookie login doesn't work across origins anyway, and any web
  page open on a server laptop with internet could otherwise reach
  `localhost:57430` as the organiser. `apps/web` proxies `/api` in Vite.

## Deliberately not in it

TLS on the LAN, the login for online mode's cloud push, carrying invitations
over to a new event, and rights per single action instead of per role.
