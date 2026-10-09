#include <gate_core.h>
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
  return UNITY_END();
}
