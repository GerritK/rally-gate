# ESP32 Gate

A second kind of gate: an ESP32 with its own firmware instead of a Pi running
`gate-agent` and `gate-config`. First target is an **NFC check-in gate**, where
presence matters and milliseconds don't. Firmware in `firmware/esp32-gate`,
built and compiling, not yet run on hardware (ordered).

```bash
cd firmware/esp32-gate
pio run -t upload        # build + flash over USB
pio device monitor       # serial log
pio test -e native       # gate_core tests, needs a host gcc (CI has one)
```

**rally-server does not change.** A gate is anything that publishes the right
JSON to `rally/gates/<gateId>/detections` and `/heartbeat` (see
`architecture.md`), so the firmware speaks exactly what `gate-agent` speaks:
`DetectionEvent` with `transponderKind: 'NFC'`, `GateHeartbeat` every 15s with
`sentAt`.

What the server does **not** have yet is a meaning for a check-in tap: no
gate role sets an entry's status, so a tap at an unassigned gate is stored
and nothing else. On a stage-start assignment a tap would already start a
run. The server also doesn't read `metadata.timeUnknown` (below) yet, so
that flag only matters once check-in uses the time.

## Hardware

| Part | Choice | Why |
|---|---|---|
| Board | Seeed XIAO ESP32-S3 (BerryBase SE-102010634, with header) | U.FL antenna (range at the roadside is what decides whether a gate is online at all), two cores (Wi-Fi on one, a beam interrupt on the other, so the same board serves timing later), native USB (browser flashing without a serial driver), LiPo charger on board |
| Reader | PN532 V3 module, **SPI** | I²C on the ESP32 has known trouble with the PN532's clock stretching. Preferred over the RC522: more tag types, steadier. IRQ is not needed: the firmware polls with a 50ms timeout |
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

### Wiring

| PN532 (DIP switches to SPI) | XIAO ESP32-S3 |
|---|---|
| SCK | D8 |
| MISO | D9 |
| MOSI | D10 |
| SS | D3 |
| VCC / GND | 3V3 / GND |

Buzzer on D1, LED on D2 (through a resistor), both to GND. The LED is lit
while the gate is connected to the server. One beep means the tap is
stored, three mean it is **not** (buffer full or flash failed).

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
| chrony against rally-server's SNTP (57432/udp) | own NTP client (`clock.cpp`), since lwIP's SNTP port is fixed at 123 at compile time. Best of 4 samples every 64s; steps only within the first three syncs and slews after, as chrony's `makestep 1 3` (`decoder-adapters.md` clock policy). Wi-Fi power save off: it adds latency jitter to every sample |
| QoS 1, persistent session | esp-mqtt QoS 1, but its outbox is RAM, so **every tap is written to flash first** (`/q` in LittleFS) and deleted only on PUBACK. Unacked taps are sent again on reconnect and after 30s, which the server's `eventId` dedup makes safe. Flash is the outbox, so no persistent session is needed |
| `gate-config` on 57439 + hotspot fallback | SoftAP captive portal for Wi-Fi, and a small status page on **57439**, so the dashboard's gate link (`gateConfigUrl`) works unchanged |
| `POST /api/power-off` | deep sleep, so "Shut down all gates" works for every gate. There is no SD card to protect, so it only saves the battery |
| `chronySynced` / `chronyOffsetMs` | filled from the firmware's own SNTP round trip. The names are chrony's; rename to `clockSynced`/`clockOffsetMs` when this lands |
| `eventId` | random UUIDv4 from `esp_random()` |
| `source` / `capabilities` | `nfc` |

The status page is its own small page rather than a port of gate-config:
systemd, chrony and journalctl don't exist here. It shows server connection,
clock, reader, buffer fill and the last tags read, and sets Wi-Fi, gate name,
server and the emergency Wi-Fi password. Every change restarts the gate. For
now it is plain HTML (`web/index.html`) in the rallyGateDark colours, not
`packages/ui`, and `prebuild.py` gzips it into the image. The Vuetify version
from the flash budget below comes later.

Emergency Wi-Fi as on a Pi: `rally-gate-<name>` with password `rally-gate`,
raised when no network is configured or after 60s without one, with a
captive portal on 80 redirecting to 57439. It goes down once the gate joins
a network. The default gate name is `ESP32_` plus the last three MAC bytes: what the
device is, not what it does. `capabilities` reports the reader and the
assignment gives the role, and one board may later run a beam as well.

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
| firmware image (Wi-Fi, MQTT, mDNS, web server, PN532, plain status page) | 1.0 MB measured; OTA not in it yet |
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
**Wi-Fi NTP accuracy on the ESP32**, and how ESP-IDF's `adjtime` slews: at
1/6 of real time, so a 60ms correction runs the clock 17% off for 360ms. That
is harmless for check-in and decides a stage time on a beam. Until it is measured, timing stays on
the Pi (Zero 2 W is enough). Measure it with a Pi gate and an ESP32 gate on
the same beam and compare `timestampGate` over a few hundred passings.
