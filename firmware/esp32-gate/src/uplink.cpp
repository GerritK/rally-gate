// Detections go to flash first and leave it only on PUBACK. esp-mqtt's outbox
// is RAM, so it alone would lose every unacked tap on a power cut, and a
// dropped tap is a driver with no time. Resending is safe: the server keys
// detections on eventId and its rules ignore repeats (CLAUDE.md).
#include <LittleFS.h>
#include <esp_timer.h>
#include <freertos/queue.h>
#include <mqtt_client.h>

#include "gate.h"

static const uint32_t HEARTBEAT_MS = 15000;
static const uint32_t FLUSH_MS = 1000;
static const uint32_t ACK_TIMEOUT_MS = 30000;
static const size_t MIN_FREE_BYTES = 16384;
static const int MAX_IN_FLIGHT = 8;

struct InFlight {
  int msgId;  // 0 = free slot
  char path[24];
  uint32_t sentMs;
};

static esp_mqtt_client_handle_t client = nullptr;
static String currentUri;
static volatile bool connected = false;
static bool wasConnected = false;
static QueueHandle_t acks;
static InFlight inFlight[MAX_IN_FLIGHT];
static uint32_t nextHeartbeatMs = 0;
static uint32_t nextFlushMs = 0;
static uint32_t tapSeq = 0;
static int buffered = 0;

// Runs on esp-mqtt's own task, so it only hands over; loop() does the work.
static void onMqttEvent(void *, esp_event_base_t, int32_t id, void *data) {
  auto *event = (esp_mqtt_event_handle_t)data;
  if (id == MQTT_EVENT_CONNECTED) connected = true;
  if (id == MQTT_EVENT_DISCONNECTED) connected = false;
  if (id == MQTT_EVENT_PUBLISHED) xQueueSend(acks, &event->msg_id, 0);
}

static int countBuffered() {
  int n = 0;
  File dir = LittleFS.open("/q");
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) n++;
  return n;
}

void uplinkBegin() {
  acks = xQueueCreate(32, sizeof(int));
  LittleFS.mkdir("/q");
  buffered = countBuffered();
}

bool uplinkConnected() { return connected; }
int bufferedCount() { return buffered; }

bool bufferTap(const gate::Tap &tap) {
  if (LittleFS.totalBytes() - LittleFS.usedBytes() < MIN_FREE_BYTES) return false;
  char path[24];
  snprintf(path, sizeof path, "/q/%08lx%06lx", (unsigned long)bootId, (unsigned long)tapSeq++);
  File f = LittleFS.open(path, "w");
  if (!f) return false;
  bool ok = f.write((const uint8_t *)&tap, sizeof tap) == sizeof tap;
  f.close();
  if (!ok) {
    LittleFS.remove(path);
    return false;
  }
  buffered++;
  return true;
}

static bool isInFlight(const char *path) {
  for (auto &s : inFlight)
    if (s.msgId && strcmp(s.path, path) == 0) return true;
  return false;
}

static InFlight *freeSlot() {
  for (auto &s : inFlight)
    if (!s.msgId) return &s;
  return nullptr;
}

static void handleAcks() {
  int msgId;
  while (xQueueReceive(acks, &msgId, 0) == pdTRUE) {
    for (auto &s : inFlight) {
      if (s.msgId != msgId) continue;
      if (LittleFS.remove(s.path)) buffered--;
      s.msgId = 0;
    }
  }
  // Unacked for too long: free the slot so the next flush sends it again.
  for (auto &s : inFlight)
    if (s.msgId && millis() - s.sentMs > ACK_TIMEOUT_MS) s.msgId = 0;
}

