# Decoder Adapters

`apps/gate-agent` gets its detections from a `DecoderAdapter`:

```ts
interface DecoderAdapter {
  start(onDetection: (transponderId: string | undefined, timestamp: Date) => void): void | Promise<void>;
  stop(): void | Promise<void>;
}
```

`ADAPTER` picks one; an unknown value exits rather than falling back to the
simulator. Nothing past gate-agent changes per adapter, since the server only
ever sees a `DetectionEvent`.

- `simulated` — fires detections on an interval (`SIMULATE_INTERVAL_MS`) for the
  configured `TRANSPONDERS`. `src/simulate-cli.ts` fires one-offs, `--beam` for
  one without a transponder.
- `beam` — a light barrier, below.
- `openstint` — a transponder loop on an RTL-SDR, below.

## BeamAdapter (light barrier)

Times a passing but can't identify the car: detections carry no
`transponderId`, and the server holds them as **unassigned passings** until a
marshal picks the entry on Live Timing (see `event-model.md`).

Reads the pin through libgpiod's `gpiomon` (package `gpiod`, installed by the
gate installer), not a native Node module, so nothing compiles on the Pi. The
timestamp is the kernel's, taken at the interrupt, and converted to wall-clock
time from its lag behind `CLOCK_MONOTONIC` — pipe and event-loop latency never
reach the timing. libgpiod v1 (Pi OS Bookworm) and v2 (Trixie) take different
arguments; the adapter detects which.

| Setting | Default | |
|---|---|---|
| `BEAM_GPIO` | `GPIO17` | BCM line name (physical pin 11) — the same on every Pi model |
| `BEAM_EDGE` | `rising` | which edge means "beam broken" |
| `BEAM_LOCKOUT_MS` | `500` | further edges within this window are the same car — a body breaks the beam several times (wheels, wing) |

All set from gate-config. If `gpiomon` can't run, gate-agent exits with the
reason in its log.

### Wiring an E3Z-T61 (NPN, through-beam)

The E3Z-T61 is an emitter + receiver pair, NPN open-collector output, 1ms
response time.

- **Supply 12-24V DC, not the Pi's 5V** — a small step-up converter or the
  gate's 12V battery. Brown = +V, blue = 0V, on both emitter and receiver.
- **Receiver black (output) → GPIO17**, ideally through a 1kΩ series resistor.
- **Common ground:** the sensor supply's 0V must connect to a Pi GND pin, or the
  output has no reference.
- The pull-up to 3.3V is the Pi's internal one, enabled by the adapter. On
  cable runs over a couple of metres add an external 4.7kΩ from GPIO17 to
  3.3V against noise.

Open collector means the output only ever pulls *down*, so the pin never sees
the 12-24V supply. **Check that before connecting a clone:** powered, output
unconnected, measure black against blue — an open collector does not show the
supply voltage. If it does, the sensor has an internal pull-up and must go
through an optocoupler (e.g. PC817) instead, or it destroys the GPIO.

**Edge:** in Light-ON mode the output conducts while the receiver sees light, so
the pin is low with the beam intact and goes high when it breaks → `rising`.
Dark-ON is the reverse → `falling`. Original E3Z receivers have an L/D
selector; clones vary. To check, hold a hand in the beam for two seconds: the
gate-agent log should show the detection when the hand goes *in*, not when it
comes out. If not, flip `BEAM_EDGE`.

## Beam + OpenStint (planned)

Light barrier for the time, OpenStint for the identity — the beam's edge is
sharper than a radio read, and the transponder names the car. A composite
adapter wrapping the two, no server change:

- On each beam trigger, wait up to a window W (order 1s — OpenStint reports a
  passing when it ends) for OpenStint reads timed within ±W of the edge.
- **One read:** publish once, beam timestamp + that transponder.
- **No read:** publish the beam trigger without a transponder, so it lands with
  the marshal — the existing unassigned-passing flow.
- **Several reads** (cars nose to tail): don't guess. Publish without a
  transponder, candidates in `metadata`, for the marshal.
- **A read without a beam trigger** (beam missed, misaligned): publish with
  OpenStint's own timestamp and mark it in `metadata`, so it still times, less
  precisely, rather than being lost.

W and the beam lockout interact: two cars inside one lockout are one trigger.
Settle W against real hardware.

## OpenStintAdapter

