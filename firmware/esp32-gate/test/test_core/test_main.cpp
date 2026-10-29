#include <gate_core.h>
#include <stdlib.h>
#include <unity.h>

using namespace gate;

void setUp() {}
void tearDown() {}

void test_ntp_timestamp_roundtrip() {
  uint8_t p[8];
  int64_t us = 1791493445123456LL;  // 2026-10-08T21:04:05.123456Z
  unixUsToNtp(us, p);
  int64_t back = ntpToUnixUs(p);
  TEST_ASSERT_TRUE(back >= us - 1 && back <= us);
}

void test_ntp_sample_symmetric_path() {
  // Server 500ms ahead, 10ms each way, 1ms processing.
  NtpSample s = ntpSample(1000000, 1510000, 1511000, 1021000);
  TEST_ASSERT_EQUAL_INT64(500000, s.offsetUs);
  TEST_ASSERT_EQUAL_INT64(20000, s.delayUs);
}

void test_iso_time() {
  char out[25];
  isoTime(1791493445123456LL, out);
  TEST_ASSERT_EQUAL_STRING("2026-10-08T21:04:05.123Z", out);
}

void test_uid_hex() {
  uint8_t uid[] = {0x04, 0xa1, 0x0b, 0xff, 0x00, 0x7c, 0x80};
  char out[21];
  uidHex(uid, sizeof uid, out);
  TEST_ASSERT_EQUAL_STRING("04A10BFF007C80", out);
}

void test_uuid_v4_bits() {
  uint8_t b[16];
  memset(b, 0xff, sizeof b);
  char out[37];
  uuidV4(b, out);
  TEST_ASSERT_EQUAL_STRING("ffffffff-ffff-4fff-bfff-ffffffffffff", out);
}

Tap tapAt(int64_t wallUs, uint32_t bootId, int64_t monoUs) {
  Tap t = {};
  t.wallUs = wallUs;
  t.bootId = bootId;
  t.monoUs = monoUs;
  return t;
}

void test_tap_time_known_at_tap() {
  int64_t out = 0;
  Tap t = tapAt(5000, 1, 10);
  TEST_ASSERT_TRUE(resolveTapTime(t, 2, false, 0, 0, &out) == TapTime::Known);
  TEST_ASSERT_EQUAL_INT64(5000, out);
}

void test_tap_time_waits_for_sync() {
  int64_t out = 0;
  Tap t = tapAt(0, 1, 10);
  TEST_ASSERT_TRUE(resolveTapTime(t, 1, false, 0, 0, &out) == TapTime::NotYetSyncedWait);
}

void test_tap_time_from_monotonic_after_sync() {
  int64_t out = 0;
  Tap t = tapAt(0, 1, 2000000);  // tapped 2s after boot
  // Synced; 8s after boot it is 1000s wall time, so the tap was 6s earlier.
  TEST_ASSERT_TRUE(resolveTapTime(t, 1, true, 1000000000, 8000000, &out) == TapTime::Known);
  TEST_ASSERT_EQUAL_INT64(994000000, out);
}

void test_tap_time_unknown_across_reboot() {
  int64_t out = 0;
  Tap t = tapAt(0, 1, 2000000);
  TEST_ASSERT_TRUE(resolveTapTime(t, 2, true, 1000000000, 8000000, &out) == TapTime::Unknown);
  TEST_ASSERT_EQUAL_INT64(1000000000, out);
}

void test_detection_json() {
  Tap t = {};
  strcpy(t.gateId, "CLUB_CHECKIN");
  strcpy(t.eventId, "0f8fad5b-d9cb-469f-a165-70867728950e");
  strcpy(t.uid, "04A10BFF007C80");
  char out[320];
  detectionJson(t, 1791493445123456LL, false, out, sizeof out);
  TEST_ASSERT_EQUAL_STRING(
      "{\"eventId\":\"0f8fad5b-d9cb-469f-a165-70867728950e\",\"gateId\":\"CLUB_CHECKIN\","
      "\"transponderId\":\"04A10BFF007C80\",\"transponderKind\":\"NFC\","
      "\"timestampGate\":\"2026-10-08T21:04:05.123Z\",\"source\":\"nfc\"}",
      out);
  detectionJson(t, 1791493445123456LL, true, out, sizeof out);
  TEST_ASSERT_NOT_NULL(strstr(out, ",\"metadata\":{\"timeUnknown\":true}}"));
}

void test_valid_gate_id() {
  TEST_ASSERT_TRUE(validGateId("CLUB_START_WP1"));
  TEST_ASSERT_FALSE(validGateId(""));
  TEST_ASSERT_FALSE(validGateId("club_start"));
  TEST_ASSERT_FALSE(validGateId("A/B"));
  TEST_ASSERT_FALSE(validGateId("A+"));
}

void test_json_escape() {
  char out[32];
  jsonEscape("a\"b\\c\nd", out, sizeof out);
  TEST_ASSERT_EQUAL_STRING("a\\\"b\\\\c\\u000ad", out);
  jsonEscape("0123456789012345678901234567890123", out, 16);
  TEST_ASSERT_TRUE(strlen(out) < 16);
}

