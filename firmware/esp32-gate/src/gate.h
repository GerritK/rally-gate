#pragma once

#include <Arduino.h>
#include <IPAddress.h>
#include <gate_core.h>

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "unknown"
#endif

const uint16_t MQTT_PORT = 57431;
const uint16_t NTP_PORT = 57432;
const uint16_t GATE_CONFIG_PORT = 57439;

struct Settings {
  String gateId;
  String wifiSsid;
  String wifiPass;
  String hotspotPass;
  String serverHost;  // default rally-server.local, mDNS like a Pi gate
};

struct RecentTap {
  char uid[21];
  int64_t wallUs;  // 0 until the clock is set
};

// main.cpp
extern Settings settings;
extern uint32_t bootId;
extern IPAddress serverIp;
extern bool readerFound;
extern bool hotspotUp;
extern RecentTap recentTaps[5];
void saveSettings(const Settings &s);

// clock.cpp
void clockTick(IPAddress server);
bool clockSet();    // set from rally-server at least once since boot
bool clockFresh();  // and synced within the last few minutes
float clockOffsetMs();
int64_t wallUs();

// uplink.cpp
void uplinkBegin();
void uplinkTick(IPAddress server);
bool uplinkConnected();
bool bufferTap(const gate::Tap &tap);
int bufferedCount();

// web.cpp
void webBegin();
void webTick();
