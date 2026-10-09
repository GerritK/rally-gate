# firmware/esp32-gate

ESP32 + PN532 NFC check-in gate, PlatformIO, outside the npm workspaces (CI job `firmware`). Design, the mapping of the Pi gate stack, time without an RTC and the flash budget: `docs/esp32-gate.md`.

```bash
pio test -e native        # core tests on the host (lib/gate_core)
pio run -e xiao_esp32s3   # firmware build
```

It speaks the same MQTT topics and `DetectionEvent`/heartbeat payloads as `apps/gate-agent` (`packages/shared`), so a change to those shapes has to land here too — nothing type-checks across the boundary.