static void flush() {
  File dir = LittleFS.open("/q");
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) {
    String path = f.path();
    if (isInFlight(path.c_str())) continue;
    InFlight *slot = freeSlot();
    if (!slot) break;

    gate::Tap tap;
    bool ok = f.read((uint8_t *)&tap, sizeof tap) == sizeof tap && tap.magic == gate::TAP_MAGIC;
    f.close();
    if (!ok) {
      // Kept, not deleted: a tap from another firmware's layout is still evidence.
      Serial.printf("[uplink] unreadable %s\n", path.c_str());
      continue;
    }

    int64_t timeUs;
    gate::TapTime t = gate::resolveTapTime(tap, bootId, clockSet(), wallUs(), esp_timer_get_time(), &timeUs);
    if (t == gate::TapTime::NotYetSyncedWait) continue;
    if (t == gate::TapTime::Known && tap.wallUs == 0) {
      // Pin the recovered time now: after a reboot the monotonic reference is gone.
      tap.wallUs = timeUs;
      File w = LittleFS.open(path, "w");
      if (w) {
        w.write((const uint8_t *)&tap, sizeof tap);
        w.close();
      }
    }

    char json[320];
    gate::detectionJson(tap, timeUs, t == gate::TapTime::Unknown, json, sizeof json);
    char topic[64];
    snprintf(topic, sizeof topic, "rally/gates/%s/detections", tap.gateId);
    int msgId = esp_mqtt_client_publish(client, topic, json, 0, 1, 0);
    if (msgId <= 0) break;
    slot->msgId = msgId;
    strlcpy(slot->path, path.c_str(), sizeof slot->path);
    slot->sentMs = millis();
  }
}

static void heartbeat() {
  char json[256];
  int n = snprintf(json, sizeof json, "{\"capabilities\":\"nfc\",\"version\":\"%s\"", FIRMWARE_VERSION);
  // sentAt only once the clock is set: a 1970 timestamp would read on the
  // server as a gate fifty years off.
  if (clockSet()) {
    char iso[25];
    gate::isoTime(wallUs(), iso);
    n += snprintf(json + n, sizeof json - n, ",\"sentAt\":\"%s\"", iso);
  }
  // Named for chrony, filled from our own client: same meaning, see gate-heartbeat.ts.
  n += snprintf(json + n, sizeof json - n, ",\"chronySynced\":%s", clockFresh() ? "true" : "false");
  if (clockFresh()) n += snprintf(json + n, sizeof json - n, ",\"chronyOffsetMs\":%.3f", clockOffsetMs());
  snprintf(json + n, sizeof json - n, "}");

  char topic[64];
  snprintf(topic, sizeof topic, "rally/gates/%s/heartbeat", settings.gateId.c_str());
  // QoS 0: a queued heartbeat flushed on reconnect carries a stale sentAt.
  esp_mqtt_client_publish(client, topic, json, 0, 0, 0);
}

void uplinkTick(IPAddress server) {
  if (server == IPAddress()) return;
  String uri = "mqtt://" + server.toString() + ":" + MQTT_PORT;
  if (!client) {
    esp_mqtt_client_config_t cfg = {};
    cfg.uri = uri.c_str();
    cfg.client_id = settings.gateId.c_str();
    cfg.keepalive = 15;
    client = esp_mqtt_client_init(&cfg);
    esp_mqtt_client_register_event(client, MQTT_EVENT_ANY, onMqttEvent, nullptr);
    esp_mqtt_client_start(client);
    currentUri = uri;
  } else if (uri != currentUri) {
    esp_mqtt_client_stop(client);
    esp_mqtt_client_set_uri(client, uri.c_str());
    esp_mqtt_client_start(client);
    currentUri = uri;
  }

  bool isConnected = connected;
  if (isConnected && !wasConnected) {
    nextHeartbeatMs = 0;
    nextFlushMs = 0;
  }
  if (!isConnected && wasConnected)
    for (auto &s : inFlight) s.msgId = 0;
  wasConnected = isConnected;

  handleAcks();
  if (!isConnected) return;
  if ((int32_t)(millis() - nextHeartbeatMs) >= 0) {
    heartbeat();
    nextHeartbeatMs = millis() + HEARTBEAT_MS;
  }
  if ((int32_t)(millis() - nextFlushMs) >= 0) {
    flush();
    nextFlushMs = millis() + FLUSH_MS;
  }
}
