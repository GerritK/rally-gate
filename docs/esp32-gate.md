# ESP32 Gate

A second kind of gate: an ESP32 with its own firmware instead of a Pi running
`gate-agent` and `gate-config`. First target is an **NFC check-in gate**, where
presence matters and milliseconds don't. Firmware in `firmware/esp32-gate`,
runs on hardware: it joins Wi-Fi, finds the server, syncs its clock, and its
detections reach rally-server and time a car like any gate's.

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
| Board | Seeed XIAO ESP32-S3 | U.FL antenna (range at the roadside is what decides whether a gate is online at all), two cores (Wi-Fi on one, a beam interrupt on the other, so the same board serves timing later), native USB (browser flashing without a serial driver), LiPo charger on board |
| Reader | PN532 V3 module, **SPI** | I²C on the ESP32 has known trouble with the PN532's clock stretching. Preferred over the RC522: more tag types, steadier. IRQ is not needed: the firmware polls with a 50ms timeout |
| Tags | NTAG213/215 stickers; on-metal NTAG where it sits on a battery or metal | |
| Feedback | active 3.3V buzzer + LED | the driver has to know the tap counted |

Not chosen: ESP32-C3 SuperMini (antenna notoriously weak), classic
ESP32-WROOM DevKit (PCB antenna, USB-serial bridge, older generation; fine on
a desk).

The board has 8 MB flash (`esptool.py flash_id`), and the partition table
uses all of it.

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
but no longer reads needs a power cycle.

Buzzer on D1 with a 10 kΩ pulldown, LED on D2 (through a resistor), both to
GND. Without the pulldown the buzzer hisses while the pin floats. The LED is lit
while the gate is connected to the server. One beep means the tap is
stored, three mean it is **not** (buffer full or flash failed). The buzzer also
plays the status sounds of the Pi gates (table in `decoder-adapters.md`,
"Buzzer"), except decoder failed and shutdown; ready here needs the NFC reader
found. They can be turned off on the status page, power on can't.

## Identifying a driver

**An NFC sticker on the driver's RC transmitter** is the tag: it is in the
driver's hand anyway and needs no phone, battery or app.
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

**No phones:** their plain UID is random; Android's fixed-ID card emulation
(HCE) needs our own app and the screen on; iPhone card emulation needs Apple's
approval and a commercial agreement. If phone support is ever demanded, the
app-free route is a QR scanner module (GM65/GM805 over UART) and a
`TransponderKind.QR`.

## Firmware

Arduino framework on PlatformIO, C++, in its own folder outside the npm
workspaces with its own CI build. What each part of the Pi stack becomes:

| Pi | ESP32 |
|---|---|
| `GATE_ID` from the installer | derived from the MAC address, so nothing to enter |
| mDNS `rally-server.local` | ESP-IDF mDNS component, still zero-config |
| chrony against rally-server's SNTP (57432/udp) | own NTP client (`clock.cpp`), since lwIP's SNTP port is fixed at 123 at compile time — see "Clock" below |
| QoS 1, persistent session | esp-mqtt QoS 1, but its outbox is RAM, so **every detection is written to flash first** (`/q` in LittleFS) and deleted only on PUBACK, or when it can never be sent: recorded under another Gate ID (the broker takes a gate's publishes only under its own login id and drops the connection on any other, so one would block every detection behind it), unreadable (another firmware's layout), or cleared on the status page (Clear, or saving a new Gate ID; both ask first). The server ignores detections older than 24 h on its side. Unacked detections are sent again on reconnect and after 30s, which the server's `eventId` dedup makes safe. Flash is the outbox, so no persistent session is needed |
| `gate-config` on 57439 + hotspot fallback | SoftAP captive portal for Wi-Fi, and a small status page on **57439**, so the dashboard's gate link (`gateConfigUrl`) works unchanged |
| `POST /api/power-off` | deep sleep, so "Shut down all gates" works for every gate. There is no SD card to protect, so it only saves the battery. The PN532 shares the 3V3 rail, so it gets its own `PowerDown` command first, with chip select held high through the sleep (floating, it wakes the reader). The reader board's power LED keeps drawing a few mA; only switching the reader's supply (a MOSFET on a GPIO) removes that |
| `ntpSynced` / `ntpOffsetMs` | the RMS of the last 8 measured offsets, the figure chrony reports as "RMS offset" on a Pi |
| `gate.key` and the broker login | key in NVS from `esp_random()`, kept through every settings change; the token is HMAC-SHA256 in `gate_core.h`, so the native tests check it against gate-agent's vector. It connects only once its clock is set, since the token carries an expiry in server time (`auth.md` "Gates") |
| `eventId` | random UUIDv4 from `esp_random()` |
| `source` / `capabilities` | `nfc` |

