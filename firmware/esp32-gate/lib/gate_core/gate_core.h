// Pure logic with no Arduino dependency, so `pio test -e native` can run it.
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

namespace gate {

// Seconds between the NTP epoch (1900) and the Unix epoch (1970). The 32-bit
// seconds field wraps in 2036, same as rally-server's NtpService.
const int64_t NTP_EPOCH_OFFSET_S = 2208988800LL;

inline uint32_t readBe32(const uint8_t *p) {
  return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3];
}

inline void writeBe32(uint8_t *p, uint32_t v) {
  p[0] = v >> 24;
  p[1] = v >> 16;
  p[2] = v >> 8;
  p[3] = v;
}

inline int64_t ntpToUnixUs(const uint8_t *p) {
  int64_t seconds = (int64_t)readBe32(p) - NTP_EPOCH_OFFSET_S;
  int64_t fractionUs = ((uint64_t)readBe32(p + 4) * 1000000ULL) >> 32;
  return seconds * 1000000 + fractionUs;
}

inline void unixUsToNtp(int64_t us, uint8_t *p) {
  writeBe32(p, (uint32_t)(us / 1000000 + NTP_EPOCH_OFFSET_S));
  writeBe32(p + 4, (uint32_t)(((uint64_t)(us % 1000000) << 32) / 1000000));
}

struct NtpSample {
  int64_t offsetUs;  // add to the local clock to get the server's
  int64_t delayUs;   // round trip, minus the server's own processing time
};

// RFC 5905: t1 request sent, t2 server received, t3 server replied, t4 reply
// received; t1/t4 on our clock, t2/t3 on the server's.
inline NtpSample ntpSample(int64_t t1, int64_t t2, int64_t t3, int64_t t4) {
  return {((t2 - t1) + (t3 - t4)) / 2, (t4 - t1) - (t3 - t2)};
}

// How much of a measured offset adjtime() gets. One Wi-Fi sample is off by
// ±1.5ms, about what the crystal drifts in a whole poll, so a small offset is
// halved rather than trusted; a large one is a real error and taken whole.
inline int64_t phaseCorrectionUs(int64_t offsetUs) {
  return llabs(offsetUs) < 5000 ? offsetUs / 2 : offsetUs;
}

// The frequency half of the clock discipline; adjtime() on each sync is the
// phase half. The phase half alone leaves the crystal's rate error (~30ppm
// measured, 2.4ms per 64s poll) to pile up between syncs, and a beam time
// subtracts two gates' clocks. Times monotonic µs since boot.
//
// The rate is everything corrected since a reference sync, divided by the time
// since. A noisy sample's error is undone by the next sync's correction, so
// the sum is off by about one sample's noise however long the window: ±3ppm
// after 10 minutes. The window slides between 15 and 30 minutes, since the
// rate follows temperature over a day.
struct ClockRate {
  static constexpr int64_t WINDOW_US = 30LL * 60 * 1000000;
  struct Mark {
    int64_t monoUs;  // -1: none
    int64_t appliedUs;
    int64_t correctionUs;
  };

  double ppm = 0;
  int64_t baseUs = 0;     // correction accumulated before anchorUs
  int64_t anchorUs = 0;   // where the current ppm took over
  int64_t appliedUs = 0;  // phase corrections summed since boot
  Mark ref = {-1, 0, 0}, next = {-1, 0, 0};

  int64_t correctionUs(int64_t monoUs) const {
    return baseUs + (int64_t)(ppm * (monoUs - anchorUs) / 1e6);
  }

  // phaseUs: what adjtime() was handed on this sync. A step isn't drift and
  // restarts the window.
  void onSync(int64_t phaseUs, int64_t monoUs, bool stepped) {
    if (stepped) {
      ref = next = {-1, 0, 0};
      return;
    }
    int64_t corr = correctionUs(monoUs);
    appliedUs += phaseUs;
    Mark now = {monoUs, appliedUs, corr};
    // An outlier on the reference sync would never be undone inside the
    // window, so only a small correction may become one.
    bool markable = llabs(phaseUs) < 5000;
    if (ref.monoUs < 0) {
      if (markable) ref = now;
      return;
    }
    if (monoUs - ref.monoUs >= WINDOW_US && next.monoUs >= 0) {
      ref = next;
      next = {-1, 0, 0};
    }
    if (monoUs - ref.monoUs >= WINDOW_US / 2 && next.monoUs < 0 && markable) next = now;
    if (monoUs <= ref.monoUs) return;

    baseUs = corr;
    anchorUs = monoUs;
    ppm = (double)(appliedUs - ref.appliedUs + corr - ref.correctionUs) * 1e6 / (monoUs - ref.monoUs);
    if (ppm > 500) ppm = 500;
    if (ppm < -500) ppm = -500;
  }
};

// An NTP offset is off by at most half the round trip. A round trip well above
// the usual one (rally-server busy starting up or under load) is skipped, as
// chrony's maxdelayratio does. After MAX_SKIPS in a row the path itself has
// changed, so the new round trip becomes the usual one.
struct DelayFilter {
  static const int MAX_SKIPS = 12;
  int64_t minUs = INT64_MAX;
  int skips = 0;

  bool accept(int64_t delayUs) {
    if (delayUs < minUs) minUs = delayUs;
    if (delayUs <= minUs * 2 + 4000 || ++skips > MAX_SKIPS) {
      if (skips > MAX_SKIPS) minUs = delayUs;
      skips = 0;
      return true;
    }
    return false;
  }
};

// "2026-10-08T21:04:05.123Z", what the server parses as timestampGate/sentAt.
inline void isoTime(int64_t unixUs, char out[25]) {
  time_t seconds = (time_t)(unixUs / 1000000);
  struct tm t;
  gmtime_r(&seconds, &t);
  snprintf(out, 25, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", t.tm_year + 1900,
           t.tm_mon + 1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec,
           (int)(unixUs % 1000000 / 1000));
}

