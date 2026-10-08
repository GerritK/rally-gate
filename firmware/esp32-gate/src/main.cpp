// ESP32 NFC check-in gate. Design, wiring and why: docs/esp32-gate.md.
#include <Adafruit_PN532.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <SPI.h>
#include <WiFi.h>
#include <esp_mac.h>
#include <esp_random.h>
#include <esp_timer.h>

#include "gate.h"

// XIAO ESP32-S3. SPI is the board's default SCK/MISO/MOSI (D8/D9/D10).
static const int PIN_PN532_SS = D3;
static const int PIN_BUZZER = D1;
static const int PIN_LED = D2;

static const uint32_t SAME_TAG_MS = 3000;    // a tag held on the reader reads continuously
static const uint32_t HOTSPOT_AFTER_MS = 60000;  // as the Pi's hotspot watchdog
static const uint32_t RESOLVE_EVERY_MS = 30000;
static const uint32_t READER_RETRY_MS = 10000;

Settings settings;
uint32_t bootId = 0;
IPAddress serverIp;
bool readerFound = false;
bool hotspotUp = false;
RecentTap recentTaps[5];

static Adafruit_PN532 nfc(PIN_PN532_SS);
static Preferences prefs;
static char lastUid[21] = "";
static uint32_t lastUidMs = 0;
static uint32_t wifiDownSinceMs = 0;
static uint32_t nextResolveMs = 0;
static uint32_t nextReaderTryMs = 0;

static String hostname() {
  String h = settings.gateId;
  h.toLowerCase();
  h.replace('_', '-');
  return h;
}

static void loadSettings() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char defaultId[16];
  snprintf(defaultId, sizeof defaultId, "ESP32_%02X%02X%02X", mac[3], mac[4], mac[5]);

  settings.gateId = prefs.getString("gateId", defaultId);
  settings.wifiSsid = prefs.getString("wifiSsid", "");
  settings.wifiPass = prefs.getString("wifiPass", "");
  // Predictable on purpose, as on the Pi: it goes on a sticker on the box.
  settings.hotspotPass = prefs.getString("hotspotPass", "rally-gate");
  settings.serverHost = prefs.getString("serverHost", "rally-server.local");
}

void saveSettings(const Settings &s) {
  prefs.putString("gateId", s.gateId);
  prefs.putString("wifiSsid", s.wifiSsid);
  prefs.putString("wifiPass", s.wifiPass);
  prefs.putString("hotspotPass", s.hotspotPass);
  prefs.putString("serverHost", s.serverHost);
}

static void beep(int times, int ms) {
  for (int i = 0; i < times; i++) {
    digitalWrite(PIN_BUZZER, HIGH);
    delay(ms);
    digitalWrite(PIN_BUZZER, LOW);
    if (i + 1 < times) delay(ms);
  }
}

static bool startReader() {
  nfc.begin();
  if (!nfc.getFirmwareVersion()) return false;
  nfc.SAMConfig();
  return true;
}

static void startHotspot() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(("rally-gate-" + hostname()).c_str(), settings.hotspotPass.c_str());
  hotspotUp = true;
  Serial.printf("[wifi] hotspot up at %s\n", WiFi.softAPIP().toString().c_str());
}

static void wifiTick() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiDownSinceMs = millis();
    if (hotspotUp) {
      WiFi.softAPdisconnect(true);
      WiFi.mode(WIFI_STA);
      hotspotUp = false;
    }
    return;
  }
  if (!hotspotUp && (settings.wifiSsid.isEmpty() || millis() - wifiDownSinceMs > HOTSPOT_AFTER_MS))
    startHotspot();
}

static IPAddress resolveServer() {
  IPAddress ip;
  const String &host = settings.serverHost;
  if (ip.fromString(host)) return ip;
  if (host.endsWith(".local")) return MDNS.queryHost(host.substring(0, host.length() - 6), 2000);
  if (WiFi.hostByName(host.c_str(), ip)) return ip;
  return IPAddress();
}

