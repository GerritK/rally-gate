# apps/gate-agent

Runs on a gate: reads a decoder, publishes detections and heartbeats over MQTT. It knows its `GATE_ID` and nothing else (root `CLAUDE.md`, "Gates are dumb").

- Tests run on **`node:test`**, not jest: `npm test -w apps/gate-agent`.
- **`DecoderAdapter`** (`src/adapters/decoder-adapter.ts`, `start()`/`stop()`) isolates hardware. `SimulatedAdapter` and `BeamAdapter` (light barrier via `gpiomon`) exist, picked by `ADAPTER` in `create-adapter.ts`. Everything past this app only sees a `DetectionEvent`, so new hardware (`OpenStintAdapter`, planned) never touches `rally-server`. A beam detection has no `transponderId`; the server holds it for a marshal. Hardware notes: `docs/decoder-adapters.md`.
- **`clientId`/`clean: false`/`queueQoSZero: false` in `src/uplink.ts` are load-bearing**: detections are QoS 1 over a persistent session so a reconnect replays them; heartbeats are QoS 0 and never queued, since a stale `sentAt` would be measured as clock offset. The comments there explain each.
- The env vars in `src/config.ts` are set on a gate through `apps/gate-config` (`FIELDS` in `config-file.ts`), and `deploy/install-gate-pi.sh` writes `GATE_ID`/`MQTT_HOST`/`MQTT_PORT`. Renaming one means changing those too; a new one belongs in `FIELDS`, or it can't be set on a gate.
