# Decoder Adapters

`apps/gate-agent` gets its detections from a `DecoderAdapter`:

```ts
interface DecoderAdapter {
  start(onDetection: (transponderId: string, timestamp: Date) => void): void | Promise<void>;
  stop(): void | Promise<void>;
}
```

Only `SimulatedAdapter` exists: it fires detections on an interval
(`SIMULATE_INTERVAL_MS`) for the configured `TRANSPONDERS`, and
`src/simulate-cli.ts` fires one-offs. A new adapter implements the interface and
is picked by the `ADAPTER` env var; nothing past gate-agent changes, since the
server only ever sees a `DetectionEvent`.

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
- `ThroughBeamAdapter` — IR break-beam on GPIO, no transponder read: as a
  backup trigger beside OpenStint, or a beam-only gate that guesses the car from
  start order. Either way a detection can arrive without a `transponderId`,
  which needs an **unconfirmed** detection state (best guess, held for marshal
  accept/correct) rather than committing a guess. Not designed.
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
- **IR break-beam** — candidate for `ThroughBeamAdapter`
  ([example](https://de.aliexpress.com/item/1005006052871002.html)).