Wraps [OpenStint](https://github.com/zsellera/openstint) on an RTL-SDR. gate-agent
spawns `chrt -f 70 openstint_rtlsdr -t -g <OPENSTINT_GAIN> -s /var/lib/openstint`
and reads its **stdout**: OpenStint prints every message it also publishes over
ZeroMQ, so there is no ZeroMQ client and nothing native to compile. Upstream
source checked 2026-10-03 (`512e8da`).

A passing is
`P <timestamp_ms> <transponder_type> <transponder_id> <rssi> <hit_count> <pass_duration_us> <mer>`,
e.g. `P 1791234567890 OPN 1615544 -3.50 64 89113 24.3`. Fields are positional
and upstream may append more, so only a minimum length is checked.

- **`-t` changes only the reported field.** `reporting_timestamp` in upstream
  `src/commons.cpp` converts the steady-clock time to system time at report
  time; passing detection, dedup and `pass_duration` stay on the steady clock.
  So the timestamp is used directly. It is the RSSI-weighted centre of the
  passing, stamped at decode time — no pipe or event-loop jitter.
- A passing is reported **~250ms after the car leaves the loop**. A timestamp
  lagging receipt by more than 5s, or ahead of it, falls back to receipt time
  with a warning (decoder without `-t`, or a stepped clock).
- `transponder_type` is `OPN` or `AMB` (RC3 — RC4 hybrids are read through
  their RC3 frames). Only the id is published; see "Multiple IDs per vehicle".
- Each passing is logged with `rssi`, `hits` and `mer` — what to look at
  while setting up a loop. Upstream: RSSI above -3 dB is clipping (lower the
  gain); MER below 3 dB is bad, above 6 dB good.
- **SCHED_FIFO** because upstream calls sample capture hard real-time and runs
  its own unit that way; `LimitRTPRIO=70` in the gate-agent unit lets an
  unprivileged user do it.
- If the decoder exits, gate-agent exits, like `gpiomon` for the beam.
- The once-a-second status line `S <timestamp> <noise_power> <dc_offset>
  <frames_received> <frames_processed> …` stays out of the journal: the
  latest one goes to `$RUNTIME_DIRECTORY/openstint-status` (tmpfs) for the
  gate-config page. `frames_received` stuck at 0 with a powered transponder
  on the loop, and a `noise_power` that doesn't rise when the antenna socket
  is touched, means the SDR's HF input isn't connected — a fake stick.

The installer adds upstream's apt repo (arm64 only), installs `openstint`, and
**masks the package's own `openstint.service`** — two decoders can't share
one SDR. The gate user joins `plugdev` (SDR) and `users` (`/var/lib/openstint`).

| Setting | Default | |
|---|---|---|
| `OPENSTINT_GAIN` | `20` | RTL-SDR tuner gain in dB, 0-40 |

## Other adapter ideas

- **ESP32 checkpoint gates** for check-in, Parc Fermé and pre-start, where
  presence matters and timing doesn't. A gate is anything that publishes the
  right JSON to `rally/gates/<gateId>/detections`, so no gate-agent is needed.
  The NFC one is designed in `esp32-gate.md`.

### Multiple IDs per entry

Built: an entry has a list of transponders, each with a kind (RC, NFC) from
`TransponderKind` in `packages/shared`, and a detection matches only its own
kind. The adapter states the kind as `DetectionEvent.transponderKind` — not
derived from `source`, which names the adapter (beam + OpenStint reads RC) —
and absent means RC. OpenStint's `OPN`/`AMB` split is still open: two ID
namespaces within RC, so either two kinds or a prefixed identifier, settled
with the adapter.

## Gate system clock policy

Any time daemon on a gate may **step the clock only at boot, and slew from then
on**. A step mid-stage lands in the time of every car on stage across it; a
bounded slew moves a minutes-long stage by milliseconds.

This is Debian's chrony default (`makestep 1 3`), which is why the installer adds
a `conf.d` drop-in instead of replacing `chrony.conf`, and why `gate-config`
changes the source with `chronyc reload sources` rather than a restart (a
restart re-arms the boot steps). A chrony release that changed this default
would break the policy silently — check it first if a `StageRun` ever shows an
unexplained jump.

## Hardware notes

- **DS3231 RTC** — supported by the gate installer (asked interactively). Holds
  the time across power cycles with no network; chrony's `rtcsync` writes the
  synced time back to it. Wired over I2C, which is one reason gate-agent runs on
  bare metal rather than in Docker.
- **GPS with PPS** — optional, per gate, deferred until hardware is on hand. Not
  for accuracy (LAN chrony is already 20-100x better than needed) but because it
  takes the network out of the timing path: a gate with PPS keeps exact time
  even out of contact for a whole stage, buffering detections over the QoS 1
  session. Needs a UART/GPIO module with PPS on a GPIO (`dtoverlay=pps-gpio`),
  **not a USB dongle** — USB destroys the pulse edge. It becomes a chrony
  refclock, complements the RTC, needs sky view (forest and valleys are the real
  risk), ~EUR 15-30 per gate. No server change: `Gate.clockOffsetMs` doubles as
  its health indicator.
- **Light barrier** — E3Z-T61 NPN through-beam
  ([source](https://de.aliexpress.com/item/1005006052871002.html)), wiring
  above.