// A crystal 37ppm slow, synced every 64s for an hour (past the window slide),
// each sample off by ±1.5ms as on Wi-Fi; `outlierAt` adds 150ms to one sample.
// Returns the clock's error just before the last sync.
static int64_t simulateClock(ClockRate &rate, int outlierAt) {
  const int64_t poll = 64000000;
  int64_t sys = 0, error = 0;
  for (int k = 1; k <= 60; k++) {
    int64_t mono = k * poll;
    sys += poll - poll * 37 / 1000000;
    error = mono - (sys + rate.correctionUs(mono));
    int64_t phase = phaseCorrectionUs(error + (k % 2 ? 1500 : -1500) + (k == outlierAt ? 150000 : 0));
    sys += phase;
    rate.onSync(phase, mono, false);
  }
  return error;
}

void test_clock_rate_converges() {
  ClockRate rate;
  int64_t error = simulateClock(rate, 0);
  TEST_ASSERT_TRUE(rate.ppm > 36 && rate.ppm < 38);
  TEST_ASSERT_TRUE(llabs(error) < 1500);
}

void test_clock_rate_outlier_cancels() {
  // The next sync takes the 150ms back, so the sum doesn't keep it.
  ClockRate rate;
  simulateClock(rate, 40);
  TEST_ASSERT_TRUE(rate.ppm > 36 && rate.ppm < 38);
}

void test_phase_correction() {
  TEST_ASSERT_EQUAL_INT64(-700, phaseCorrectionUs(-1400));
  TEST_ASSERT_EQUAL_INT64(150000, phaseCorrectionUs(150000));
}

void test_delay_filter() {
  DelayFilter f;
  TEST_ASSERT_TRUE(f.accept(5000));
  TEST_ASSERT_TRUE(f.accept(13000));    // within 2x + 4ms
  TEST_ASSERT_FALSE(f.accept(300000));  // server busy
  TEST_ASSERT_TRUE(f.accept(6000));
  // A path that stays slow is accepted after MAX_SKIPS and becomes the usual.
  for (int i = 0; i < DelayFilter::MAX_SKIPS; i++) TEST_ASSERT_FALSE(f.accept(50000));
  TEST_ASSERT_TRUE(f.accept(50000));
  TEST_ASSERT_TRUE(f.accept(60000));
}

void test_status_ready_then_lost_then_ready() {
  StatusTracker s;
  TEST_ASSERT_EQUAL(Status::None, s.next(0, false, true, true));
  TEST_ASSERT_EQUAL(Status::Ready, s.next(1000, true, true, true));
  TEST_ASSERT_EQUAL(Status::None, s.next(2000, true, true, true));
  // A hiccup under 15s is silent both ways.
  TEST_ASSERT_EQUAL(Status::None, s.next(3000, false, true, true));
  TEST_ASSERT_EQUAL(Status::None, s.next(17999, false, true, true));
  TEST_ASSERT_EQUAL(Status::None, s.next(18000, true, true, true));
  // Longer is heard once, and the return is announced.
  TEST_ASSERT_EQUAL(Status::None, s.next(20000, false, true, true));
  TEST_ASSERT_EQUAL(Status::ConnectionLost, s.next(35000, false, true, true));
  TEST_ASSERT_EQUAL(Status::None, s.next(40000, false, true, true));
  TEST_ASSERT_EQUAL(Status::Ready, s.next(50000, true, true, true));
}

void test_status_never_connected_is_silent() {
  StatusTracker s;
  for (int64_t t = 0; t < 300000; t += 1000) TEST_ASSERT_EQUAL(Status::None, s.next(t, false, true, true));
}

void test_status_clock_withholds_ready_and_warns_once() {
  StatusTracker s;
  TEST_ASSERT_EQUAL(Status::None, s.next(0, true, true, false));
  TEST_ASSERT_EQUAL(Status::None, s.next(59999, true, true, false));
  TEST_ASSERT_EQUAL(Status::ClockUnsynced, s.next(60000, true, true, false));
  TEST_ASSERT_EQUAL(Status::None, s.next(61000, true, true, false));
  TEST_ASSERT_EQUAL(Status::Ready, s.next(62000, true, true, true));
}

void test_status_reader_missing_withholds_ready() {
  StatusTracker s;
  TEST_ASSERT_EQUAL(Status::None, s.next(0, true, false, true));
  TEST_ASSERT_EQUAL(Status::Ready, s.next(1000, true, true, true));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_ntp_timestamp_roundtrip);
  RUN_TEST(test_ntp_sample_symmetric_path);
  RUN_TEST(test_iso_time);
  RUN_TEST(test_uid_hex);
  RUN_TEST(test_uuid_v4_bits);
  RUN_TEST(test_tap_time_known_at_tap);
  RUN_TEST(test_tap_time_waits_for_sync);
  RUN_TEST(test_tap_time_from_monotonic_after_sync);
  RUN_TEST(test_tap_time_unknown_across_reboot);
  RUN_TEST(test_detection_json);
  RUN_TEST(test_valid_gate_id);
  RUN_TEST(test_json_escape);
  RUN_TEST(test_clock_rate_converges);
  RUN_TEST(test_clock_rate_outlier_cancels);
  RUN_TEST(test_phase_correction);
  RUN_TEST(test_delay_filter);
  RUN_TEST(test_status_ready_then_lost_then_ready);
  RUN_TEST(test_status_never_connected_is_silent);
  RUN_TEST(test_status_clock_withholds_ready_and_warns_once);
  RUN_TEST(test_status_reader_missing_withholds_ready);
  return UNITY_END();
}
