# ESP32 Gate

A second kind of gate: an ESP32 with its own firmware instead of a Pi running
`gate-agent` and `gate-config`. First target is an **NFC check-in gate**, where
presence matters and milliseconds don't. Firmware in `firmware/esp32-gate`,
runs on hardware: it joins Wi-Fi, finds the server, syncs its clock, and its
taps reach rally-server and time a car like any gate's.

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
and nothing else. At a start or finish gate a tap times a car like any other
passing. The server keeps `metadata.timeUnknown` (below) in the detection's
`rawPayload` but doesn't act on it yet, so that flag only matters once
check-in uses the time.

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

The board has 8 MB flash, as Seeed specifies and `esptool.py flash_id`
confirms; BerryBase's shop page saying 6 MB is a listing error. The partition
table uses all 8 MB.

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

The firmware asks the PN532 for its firmware version every 5s and
re-initialises it if it stops answering. Its RSTPDN pin isn't broken out on
the V3 module and an ESP32 reset leaves it powered, so a reader that answers
but no longer reads needs a power cycle (seen once, right after flashing).

Buzzer on D1, LED on D2 (through a resistor), both to GND. The LED is lit
while the gate is connected to the server. One beep means the tap is
stored, three mean it is **not** (buffer full or flash failed).

## Identifying a driver

**An NFC sticker on the driver's RC transmitter** is the tag: it is in the
driver's hand anyway, needs no phone, battery or app, and costs ~EUR 0.30.
The tag's UID is the `transponderId`. NTAG UIDs are 7 bytes, fixed and not
writable. The gate ignores random UIDs (4 bytes starting `08`, ISO 14443-3):
a phone held to the reader sends a new one per tap. Any other foreign card is
read like a tag. An entry already takes several transponders of different kinds
(`event-model.md` "Transponders"), so an NFC sticker sits beside the car's RC
transponder, and a replacement sticker is added rather than swapped.

**UID format: uppercase hex, no separators, in the byte order the tag
reports.** It has to match what the registration desk enters. Typing it in
works, but the desk is meant to take it from a gate instead
(`development-roadmap.md` "Unassigned tags at check-in"), which matches by
construction. A USB desk reader that types into the focused field is the
fallback, but many emit decimal or reversed bytes: check one against the
firmware's output first.

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
| chrony against rally-server's SNTP (57432/udp) | own NTP client (`clock.cpp`), since lwIP's SNTP port is fixed at 123 at compile time — see "Clock" below |
| QoS 1, persistent session | esp-mqtt QoS 1, but its outbox is RAM, so **every tap is written to flash first** (`/q` in LittleFS) and deleted only on PUBACK. Unacked taps are sent again on reconnect and after 30s, which the server's `eventId` dedup makes safe. Flash is the outbox, so no persistent session is needed |
| `gate-config` on 57439 + hotspot fallback | SoftAP captive portal for Wi-Fi, and a small status page on **57439**, so the dashboard's gate link (`gateConfigUrl`) works unchanged |
| `POST /api/power-off` | deep sleep, so "Shut down all gates" works for every gate. There is no SD card to protect, so it only saves the battery. The PN532 shares the 3V3 rail, so it gets its own `PowerDown` command first, with chip select held high through the sleep (floating, it wakes the reader). The reader board's power LED keeps drawing a few mA; only switching the reader's supply (a MOSFET on a GPIO) removes that |
| `ntpSynced` / `ntpOffsetMs` | the RMS of the last 8 measured offsets, the figure chrony reports as "RMS offset" on a Pi |
| `eventId` | random UUIDv4 from `esp_random()` |
| `source` / `capabilities` | `nfc` |

The status page is its own small page rather than a port of gate-config:
systemd, chrony and journalctl don't exist here. It shows server connection,
clock, reader, buffer fill and the last tags read, and sets Wi-Fi, gate name,
server and the emergency Wi-Fi password. Reset Wi-Fi forgets the network, so
the gate comes back up on its emergency Wi-Fi. Every change restarts the gate. It
is plain HTML (`web/index.html`), English only, styled after gate-config's
Vuetify page by hand: the rallyGateDark colours, Vuetify's card, outlined
field, chip and alert look, MDI paths inline, and the latin woff2 subsets of
Barlow, Barlow Condensed and JetBrains Mono (`web/fonts/`, copied from
`@fontsource` so the firmware build needs no `node_modules`). `prebuild.py`
inlines the fonts and gzips it into the image, about 95 KB. Vuetify itself
stays out: Node in the firmware build and a few hundred KB more over the
emergency Wi-Fi, for one page.