The status page is its own small page rather than a port of gate-config:
systemd, chrony and journalctl don't exist here. It shows server connection,
clock, reader, detections waiting to send (with Clear) and the last tags read, and sets Wi-Fi, gate name,
server and the emergency Wi-Fi password. Reset Wi-Fi forgets the network, so
the gate comes back up on its emergency Wi-Fi. Every change restarts the gate. It
is plain HTML (`web/index.html`), English only, hand-styled after gate-config
(rallyGateDark colours, MDI paths inline, the latin woff2 font subsets copied
into `web/fonts/` so the firmware build needs no `node_modules`).
`prebuild.py` inlines the fonts and gzips it into the image, about 95 KB.
Vuetify itself stays out: Node in the firmware build and a few hundred KB more
over the emergency Wi-Fi, for one page. The default gate name is `ESP32_` plus
the last three MAC bytes: what the device is, not what it does, since one
board may later run a beam as well.

Changes need a session, as on a Pi (`auth.md` "gate-config"): open on the
emergency Wi-Fi (the request came in on the AP's address) and until the broker
accepts the login or 3 minutes after power-on pass, otherwise only through the
dashboard's pass. `web.cpp` checks it with `validSigned` in `gate_core.h`,
which the native tests hold to the server's vector. A session opened in the
window before the clock was ever set expires with the first sync, since its
expiry was in boot time: by then the server is there to hand out a pass.

**The page and the reader share one firmware**, where a Pi keeps gate-config
in a process of its own so that it survives an agent stuck in a crash loop
(`gate-config-ui.md`). A microcontroller has no second process to put it in.
What keeps that from biting: every setting is checked before it is saved
(`web.cpp`, the same rules as on a Pi), so the page can't store a value the
firmware would trip over, and the network and server it fails to reach only
bring the emergency Wi-Fi up. A gate that crashes before its page is up anyway
is reflashed over USB.

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
only delays sending it.

### Clock

Best of 4 samples every 64s. Steps only within the first three syncs and
slews after, as chrony's `makestep` (`decoder-adapters.md` clock policy), but
from 5ms rather than 1s: a reset leaves the clock up to seconds off, and
slewing that takes seconds of detections with wrong times.

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
seconds. A detection **before** the first sync stores `esp_timer_get_time()`
(monotonic µs since boot) and is converted once synced:
`detectionTime = now - (monoNow - monoDetection)`. It waits in the flash buffer until then.

The only lost time is a gate **rebooting before it ever synced**. There is no
reference point left, so those detections are still sent, but flagged in
`metadata`: presence proven, time of day not. For check-in that is enough.

The ESP32's built-in RTC is no substitute for a DS3231: it runs from an
inaccurate RC oscillator and doesn't survive power loss. A DS3231 only pays
off for a gate that runs long without network and reboots.

### Flash budget

| | |
|---|---|
| firmware image (Wi-Fi, MQTT, mDNS, web server, PN532, plain status page) | 1.0 MB measured; OTA not in it yet |
| two OTA app partitions, 3 MB each, **status page gzipped inside the image** | 6 MB |
| NVS (Wi-Fi credentials) + LittleFS (detection buffer, ~200 B per detection) | rest |

The page lives inside the firmware image so one OTA updates both, and there
is never a page from a different firmware version. gate-config's Vuetify
build would not fit as it is (3.2 MB gzipped, mostly MDI and every font
subset), which is the other reason the page is hand-styled HTML.

OTA isn't built yet; until then a gate is updated over USB-C (later:
`development-roadmap.md` "Gate updates from the server").

## Installing

Every release carries one merged image per supported board
(`rally-gate-<version>-esp32-xiao-s3.bin`, offset 0), and its job publishes
`firmware/esp32-gate/install` to GitHub Pages with that image: Chrome or Edge,
USB-C, Install, nothing else on the laptop. It lives on Pages, not on the
release, because Web Serial needs HTTPS and release assets can't be fetched
cross-origin. Pre-releases get the image but don't replace the page.

The merged image overwrites NVS (0x9000–0xe000) with 0xFF: `merge_bin`
pads the gaps, so esptool with it erases the gate's key, Wi-Fi and settings.
The `pages` job therefore cuts it into its four parts and the manifest writes
each at its offset, leaving NVS alone; only the flasher's "erase" box wipes
it. Erase on a first install only.

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
