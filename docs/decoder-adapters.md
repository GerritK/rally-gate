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
transponder, RFID badge, maybe a second race transponder as backup) —
`DetectionEvent.source` (`detection-event.ts:6`) already tells you which ID
space a detection is in, so matching just needs to check the right list
instead of one column. Expected to be a small change, not a big redesign.

## Hardware notes

- **DS3231 RTC module** — planned for gate-agent Pis. They run at rally
  sites with no internet/NTP, so without a hardware clock the system time
  resets or drifts on every power cycle; splits depend on comparing
  timestamps across independently-running gates, so clock accuracy here is
  load-bearing. I2C, wired directly since gate-agent runs bare-metal on the
  Pi (see `apps/gate-agent/Dockerfile` for why it's not containerized).
- **Through-beam (IR break-beam) sensor** — candidate GPIO input for
  `ThroughBeamAdapter` above. ([example](https://de.aliexpress.com/item/1005006052871002.html))