Emergency Wi-Fi as on a Pi: `rally-gate-<name>` with password `rally-gate`,
raised when no network is configured or after 60s without one, with a
captive portal on 80 redirecting to 57439. It goes down once the gate joins
a network.

On a mesh or any network with several access points, the gate joins the
strongest (all-channel scan, sorted by signal; the default takes the first
one it hears), and again on every reconnect. It doesn't roam while
connected: a gate stands still for an event, and a mesh moves its clients
itself.

The loop that polls the PN532 must not wait on the network: a card held on
the reader only while the loop is blocked is never seen. So the page's Wi-Fi
scan and the mDNS lookup of
`rally-server.local` run in the background and are polled. A beam would not
depend on this: its time comes from the GPIO interrupt, and a blocked loop
only delays sending it. The default gate name is `ESP32_` plus the last three MAC bytes: what the
device is, not what it does. `capabilities` reports the reader and the
assignment gives the role, and one board may later run a beam as well.

### Clock

Best of 4 samples every 64s. Steps only within the first three syncs and
slews after, as chrony's `makestep` (`decoder-adapters.md` clock policy), but
from 5ms rather than 1s: a reset leaves the clock up to seconds off, and
slewing that takes seconds of taps with wrong times.

- **Rate:** like chrony it estimates the crystal's rate error (`ClockRate`,
  over a 15–30 minute window, since one Wi-Fi sample is off by about what
  the crystal drifts in a whole poll) and corrects for it between syncs. A
  small offset is only half applied for the same reason.
- **Delay filter:** a sync whose round trip is well above the usual one is
  skipped (`DelayFilter`, chrony's `maxdelayratio`), and a large correction
  never becomes the window's reference, where it would never be undone.
- Each sync is logged on serial (`[clock] offset … delay … rate …`). Wi-Fi
  power save is off: it adds latency jitter to every sample.

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
| two OTA app partitions, 3 MB each, **status page gzipped inside the image** | 6 MB |
| NVS (Wi-Fi credentials) + LittleFS (detection buffer, ~200 B per tap) | rest |

The page lives inside the firmware image so one OTA updates both, and there
is never a page from a different firmware version. gate-config's Vuetify
build would not fit as it is (3.2 MB gzipped, mostly MDI and every font
subset), which is the other reason the page is hand-styled HTML.

OTA can't come from GitHub in the field, since rally Wi-Fi is closed. It is
an upload through the status page for now, and from rally-server once
"Gate updates from the server" (`development-roadmap.md`) exists.

## Installing

Every release carries one merged image per supported board
(`rally-gate-<version>-esp32-xiao-s3.bin`, offset 0), and its job publishes
`firmware/esp32-gate/install` to GitHub Pages with that image: Chrome or Edge,
USB-C, Install, nothing else on the laptop. It lives on Pages, not on the
release, because Web Serial needs HTTPS and release assets can't be fetched
cross-origin. Pre-releases get the image but don't replace the page.

Variants are per board only, never per feature: one firmware carries NFC and
beam, the reader is detected and the beam switched on at runtime, as `ADAPTER`
on a Pi. A per-feature builder would save no flash worth having (1.0 MB of a
3 MB slot) and turn every gate into a question of which build it runs. A
second board with another chip is a second `builds` entry in the manifest the
`pages` job writes; one with the same chip needs its own manifest and button.

## Light barrier later

The same board can time a beam: a GPIO interrupt with `esp_timer_get_time()`
is microsecond-exact, better than `gpiomon` on Linux. The clock was the weak
part: correcting only the offset, the first board's crystal (~30ppm fast)
was 2.4ms off before every 64s sync, and a stage time adds two gates' errors.
With `ClockRate` the measured offset over Wi-Fi is 0.5ms on average and under
2ms at worst, which is mostly the samples' own noise. What is still unproven is **Wi-Fi NTP accuracy on the
ESP32**: an asymmetric path is invisible to the gate's own estimate. Until it is measured, timing stays on
the Pi (Zero 2 W is enough). Measure it with a Pi gate and an ESP32 gate on
the same beam and compare `timestampGate` over a few hundred passings.
