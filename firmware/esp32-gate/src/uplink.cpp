// Detections go to flash first and leave it only on PUBACK. esp-mqtt's outbox
// is RAM, so it alone would lose every unacked detection on a power cut, and
// a dropped detection is a driver with no time. Resending is safe: the server keys
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
static esp_mqtt_client_config_t mqttCfg = {};
static char password[86];
static volatile bool sendKey = false;
static volatile int refusedCode = 0;  // CONNACK code of the last refused login
static int loggedRefusal = 0;
static String currentUri;
static volatile bool connected = false;
static bool wasConnected = false;
static QueueHandle_t acks;
static InFlight inFlight[MAX_IN_FLIGHT];
static uint32_t nextHeartbeatMs = 0;
static uint32_t nextFlushMs = 0;
static uint32_t detectionSeq = 0;
static int buffered = 0;

// Runs on esp-mqtt's own task, so it only hands over; loop() does the work.
// The password is the exception: it has to be set before this CONNECT goes out.
static void onMqttEvent(void *, esp_event_base_t, int32_t id, void *data) {
  auto *event = (esp_mqtt_event_handle_t)data;
  if (id == MQTT_EVENT_BEFORE_CONNECT) {
    // A token is valid for a minute and only once: a fresh one every attempt.
    gate::gatePassword(gateKey, settings.gateId.c_str(), wallUs() / 1000 + 60000, sendKey, password);
    mqttCfg.password = password;
    esp_mqtt_set_config(event->client, &mqttCfg);
  }
  if (id == MQTT_EVENT_ERROR && event->error_handle->error_type == MQTT_ERROR_TYPE_CONNECTION_REFUSED) {
    refusedCode = event->error_handle->connect_return_code;
    // 4: pairing is open and the server doesn't know this key yet.
    sendKey = refusedCode == MQTT_CONNECTION_REFUSE_BAD_USERNAME;
  }
  if (id == MQTT_EVENT_CONNECTED) {
    connected = true;
    sendKey = false;
    refusedCode = 0;
  }
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

bool bufferDetection(const gate::Detection &d) {
  if (LittleFS.totalBytes() - LittleFS.usedBytes() < MIN_FREE_BYTES) return false;
  char path[24];
  snprintf(path, sizeof path, "/q/%08lx%06lx", (unsigned long)bootId, (unsigned long)detectionSeq++);
  File f = LittleFS.open(path, "w");
  if (!f) return false;
  bool ok = f.write((const uint8_t *)&d, sizeof d) == sizeof d;
  f.close();
  if (!ok) {
    LittleFS.remove(path);
    return false;
  }
  buffered++;
  return true;
}

int clearBuffered() {
  int n = 0;
  for (;;) {
    // Reopened each round: removing entries while a directory is being read skips some.
    File dir = LittleFS.open("/q");
    File f = dir.openNextFile();
    if (!f) break;
    String path = f.path();
    f.close();
    dir.close();
    if (!LittleFS.remove(path)) break;
    n++;
  }
  for (auto &s : inFlight) s.msgId = 0;
  buffered = countBuffered();
  Serial.printf("[uplink] cleared %d waiting detections\n", n);
  return n;
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

    gate::Detection d = {};
    size_t n = f.read((uint8_t *)&d, sizeof d);
    f.close();
    gate::Buffered verdict = gate::checkBuffered(d, n, settings.gateId.c_str());
    if (verdict != gate::Buffered::Send) {
      // Either can never be accepted and would count as waiting forever.
      if (verdict == gate::Buffered::Unreadable) Serial.printf("[uplink] deleted unreadable %s\n", path.c_str());
      else Serial.printf("[uplink] deleted %s, recorded under Gate ID %.32s\n", path.c_str(), d.gateId);
      if (LittleFS.remove(path)) buffered--;
      continue;
    }

    int64_t timeUs;
    gate::DetectionTime t = gate::resolveDetectionTime(d, bootId, clockSet(), wallUs(), esp_timer_get_time(), &timeUs);
    if (t == gate::DetectionTime::NotYetSyncedWait) continue;
    if (t == gate::DetectionTime::Known && d.wallUs == 0) {
      // Pin the recovered time now: after a reboot the monotonic reference is gone.
      d.wallUs = timeUs;
      File w = LittleFS.open(path, "w");
      if (w) {
        w.write((const uint8_t *)&d, sizeof d);
        w.close();
      }
    }

    char json[320];
    gate::detectionJson(d, timeUs, t == gate::DetectionTime::Unknown, json, sizeof json);
    char topic[64];
    snprintf(topic, sizeof topic, "rally/gates/%s/detections", d.gateId);
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
  n += snprintf(json + n, sizeof json - n, ",\"ntpSynced\":%s", clockFresh() ? "true" : "false");
  if (clockFresh()) n += snprintf(json + n, sizeof json - n, ",\"ntpOffsetMs\":%.3f", clockOffsetMs());
  snprintf(json + n, sizeof json - n, "}");

  char topic[64];
  snprintf(topic, sizeof topic, "rally/gates/%s/heartbeat", settings.gateId.c_str());
  // QoS 0: a queued heartbeat flushed on reconnect carries a stale sentAt.
  esp_mqtt_client_publish(client, topic, json, 0, 0, 0);
}

static void logRefusal() {
  int code = refusedCode;
  if (code == loggedRefusal) return;
  loggedRefusal = code;
  if (code == MQTT_CONNECTION_REFUSE_BAD_USERNAME)
    Serial.println("[uplink] pairing is open on the server, sending this gate's key");
  else if (code)
    Serial.printf("[uplink] server refused this gate (%d): waiting for the organiser to approve it under Hardware -> Pair gates\n", code);
}

void uplinkTick(IPAddress server) {
  // The login token carries an expiry in server time, so not before the first sync.
  if (server == IPAddress() || !clockSet()) return;
  String uri = "mqtt://" + server.toString() + ":" + MQTT_PORT;
  if (!client) {
    mqttCfg.uri = uri.c_str();
    mqttCfg.client_id = settings.gateId.c_str();
    mqttCfg.username = settings.gateId.c_str();
    mqttCfg.keepalive = 15;
    client = esp_mqtt_client_init(&mqttCfg);
    // Kept for the per-attempt password, without re-parsing the URI each time.
    mqttCfg.uri = nullptr;
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

  logRefusal();
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
