// ESP32 NFC check-in gate. Design, wiring and why: docs/esp32-gate.md.
#include <Adafruit_PN532.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <SPI.h>
#include <WiFi.h>
#include <driver/gpio.h>
#include <esp_mac.h>
#include <esp_sleep.h>
#include <esp_random.h>
#include <esp_timer.h>
#include <mdns.h>

#include "gate.h"

// XIAO ESP32-S3. SPI is the board's default SCK/MISO/MOSI (D8/D9/D10).
static const int PIN_PN532_SS = D3;
static const int PIN_BUZZER = D1;
static const int PIN_LED = D2;

static const uint32_t SAME_TAG_MS = 3000;    // a tag held on the reader reads continuously
static const uint32_t HOTSPOT_AFTER_MS = 60000;  // as the Pi's hotspot watchdog
static const uint32_t RESOLVE_EVERY_MS = 30000;
static const uint32_t READER_RETRY_MS = 10000;
static const uint32_t READER_CHECK_MS = 5000;

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
static uint32_t nextReaderCheckMs = 0;

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

// Deep sleep with no wake source, until reset or power cycle. The PN532 stays
// on the 3V3 rail, so it is sent to its own power-down first; the next boot's
// nfc.begin() wakes it by pulling chip select low.
void powerOff() {
  if (readerFound) {
    uint8_t cmd[] = {PN532_COMMAND_POWERDOWN, 0x20};  // wake source: SPI
    if (nfc.sendCommandCheckAck(cmd, sizeof cmd)) {
      // The PN532 powers down only once its reply has been read, and the
      // library keeps that read private. Same bus settings as the library.
      Adafruit_SPIDevice spi(PIN_PN532_SS, 1000000, SPI_BITORDER_LSBFIRST, SPI_MODE0);
      spi.begin();
      uint8_t op = PN532_SPI_STATREAD, status = 0;
      for (int i = 0; i < 20 && status != PN532_SPI_READY; i++) {
        spi.write_then_read(&op, 1, &status, 1);
        delay(5);
      }
      uint8_t reply[10];  // 00 00 FF 03 FD D5 17 status DCS 00
      op = PN532_SPI_DATAREAD;
      spi.write_then_read(&op, 1, reply, sizeof reply);
    }
  }
  // A floating chip select in deep sleep looks like SPI traffic and wakes the
  // reader again.
  digitalWrite(PIN_PN532_SS, HIGH);
  gpio_hold_en((gpio_num_t)PIN_PN532_SS);
  gpio_deep_sleep_hold_en();
  esp_deep_sleep_start();
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

static void setServerIp(IPAddress ip) {
  if (ip == IPAddress() || ip == serverIp) return;
  serverIp = ip;
  Serial.printf("[server] %s is %s\n", settings.serverHost.c_str(), ip.toString().c_str());
}

// MDNS.queryHost waits up to 2s for an answer, and so does the loop reading
// tags, every 30s for as long as the server is missing. The async query is
// polled instead.
static mdns_search_once_t *mdnsSearch = nullptr;

static void mdnsTick() {
  mdns_result_t *results = nullptr;
  if (!mdns_query_async_get_results(mdnsSearch, 0, &results)) return;
  IPAddress found;
  for (mdns_result_t *r = results; r; r = r->next)
    for (mdns_ip_addr_t *a = r->addr; a && found == IPAddress(); a = a->next)
      if (a->addr.type == ESP_IPADDR_TYPE_V4) found = IPAddress(a->addr.u_addr.ip4.addr);
  setServerIp(found);
  mdns_query_results_free(results);
  mdns_query_async_delete(mdnsSearch);
  mdnsSearch = nullptr;
}

static void serverTick() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (mdnsSearch) return mdnsTick();
  bool due = serverIp == IPAddress() || !uplinkConnected();
  if (!due || (int32_t)(millis() - nextResolveMs) < 0) return;
  nextResolveMs = millis() + RESOLVE_EVERY_MS;

  IPAddress ip;
  const String &host = settings.serverHost;
  if (ip.fromString(host)) return setServerIp(ip);
  if (host.endsWith(".local")) {
    mdnsSearch = mdns_query_async_new(host.substring(0, host.length() - 6).c_str(), nullptr, nullptr,
                                      MDNS_TYPE_A, 2000, 1, nullptr);
    return;
  }
  // ponytail: a plain DNS name still blocks while lwIP waits for its DNS
  // server; rally setups use .local or an IP. dns_gethostbyname's callback if
  // a DNS-named server becomes common.
  if (WiFi.hostByName(host.c_str(), ip)) setServerIp(ip);
}

static void readerTick() {
  if (!readerFound) {
    if ((int32_t)(millis() - nextReaderTryMs) < 0) return;
    nextReaderTryMs = millis() + READER_RETRY_MS;
    readerFound = startReader();
    if (!readerFound) Serial.println("[nfc] PN532 not found");
    return;
  }

  // A failed read looks the same as no tag, so a reader that dropped off the
  // bus would otherwise go unnoticed with readerFound still true.
  if ((int32_t)(millis() - nextReaderCheckMs) >= 0) {
    nextReaderCheckMs = millis() + READER_CHECK_MS;
    if (!nfc.getFirmwareVersion()) {
      Serial.println("[nfc] PN532 stopped answering");
      readerFound = false;
      nextReaderTryMs = millis();
      return;
    }
  }

  uint8_t uid[10];
  uint8_t len = 0;
  if (!nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &len, 50) || len == 0 || len > 10) return;
  // ISO 14443-3 random ID: phones (HCE) send a new one per tap, so it identifies nothing.
  if (len == 4 && uid[0] == 0x08) return;

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
  // The default joins the first access point with this SSID it hears; on a
  // mesh that can be a far one at -80 dBm while another sits at -35.
  WiFi.setScanMethod(WIFI_ALL_CHANNEL_SCAN);
  WiFi.setSortMethod(WIFI_CONNECT_AP_BY_SIGNAL);
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