static void serverTick() {
  if (WiFi.status() != WL_CONNECTED) return;
  bool due = serverIp == IPAddress() || !uplinkConnected();
  if (!due || (int32_t)(millis() - nextResolveMs) < 0) return;
  nextResolveMs = millis() + RESOLVE_EVERY_MS;
  IPAddress ip = resolveServer();
  if (ip != IPAddress() && ip != serverIp) {
    serverIp = ip;
    Serial.printf("[server] %s is %s\n", settings.serverHost.c_str(), ip.toString().c_str());
  }
}

static void readerTick() {
  if (!readerFound) {
    if ((int32_t)(millis() - nextReaderTryMs) < 0) return;
    nextReaderTryMs = millis() + READER_RETRY_MS;
    readerFound = startReader();
    if (!readerFound) Serial.println("[nfc] PN532 not found");
    return;
  }

  uint8_t uid[10];
  uint8_t len = 0;
  if (!nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &len, 50) || len == 0 || len > 10) return;

  // Both clocks first, before anything slow.
  int64_t mono = esp_timer_get_time();
  int64_t wall = clockSet() ? wallUs() : 0;

  char hex[21];
  gate::uidHex(uid, len, hex);
  if (strcmp(hex, lastUid) == 0 && millis() - lastUidMs < SAME_TAG_MS) {
    lastUidMs = millis();
    return;
  }
  strlcpy(lastUid, hex, sizeof lastUid);
  lastUidMs = millis();

  gate::Tap tap = {};
  tap.magic = gate::TAP_MAGIC;
  strlcpy(tap.gateId, settings.gateId.c_str(), sizeof tap.gateId);
  uint8_t rnd[16];
  esp_fill_random(rnd, sizeof rnd);
  gate::uuidV4(rnd, tap.eventId);
  strlcpy(tap.uid, hex, sizeof tap.uid);
  tap.wallUs = wall;
  tap.bootId = bootId;
  tap.monoUs = mono;

  // The beep promises the tap counted, so it comes only once the tap is in flash.
  if (!bufferTap(tap)) {
    Serial.printf("[nfc] %s NOT stored\n", hex);
    beep(3, 80);
    return;
  }
  Serial.printf("[nfc] %s\n", hex);
  memmove(&recentTaps[1], &recentTaps[0], sizeof recentTaps - sizeof recentTaps[0]);
  strlcpy(recentTaps[0].uid, hex, sizeof recentTaps[0].uid);
  recentTaps[0].wallUs = wall;
  beep(1, 120);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED, OUTPUT);

  prefs.begin("gate");
  bootId = prefs.getUInt("bootId", 0) + 1;
  prefs.putUInt("bootId", bootId);
  loadSettings();
  Serial.printf("[gate] %s %s boot %lu\n", settings.gateId.c_str(), FIRMWARE_VERSION, (unsigned long)bootId);

  if (!LittleFS.begin(true)) Serial.println("[gate] LittleFS failed, taps can't be stored");
  uplinkBegin();

  WiFi.mode(WIFI_STA);
  WiFi.setHostname(hostname().c_str());
  // Power save off: it holds packets for the next beacon, which is latency
  // jitter on every NTP sample.
  WiFi.setSleep(false);
  if (!settings.wifiSsid.isEmpty()) WiFi.begin(settings.wifiSsid.c_str(), settings.wifiPass.c_str());
  wifiDownSinceMs = millis();
  MDNS.begin(hostname().c_str());

  SPI.begin();
  readerTick();
  webBegin();
}

void loop() {
  webTick();
  wifiTick();
  serverTick();
  if (WiFi.status() == WL_CONNECTED) {
    clockTick(serverIp);
    uplinkTick(serverIp);
  }
  readerTick();
  digitalWrite(PIN_LED, uplinkConnected() ? HIGH : LOW);
}
