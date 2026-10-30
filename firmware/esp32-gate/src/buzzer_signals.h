// Copied by hand from packages/shared/src/buzzer-signals.ts; a gate-agent test
// fails when they differ. Tone lengths in ms. decoderFailed and shutdown are
// the Pi's: the ESP32 has no decoder process and no OS to shut down.
#pragma once

#include <stdint.h>

constexpr uint16_t BUZZER_GAP_MS = 100;
constexpr uint16_t BUZZER_SIGNAL_GAP_MS = 1000;

// A namespace: lwIP already has a shutdown().
namespace buzzer_signals {
constexpr uint16_t powerOn[] = {400};
constexpr uint16_t ready[] = {80, 80, 400};
constexpr uint16_t connectionLost[] = {400, 400};
constexpr uint16_t clockUnsynced[] = {400, 400, 400};
constexpr uint16_t hotspot[] = {400, 80};
constexpr uint16_t decoderFailed[] = {400, 80, 400};
constexpr uint16_t shutdown[] = {80, 400};
}  // namespace buzzer_signals
