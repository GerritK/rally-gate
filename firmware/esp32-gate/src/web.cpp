// Status page on 57439, where the dashboard's gate link points (gateConfigUrl),
// plus the captive portal on 80 while the hotspot is up, as on a Pi gate.
#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>

#include "gate.h"
#include "page.h"

static WebServer server(GATE_CONFIG_PORT);
static WebServer portal(80);
static DNSServer dns;
static bool dnsUp = false;

static void restartSoon() {
  delay(300);  // let the response leave first
  ESP.restart();
}

static void appendString(String &json, const char *key, const String &value) {
  char escaped[160];
  gate::jsonEscape(value.c_str(), escaped, sizeof escaped);
  json += "\"";
  json += key;
  json += "\":\"";
  json += escaped;
  json += "\",";
}

static void handleStatus() {
  String json = "{";
  appendString(json, "gateId", settings.gateId);
  appendString(json, "version", FIRMWARE_VERSION);
  appendString(json, "wifiSsid", settings.wifiSsid);
  appendString(json, "wifiIp", WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "");
  appendString(json, "serverHost", settings.serverHost);
  appendString(json, "serverIp", serverIp == IPAddress() ? "" : serverIp.toString());
  json += "\"wifiConnected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false");
  json += ",\"wifiRssi\":" + String(WiFi.RSSI());
  json += ",\"hotspot\":" + String(hotspotUp ? "true" : "false");
  json += ",\"serverConnected\":" + String(uplinkConnected() ? "true" : "false");
  json += ",\"clockSynced\":" + String(clockFresh() ? "true" : "false");
  json += ",\"clockOffsetMs\":" + String(clockOffsetMs(), 3);
  json += ",\"readerFound\":" + String(readerFound ? "true" : "false");
  json += ",\"buffered\":" + String(bufferedCount());
  json += ",\"recent\":[";
  bool first = true;
  for (auto &t : recentTaps) {
    if (!t.uid[0]) continue;
    char iso[25] = "";
    if (t.wallUs) gate::isoTime(t.wallUs, iso);
    json += String(first ? "" : ",") + "{\"uid\":\"" + t.uid + "\",\"time\":\"" + iso + "\"}";
    first = false;
  }
  json += "]}";
  server.send(200, "application/json", json);
}

static void handleSettings() {
  Settings s = settings;
  if (server.hasArg("gateId")) s.gateId = server.arg("gateId");
  if (server.hasArg("serverHost")) s.serverHost = server.arg("serverHost");
  if (server.hasArg("hotspotPass")) s.hotspotPass = server.arg("hotspotPass");
  s.gateId.trim();
  s.serverHost.trim();

  if (!gate::validGateId(s.gateId.c_str()))
    return server.send(400, "text/plain", "Gate name: A-Z, 0-9 and _ only, at most 32");
  if (s.serverHost.isEmpty() || s.serverHost.length() > 63 || s.serverHost.indexOf(' ') >= 0)
    return server.send(400, "text/plain", "Server: a host name or IP address");
  if (s.hotspotPass.length() < 8 || s.hotspotPass.length() > 63)
    return server.send(400, "text/plain", "Hotspot password: 8 to 63 characters");

  saveSettings(s);
  server.send(200, "text/plain", "Saved, restarting");
  restartSoon();
}

static void handleWifi() {
  Settings s = settings;
  s.wifiSsid = server.arg("ssid");
  s.wifiPass = server.arg("pass");
  if (s.wifiSsid.isEmpty() || s.wifiSsid.length() > 32)
    return server.send(400, "text/plain", "Network name: 1 to 32 characters");
  if (!s.wifiPass.isEmpty() && (s.wifiPass.length() < 8 || s.wifiPass.length() > 63))
    return server.send(400, "text/plain", "Password: empty or 8 to 63 characters");
  saveSettings(s);
  server.send(200, "text/plain", "Saved, restarting to join");
  restartSoon();
}

static void handleScan() {
  int n = WiFi.scanNetworks();
  String json = "[";
  for (int i = 0; i < n; i++) {
    char escaped[80];
    gate::jsonEscape(WiFi.SSID(i).c_str(), escaped, sizeof escaped);
    json += String(i ? "," : "") + "{\"ssid\":\"" + escaped + "\",\"rssi\":" + WiFi.RSSI(i) + "}";
  }
  json += "]";
  WiFi.scanDelete();
  server.send(200, "application/json", json);
}

// "Shut down all gates" on the Hardware page. There is no SD card to protect,
// so this only saves the battery: deep sleep with no wake source, until reset
// or power cycle.
static void handlePowerOff() {
  server.send(200, "application/json", "{\"started\":true}");
  delay(300);
  esp_deep_sleep_start();
}

void webBegin() {
  server.on("/", HTTP_GET, [] {
    server.sendHeader("Content-Encoding", "gzip");
    server.send_P(200, "text/html", (const char *)PAGE_GZ, sizeof PAGE_GZ);
  });
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/settings", HTTP_POST, handleSettings);
  server.on("/api/wifi", HTTP_POST, handleWifi);
  server.on("/api/wifi/scan", HTTP_GET, handleScan);
  server.on("/api/power-off", HTTP_POST, handlePowerOff);
  server.onNotFound([] { server.send(404, "text/plain", "Not found"); });
  server.begin();

  portal.onNotFound([] {
    portal.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + ":" + GATE_CONFIG_PORT + "/");
    portal.send(302, "text/plain", "");
  });
  portal.begin();
}

void webTick() {
  if (hotspotUp && !dnsUp) dnsUp = dns.start(53, "*", WiFi.softAPIP());
  if (!hotspotUp && dnsUp) {
    dns.stop();
    dnsUp = false;
  }
  if (dnsUp) dns.processNextRequest();
  server.handleClient();
  portal.handleClient();
}
