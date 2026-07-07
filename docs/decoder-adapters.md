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

Adding one of these means implementing the interface and swapping which
adapter `apps/gate-agent/src/main.ts` instantiates based on an `ADAPTER` env
var — nothing else in the pipeline changes, since `rally-server` only ever
sees the resulting `DetectionEvent` over MQTT.
