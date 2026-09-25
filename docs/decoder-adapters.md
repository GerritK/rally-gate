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

## BeamAdapter (light barrier)

Times a passing but can't identify the car: detections carry no
`transponderId`, and the server holds them as **unassigned passings** until a
marshal picks the vehicle on Live Timing (see `event-model.md`).

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
Settle W against real hardware together with the `-t` question below.

## OpenStintAdapter (planned)

Wraps [OpenStint](https://github.com/zsellera/openstint) on RTL-SDR gate
hardware. Protocol (`docs/decoder-protocol.md` upstream, checked 2026-08-17):
**ZeroMQ pub/sub, plain space-separated text**. A passing is
`P <decoder_timestamp> <transponder_type> <transponder_id> <rssi> <hit_count> <pass_duration>`,
e.g. `P 1618706341 OPN 1615544 3.50 64 89113`.

- `decoder_timestamp` is monotonic since decoder start unless the decoder runs
  with `-t` (system clock).
- `transponder_type` is `OPN` or `AMB` (legacy RC3) — two ID namespaces, see
  "Multiple IDs per vehicle" below.
- Upstream recently replaced EVM with `pass_duration` as the last field; old
  sample output won't match.

**Open question that decides the timestamp source: does `-t` change only the
reported field, or also OpenStint's internal logic** (hit correlation,
deduplication, `pass_duration`)? Check their source before building.

- Only the field → run with `-t` and use `decoder_timestamp` directly. It stamps
  at decode time, avoiding 1-20ms of ZeroMQ + event-loop jitter.
- Internal logic too → stay monotonic and calibrate in the adapter: keep the
  minimum observed `wallNow - decoder_timestamp` and use
  `calibratedEpoch + decoder_timestamp`. ~15 lines; a jump in the calibration
  also reveals a stepped clock or a decoder restart.

`-t` does not make clock steps more dangerous: with or without it, the timestamp
comes from the same system clock. Step safety comes from the clock policy below.
Either way, compare decoder time with receipt time and warn past a bound.

Keep it in proportion: this is milliseconds, the cross-gate skew that chrony
fixes was seconds. Confirm the `-t` timestamp format against real output.

## Other adapter ideas

- `ManualEntryAdapter` — a marshal keying in a passing.
- **ESP32 checkpoint gates** for Parc Fermé / pre-start, where presence matters
  and timing doesn't (RFID reader or a button). A gate is anything that
  publishes the right JSON to `rally/gates/<gateId>/detections` — no gate-agent
  needed.

### Multiple IDs per vehicle

An RFID badge, a backup transponder, or OpenStint's `OPN`/`AMB` split all mean
one vehicle with several IDs. Today `Vehicle` has one `transponderId` and lookup
is one exact match, so anything else looks unregistered. Fix when needed: a
list of IDs per vehicle, matched by `DetectionEvent.source`. Small change.

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
