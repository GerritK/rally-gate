# Decoder Adapters

`apps/gate-agent` gets its transponder detections from a `DecoderAdapter`:

```ts
interface DecoderAdapter {
  start(onDetection: (transponderId: string, timestamp: Date) => void): void | Promise<void>;
  stop(): void | Promise<void>;
}
```

Only `SimulatedAdapter` (`src/adapters/simulated.adapter.ts`) exists today —
it fires detections on an interval (`SIMULATE_INTERVAL_MS`) for a configured
list of transponder IDs, and `src/simulate-cli.ts` fires one-off detections
for manual testing/demos.

Planned adapters (not implemented yet):
- `OpenStintAdapter` — wraps OpenStint's output for real RTL-SDR gate hardware.
  Protocol (per [zsellera/openstint](https://github.com/zsellera/openstint)
  `docs/decoder-protocol.md`, checked 2026-08-17): OpenStint publishes over
  **ZeroMQ pub/sub as plain space-separated text**, not JSON. A passing looks
  like `P <decoder_timestamp> <transponder_type> <transponder_id> <rssi>
  <hit_count> <pass_duration>`, e.g. `P 1618706341 OPN 1615544 3.50 64
  89113`. Two things that affect the adapter:
  - `decoder_timestamp` is a **monotonic clock since decoder process
    startup, not wall-clock time** — `OpenStintAdapter` must stamp
    `DetectionEvent.timestampGate` from the gate-agent host's own clock at
    message-receipt time, not this field. Raises the stakes on the DS3231
    RTC note below (it's not just about surviving power cycles — every
    single detection's timestamp depends on host clock accuracy).
  - `transponder_type` is `OPN` (OpenStint) or `AMB` (legacy RC3) — a second,
    concrete case of the multi-ID-namespace need described below, this time
    within "race transponder" itself, not just race-transponder-vs-RFID.
  - Recent breaking change upstream: passing messages used to report EVM
    (signal quality); that's gone, replaced by `pass_duration` (µs in the
    detection loop) as the last field. Matters if any old sample
    output/fixtures get used to build this adapter.

  OpenStint has its own answer to cross-gate timing accuracy: `T` (time
  sync) messages from reference transponders with precise clocks, letting
  two decoders correlate timestamps directly, or running multiple decoders
  on one host to sidestep cross-host clocks entirely. Not using either —
  overkill for this project's precision needs (DS3231 drift is a few
  ppm/~1 min/year, trivial against a rally stage's timescale).

  **Decision: run the decoder with `-t` (system clock instead of monotonic),
  and have `OpenStintAdapter` use `decoder_timestamp` directly as
  `timestampGate`.** OpenStint's own docs warn `-t` only after weighing
  risk — but the specific risk they name is *live NTP corrections* (jumps,
  backwards time, slewing) hitting the clock mid-event. Gate Pis are
  deliberately offline at the rally site (no NTP running at all — see the
  RTC note), so that risk category doesn't apply here. Using `-t` timestamps
  the passing at the moment OpenStint actually decodes it, inside that
  process — more accurate than gate-agent stamping its own receipt time,
  which adds ZeroMQ IPC transport + Node event-loop jitter on top. Caveat:
  the exact `decoder_timestamp` format/units under `-t` aren't specified in
  the protocol doc — confirm against real decoder output when
  `OpenStintAdapter` actually gets built.
- `RCHourglassAdapter` — considered as an alternative decoder, not currently pursued.
- `ManualEntryAdapter` — for a marshal manually keying in a passage.
- `ThroughBeamAdapter` — cheap IR break-beam sensor on GPIO, no transponder
  read. Two use cases: (1) paired with `OpenStintAdapter` at the same gate as
  a redundant trigger/cross-check when a transponder read is missed, or (2)
  a beam-only gate with no transponder reader at all, where the vehicle is
  guessed from expected start order.

  Both cases mean a detection can arrive with no known `transponderId` — the
  interface and `DetectionEvent` (`packages/shared/src/detection-event.ts`)
  currently assume it's always present. Handling this isn't just a new
  adapter: it needs an **unconfirmed** detection state in the pipeline (best-
  guess vehicle attached, held for marshal accept/correct before it becomes a
  trusted `StageRun` split) rather than committing an inferred ID straight
  through. Not designed yet — revisit when a `ThroughBeamAdapter` is
  actually built.

Adding one of these means implementing the interface and swapping which
adapter `apps/gate-agent/src/main.ts` instantiates based on an `ADAPTER` env
var — nothing else in the pipeline changes, since `rally-server` only ever
sees the resulting `DetectionEvent` over MQTT.

## Non-timing checkpoint gates (Parc Fermé, pre-start)

Idea: cheap ESP32 boards as "gates" for checkpoints that just need
presence/identity confirmation, not split-second timing — Parc Fermé
check-in, pre-start staging. Either an RFID reader (ID, but a badge/keyfob
tag, not the race transponder) or a plain button press (no ID at all,
marshal-confirmed).

Worth noting: per `architecture.md`, a gate only needs to publish the right
JSON to `rally/gates/<gateId>/detections` over MQTT — nothing requires it to
be `apps/gate-agent` running on a Pi. An ESP32 running its own firmware
(Arduino/MicroPython MQTT client) that publishes that same message is a
valid gate on its own, no Node/`DecoderAdapter` involved. The button-press
case is transponder-less like the `ThroughBeamAdapter` case above and would
lean on the same unconfirmed-detection design once that exists. Not
designed yet.

RFID *does* carry an ID, but it's a badge/keyfob tag, not the car's race
transponder — a different ID namespace on the same vehicle. `Vehicle`
currently has a single `transponderId?: string` (`vehicle.entity.ts:18`) and
lookup is one exact match (`vehicles.service.ts:21-22`), so a badge ID today
would just look like an unregistered transponder and get dropped. Fix:
generalize `Vehicle` from one `transponderId` to `1..n` IDs (race
transponder, RFID badge, maybe a second race transponder as backup — also
needed for OpenStint's own `OPN`/`AMB` transponder-type split, see
`OpenStintAdapter` above) —
`DetectionEvent.source` (`detection-event.ts:6`) already tells you which ID
space a detection is in, so matching just needs to check the right list
instead of one column. Expected to be a small change, not a big redesign.

## Hardware notes

- **DS3231 RTC module** — planned for gate-agent Pis. They run at rally
  sites with no internet/NTP, so without a hardware clock the system time
  resets or drifts on every power cycle; splits depend on comparing
  timestamps across independently-running gates, so clock accuracy here is
  load-bearing. I2C, wired directly since gate-agent runs bare-metal on the
  Pi (see `apps/gate-agent/Dockerfile` for why it's not containerized). The
  RTC covers surviving power cycles; correcting for setup-time miscalibration
  between gates is a separate planned mechanism — see "Gate control channel"
  in `architecture.md`.
- **Through-beam (IR break-beam) sensor** — candidate GPIO input for
  `ThroughBeamAdapter` above. ([example](https://de.aliexpress.com/item/1005006052871002.html))
