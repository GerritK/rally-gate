# ESP32 Gate

A second kind of gate: an ESP32 with its own firmware instead of a Pi running
`gate-agent` and `gate-config`. First target is an **NFC check-in gate**, where
presence matters and milliseconds don't. Hardware is ordered; nothing is
built yet.

**rally-server does not change.** A gate is anything that publishes the right
JSON to `rally/gates/<gateId>/detections` and `/heartbeat` (see
`architecture.md`), so the firmware speaks exactly what `gate-agent` speaks:
`DetectionEvent` with `transponderKind: 'NFC'`, `GateHeartbeat` every 15s with
`sentAt`.

## Hardware

| Part | Choice | Why |
|---|---|---|
| Board | Seeed XIAO ESP32-S3 (BerryBase SE-102010634, with header) | U.FL antenna (range at the roadside is what decides whether a gate is online at all), two cores (Wi-Fi on one, a beam interrupt on the other, so the same board serves timing later), native USB (browser flashing without a serial driver), LiPo charger on board |
| Reader | PN532 V3 module, **SPI** with the IRQ pin wired | I²C on the ESP32 has known trouble with the PN532's clock stretching. Preferred over the RC522: more tag types, steadier |
| Tags | NTAG213/215 stickers; on-metal NTAG where it sits on a battery or metal | |
| Feedback | active 3.3V buzzer + LED | the driver has to know the tap counted |

Not chosen: ESP32-C3 SuperMini (antenna notoriously weak), classic
ESP32-WROOM DevKit (PCB antenna, USB-serial bridge, older generation; fine on
a desk).

BerryBase lists the board with 6 MB flash, Seeed's spec says 8 MB. Check with
`esptool.py flash_id` before fixing the partition table. 6 MB is enough
either way (below).

**The antenna must be plugged in**, since without it the board has next to
no range. In the case, keep it away from the battery and metal.

## Identifying a driver

**An NFC sticker on the driver's RC transmitter** is the tag: it is in the
driver's hand anyway, needs no phone, battery or app, and costs ~EUR 0.30.
The tag's UID is the `transponderId`. NTAG UIDs are 7 bytes, fixed and not
writable. An entry already takes several transponders of different kinds
(`event-model.md` "Transponders"), so an NFC sticker sits beside the car's RC
transponder, and a replacement sticker is added rather than swapped.

**UID format: uppercase hex, no separators, in the byte order the tag
reports.** It has to match what the registration desk enters. The cheap
route there is a USB reader that types into the focused field, but many of
those emit decimal or reversed bytes. Check the one in use against the
firmware's output before an event, or no tap ever matches an entry.

Phones were considered and rejected:
- **Android** can emulate a card (HCE) with a fixed ID behind an AID, which the
  PN532 could read via `SELECT AID`. It needs our own app, and the screen must
  be on.
- **iPhone**: card emulation and NFC Wallet passes both need Apple's approval
  and a commercial agreement. Not reachable for an open project.
- Phones emulating a card send a **random UID**, so a phone's plain UID is
  never usable.

If phone support is ever demanded, the cross-platform route is a QR scanner
module (GM65/GM805 over UART) and a `TransponderKind.QR`, which works without
an app on either platform.

## Firmware

Arduino framework on PlatformIO, C++, in its own folder outside the npm
workspaces with its own CI build. What each part of the Pi stack becomes:

| Pi | ESP32 |
|---|---|
| `GATE_ID` from the installer | derived from the MAC address, so nothing to enter |
| mDNS `rally-server.local` | ESP-IDF mDNS component, still zero-config |
| chrony against rally-server's SNTP (57432/udp) | ESP-IDF SNTP in `SNTP_SYNC_MODE_SMOOTH`, because the default steps the clock, and the policy in `decoder-adapters.md` allows a step only at boot. Wi-Fi power save off: it adds latency jitter to every sync |
| QoS 1, persistent session | esp-mqtt QoS 1 with `clean_session=false`, but its outbox is RAM, so **every detection is written to flash first** and deleted once acked. Loss of power must not cost a tap |
| `gate-config` on 57439 + hotspot fallback | SoftAP captive portal for Wi-Fi, and a small status page on **57439**, so the dashboard's gate link (`gateConfigUrl`) works unchanged |
| `POST /api/power-off` | deep sleep, so "Shut down all gates" works for every gate. There is no SD card to protect, so it only saves the battery |
| `chronySynced` / `chronyOffsetMs` | filled from the firmware's own SNTP round trip. The names are chrony's; rename to `clockSynced`/`clockOffsetMs` when this lands |
| `eventId` | random UUIDv4 from `esp_random()` |
| `source` / `capabilities` | `nfc` |

The status page uses `packages/ui` like every web UI (`design-system.md`), but
is its own small page rather than a port of gate-config: systemd, chrony and
journalctl don't exist here. It shows Wi-Fi setup, server connection, clock
synced, buffer fill and the last tags read.

### Time without an RTC

Not needed for check-in. After Wi-Fi comes up, SNTP has the time within
seconds. A tap **before** the first sync stores `esp_timer_get_time()`
(monotonic µs since boot) and is converted once synced:
`tapTime = now - (monoNow - monoTap)`. It waits in the flash buffer until then.

The only lost time is a gate **rebooting before it ever synced**. There is no
reference point left, so those taps are still sent, but flagged in
`metadata`: presence proven, time of day not. For check-in that is enough.

The ESP32's built-in RTC is no substitute for a DS3231: it runs from an
inaccurate RC oscillator and doesn't survive power loss. A DS3231 (I²C,
~EUR 3) only pays off for a gate that runs long without network and reboots.

### Flash budget

| | |
|---|---|
| firmware image (Wi-Fi, MQTT, mDNS, web server, OTA, PN532) | ~1.2–1.5 MB |
| two OTA app partitions, ~2.5 MB each, **status page gzipped inside the image** | 5 MB |
| NVS (Wi-Fi credentials) + LittleFS (detection buffer, ~200 B per tap) | rest |

The page lives inside the firmware image so one OTA updates both, and there
is never a page from a different firmware version. Today's gate-config build
would not fit: 5.8 MB raw, 3.2 MB gzipped. Most of that is the MDI font in
four formats (3.6 MB; browsers load only the 403 KB woff2) plus every Barlow
and JetBrains Mono subset in woff and woff2. Ship woff2 only, the `latin`
subset only (umlauts and ß are in it), and MDI cut down to the icons used
(which also drops most of the 850 KB CSS). That lands around 300–500 KB
gzipped.

OTA can't come from GitHub in the field, since rally Wi-Fi is closed. It is
an upload through the status page for now, and from rally-server once
"Gate updates from the server" (`development-roadmap.md`) exists.

## Light barrier later

The same board can time a beam: a GPIO interrupt with `esp_timer_get_time()`
is microsecond-exact, better than `gpiomon` on Linux. What is unproven is
**Wi-Fi SNTP accuracy on the ESP32**. Until it is measured, timing stays on
the Pi (Zero 2 W is enough). Measure it with a Pi gate and an ESP32 gate on
the same beam and compare `timestampGate` over a few hundred passings.
