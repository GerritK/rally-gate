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
- `beam-openstint` — both at one spot, below.

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
| `BEAM_GPIO` | `17` | BCM number (physical pin 11), used as line name `GPIO17` — the same on every Pi model |
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

## Buzzer

Any adapter: `BUZZER_GPIO` (a BCM number, unset by default, set from gate-config)
names a line with an active buzzer, which beeps 120ms the moment a passing is
detected, as the ESP32 gate does. On `beam-openstint` the beam beeps, not the read:
that passing is published only once paired, up to a second later, which in the
field read as a missed car. A beam that is then dropped has still beeped, which
helps aligning it. gate-agent drives it with libgpiod's `gpioset` after
taking the timestamp, so it never touches the timing, and a failing buzzer only logs.
Passings during a beep queue up (at most 3) and beep after it, 100ms apart.

**Not straight off the pin:** an active buzzer draws ~30mA, a Pi GPIO is good
for ~16mA. Use a buzzer module with its own transistor (3 pins: VCC, GND, I/O;
take a high-level-trigger one), or an NPN (e.g. 2N2222, 1kΩ to the base) with
the buzzer on 5V. GPIO27 (physical pin 13) is free beside the beam's GPIO17.

## Beam + OpenStint

`beam-openstint`: a light barrier for the time, OpenStint for the identity, at
one spot — the beam's edge is sharper than a radio read, and the transponder
names the car. It runs both adapters below unchanged and pairs their output;
no server change. Beam settings (`BEAM_*`) and `OPENSTINT_GAIN` apply as
they do alone.

A beam edge and a read are a **pair** when the beam has exactly one read
within `PAIR_WINDOW_MS` and that read has exactly one beam. Anything else
would be a guess, and a guessed pairing hands one car another's time.

- **Pair:** published once, beam timestamp + transponder,
  `metadata.readOffsetMs` = read minus beam — what to look at when settling
  the window on real hardware.
- **Beam with reads near but no pair:** no transponder, so it lands with the
  marshal (unassigned passing), the reads in its window as
  `metadata.candidates`. Two cars inside one beam lockout are one edge and
  two reads: the marshal assigns the edge to one of them, the other car has
  no passing here.
- **Beam with no read near:** dropped, since nothing says a car was there
  (people, grass, sun). `FORWARD_BEAM_ONLY=on` sends it to the marshal
  instead, for a field where some cars carry no transponder.
- **Read without a pair:** dropped. A radio time alone is not precise enough
  to rank on, and a read from a car parked near the loop would time a car
  that never drove through.

Every drop is a `dropped` warning in the gate's log, which gate-config
shows. A dead beam drops every read: the dashboard shows only a
quiet gate.

A detection goes out once nothing still on its way could change its pairing:
`2 × PAIR_WINDOW_MS` plus 1s for OpenStint's report lag after the timestamp.
Live Timing shows such a gate's passings ~2s late; the times are unaffected.

| Setting | Default | |
|---|---|---|
| `PAIR_WINDOW_MS` | `500` | a beam edge and a read further apart are different cars. Not yet settled on hardware |
| `FORWARD_BEAM_ONLY` | `off` | `on`: a beam with no read near goes to the marshal rather than being dropped |

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
  their RC3 frames). Only the id is published; see "OpenStint OPN and AMB ids".
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

## OpenStint OPN and AMB ids

Transponder kinds and matching: `event-model.md` "Transponders". Still open:
OpenStint's `OPN`/`AMB` are two ID namespaces within RC, so either two kinds
or a prefixed identifier, settled with the adapter.

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