// Uppercase hex, no separators, in the order the tag reports. The registration
// desk has to enter exactly this, see docs/esp32-gate.md "Identifying a driver".
inline void uidHex(const uint8_t *uid, size_t len, char *out) {
  for (size_t i = 0; i < len; i++) snprintf(out + 2 * i, 3, "%02X", uid[i]);
  out[2 * len] = '\0';
}

inline void uuidV4(uint8_t b[16], char out[37]) {
  b[6] = (b[6] & 0x0F) | 0x40;
  b[8] = (b[8] & 0x3F) | 0x80;
  snprintf(out, 37,
           "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10],
           b[11], b[12], b[13], b[14], b[15]);
}

// A tap as buffered in flash, before it is known whether the clock is synced.
// Written raw, so a layout change bumps TAP_MAGIC rather than misreading taps
// a previous firmware left in the buffer.
const uint32_t TAP_MAGIC = 0x52475431;  // "RGT1"

struct Tap {
  uint32_t magic;
  char gateId[33];    // at the tap, so a rename never re-attributes buffered taps
  char eventId[37];
  char uid[21];       // up to 10-byte UIDs
  int64_t wallUs;     // 0 when the tap came before the first sync
  uint32_t bootId;    // boot counter at the tap, monoUs is only valid within it
  int64_t monoUs;     // esp_timer_get_time() at the tap
};

enum class TapTime { Known, NotYetSyncedWait, Unknown };

// A tap before the first sync gets its time back from the monotonic clock once
// synced. A reboot in between leaves no reference, so it is sent with the time
// of sending and flagged: presence proven, time of day not.
inline TapTime resolveTapTime(const Tap &tap, uint32_t bootId, bool synced,
                              int64_t nowWallUs, int64_t nowMonoUs,
                              int64_t *outUs) {
  if (tap.wallUs != 0) {
    *outUs = tap.wallUs;
    return TapTime::Known;
  }
  if (!synced) return TapTime::NotYetSyncedWait;
  if (tap.bootId == bootId) {
    *outUs = nowWallUs - (nowMonoUs - tap.monoUs);
    return TapTime::Known;
  }
  *outUs = nowWallUs;
  return TapTime::Unknown;
}

enum class Status { None, ConnectionLost, ClockUnsynced, Ready };

// Which status sound a marshal should hear next, polled with the current state.
// The same rules as StatusSignals in apps/gate/src/agent/status-signals.ts;
// `ready` means connected, reader found and clock synced.
struct StatusTracker {
  static const uint32_t LOST_AFTER_MS = 15000;
  static const uint32_t CLOCK_BAD_AFTER_MS = 60000;

  bool needReady = true, everConnected = false, lostAnnounced = false, clockAnnounced = false;
  int64_t downSince = -1, clockBadSince = -1;

  Status next(int64_t now, bool connected, bool readerFound, bool clockSynced) {
    if (connected) {
      everConnected = true;
      downSince = -1;
      if (lostAnnounced) {
        lostAnnounced = false;
        needReady = true;
      }
    } else if (everConnected && !lostAnnounced) {
      if (downSince < 0) downSince = now;
      if (now - downSince >= LOST_AFTER_MS) {
        lostAnnounced = true;
        return Status::ConnectionLost;
      }
    }

    if (!clockSynced) {
      if (clockBadSince < 0) clockBadSince = now;
      if (!clockAnnounced && now - clockBadSince >= CLOCK_BAD_AFTER_MS) {
        clockAnnounced = true;
        return Status::ClockUnsynced;
      }
    } else {
      clockBadSince = -1;
      if (clockAnnounced) {
        clockAnnounced = false;
        needReady = true;
      }
    }

    if (needReady && connected && readerFound && clockSynced) {
      needReady = false;
      return Status::Ready;
    }
    return Status::None;
  }
};

// Every value here is generated by the firmware (hex, UUID, ISO time) or a
// gate id restricted to [A-Z0-9_], so nothing needs JSON escaping.
inline int detectionJson(const Tap &tap, int64_t timeUs, bool timeUnknown,
                         char *out, size_t size) {
  char iso[25];
  isoTime(timeUs, iso);
  return snprintf(out, size,
                  "{\"eventId\":\"%s\",\"gateId\":\"%s\",\"transponderId\":\"%s\","
                  "\"transponderKind\":\"NFC\",\"timestampGate\":\"%s\","
                  "\"source\":\"nfc\"%s}",
                  tap.eventId, tap.gateId, tap.uid, iso,
                  timeUnknown ? ",\"metadata\":{\"timeUnknown\":true}" : "");
}

// GATE_ID_PATTERN in packages/shared, by hand: the server ignores heartbeats
// from any other id, and the Pi gates use the same rule.
inline bool validGateId(const char *id) {
  size_t len = strlen(id);
  if (len == 0 || len > 32) return false;
  for (size_t i = 0; i < len; i++) {
    char c = id[i];
    if (!((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_')) return false;
  }
  return true;
}

// For the strings a marshal typed (SSID, server host) on the status page.
inline void jsonEscape(const char *in, char *out, size_t size) {
  size_t o = 0;
  for (; *in && o + 7 < size; in++) {
    unsigned char c = *in;
    if (c == '"' || c == '\\') {
      out[o++] = '\\';
      out[o++] = c;
    } else if (c < 0x20) {
      o += snprintf(out + o, size - o, "\\u%04x", c);
    } else {
      out[o++] = c;
    }
  }
  out[o] = '\0';
}

}  // namespace gate

