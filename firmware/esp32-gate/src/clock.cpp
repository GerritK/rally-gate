// Own NTP client rather than ESP-IDF's SNTP: lwIP's port is fixed at 123 at
// compile time, and rally-server answers on 57432 (port table in CLAUDE.md).
#include <WiFiUdp.h>
#include <sys/time.h>

#include "gate.h"

static const uint32_t POLL_MS = 64000;  // chrony's default minpoll
static const uint32_t RETRY_MS = 5000;
static const uint32_t FRESH_MS = 5 * 60000;
static const int SAMPLES = 4;
static const uint32_t REPLY_TIMEOUT_MS = 300;

static WiFiUDP udp;
static bool udpOpen = false;
static bool everSet = false;
static int syncs = 0;
static uint32_t lastSyncMs = 0;
static uint32_t nextPollMs = 0;
static float lastOffsetMs = 0;

int64_t wallUs() {
  timeval tv;
  gettimeofday(&tv, nullptr);
  return (int64_t)tv.tv_sec * 1000000 + tv.tv_usec;
}

bool clockSet() { return everSet; }
bool clockFresh() { return everSet && millis() - lastSyncMs < FRESH_MS; }
float clockOffsetMs() { return lastOffsetMs; }

static bool sample(IPAddress server, gate::NtpSample &out) {
  uint8_t req[48] = {0};
  req[0] = (4 << 3) | 3;  // version 4, client mode
  while (udp.parsePacket() > 0) udp.flush();  // a late reply to an earlier sample

  int64_t t1 = wallUs();
  gate::unixUsToNtp(t1, req + 40);
  udp.beginPacket(server, NTP_PORT);
  udp.write(req, sizeof req);
  if (!udp.endPacket()) return false;

  uint32_t start = millis();
  while (millis() - start < REPLY_TIMEOUT_MS) {
    if (udp.parsePacket() < 48) continue;
    int64_t t4 = wallUs();
    uint8_t res[48];
    udp.read(res, sizeof res);
    // The server echoes our transmit timestamp as its origin; anything else
    // answers a request we've given up on.
    if ((res[0] & 7) != 4 || memcmp(res + 24, req + 40, 8) != 0) continue;
    out = gate::ntpSample(t1, gate::ntpToUnixUs(res + 32), gate::ntpToUnixUs(res + 40), t4);
    return true;
  }
  return false;
}

// The gate clock policy from docs/decoder-adapters.md, as chrony's
// `makestep 1 3`: step only within the first three syncs, slew from then on.
// A step mid-event lands in every tap across it.
static void apply(int64_t offsetUs) {
  if (llabs(offsetUs) > 1000000 && syncs < 3) {
    int64_t now = wallUs() + offsetUs;
    timeval tv = {(time_t)(now / 1000000), (suseconds_t)(now % 1000000)};
    settimeofday(&tv, nullptr);
    Serial.printf("[clock] stepped by %lld ms\n", offsetUs / 1000);
  } else {
    // ponytail: ESP-IDF slews at 1/6 of real time, so 60ms takes 360ms. Fine
    // for check-in; measure it before a beam gate relies on it.
    timeval delta = {(time_t)(offsetUs / 1000000), (suseconds_t)(offsetUs % 1000000)};
    if (adjtime(&delta, nullptr) != 0) Serial.printf("[clock] adjtime refused %lld ms\n", offsetUs / 1000);
  }
}

void clockTick(IPAddress server) {
  if (server == IPAddress() || (int32_t)(millis() - nextPollMs) < 0) return;
  if (!udpOpen) udpOpen = udp.begin(0);

  // The sample with the shortest round trip has the least room for an
  // asymmetric path, which is all an NTP offset can't see.
  gate::NtpSample best = {0, INT64_MAX};
  // A timeout ends the round: the loop blocks while waiting, and that is time
  // the reader isn't polling.
  for (int i = 0; i < SAMPLES; i++) {
    gate::NtpSample s;
    if (!sample(server, s)) break;
    if (s.delayUs < best.delayUs) best = s;
  }
  if (best.delayUs == INT64_MAX) {
    nextPollMs = millis() + RETRY_MS;
    return;
  }

  apply(best.offsetUs);
  syncs++;
  everSet = true;
  lastSyncMs = millis();
  lastOffsetMs = fabsf(best.offsetUs / 1000.0f);
  nextPollMs = millis() + POLL_MS;
}
