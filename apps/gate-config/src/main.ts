import express from 'express';
import { existsSync } from 'fs';
import { createServer } from 'http';
import { join } from 'path';
import {
  fieldDescriptors,
  GateConfig,
  isFieldName,
  readConfig,
  validate,
  writeConfig,
} from './config-file';
import { parseDeviceStatus, parseWifiList, validateWifi } from './network';
import {
  agentActive,
  applyTimeSource,
  clockTracking,
  networkStatus,
  recentLog,
  restartAgent,
  startHotspot,
  wifiJoin,
  wifiScan,
} from './system';

const PORT = Number(process.env.GATE_CONFIG_PORT ?? 57439);

const app = express();
app.use(express.json({ limit: '16kb' }));

// Field specs travel to the browser so labels, hints, messages and rules have
// exactly one definition; the page rebuilds input rules from them rather than
// restating the grammar in Vue, where the two would drift. `validate` is still
// the boundary and runs on every save regardless.
app.get('/api/fields', (_req, res) => {
  res.json(fieldDescriptors());
});

app.get('/api/config', (_req, res) => {
  res.json(readConfig());
});

app.put('/api/config', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const errors = validate(body);
  if (Object.keys(errors).length > 0) {
    res.status(400).json({ errors });
    return;
  }

  const config: GateConfig = {};
  for (const [key, value] of Object.entries(body)) {
    if (isFieldName(key) && typeof value === 'string' && value !== '') {
      config[key] = value;
    }
  }

  try {
    writeConfig(config);
  } catch (err) {
    res
      .status(500)
      .json({ message: `Could not save: ${(err as Error).message}` });
    return;
  }

  // Reported, not thrown: the configuration is already saved at this point, so
  // a failed restart must not read as a failed save — the marshal needs to know
  // the value is stored and only the apply step needs retrying.
  const time = config.MQTT_HOST
    ? await applyTimeSource(config.MQTT_HOST)
    : { ok: true, output: 'unchanged' };
  const restart = await restartAgent();

  res.json({ saved: true, restart, time });
});

app.get('/api/status', async (_req, res) => {
  const [agent, clock, log] = await Promise.all([
    agentActive(),
    clockTracking(),
    recentLog(),
  ]);
  res.json({ agent, clock, log });
});

/**
 * Current Wi-Fi state plus what is in range.
 *
 * `available: false` is a real answer, not an error: NetworkManager is absent
 * on a developer machine and on a gate wired by Ethernet, and the page says so
 * for that panel rather than failing — the same per-probe degradation the
 * status endpoint above uses.
 */
app.get('/api/network', async (_req, res) => {
  const [devices, scan] = await Promise.all([networkStatus(), wifiScan()]);
  res.json({
    available: devices.ok,
    wifi: devices.ok
      ? (parseDeviceStatus(devices.output).find((d) => d.type === 'wifi') ??
        null)
      : null,
    networks: scan.ok ? parseWifiList(scan.output) : [],
  });
});

/**
 * Joining drops the hotspot first, so when the marshal is reading this page
 * *over* that hotspot the response can never reach them — that is expected and
 * the page says so, rather than being treated as a failed join. A wrong
 * password leaves the gate on no network at all; the watchdog timer raises the
 * hotspot again within a minute, which is the recovery path by design.
 */
app.post('/api/network', async (req, res) => {
  const body = (req.body ?? {}) as { ssid?: unknown; password?: unknown };
  const errors = validateWifi(body);
  if (Object.keys(errors).length > 0) {
    res.status(400).json({ errors });
    return;
  }
  const result = await wifiJoin(
    String(body.ssid),
    typeof body.password === 'string' ? body.password : '',
  );
  res.json({ joined: result.ok, output: result.output });
});

/** Raising the hotspot by hand — the only way to check it from the page, since
 *  the watchdog only fires when the gate has no network at all. */
app.post('/api/network/hotspot', async (_req, res) => {
  const result = await startHotspot();
  res.json({ started: result.ok, output: result.output });
});

// Serves the built Vue app when it exists. Absent in the dev loop, where Vite
// serves it instead and proxies /api here — same arrangement as rally-server
// and apps/web (see the static-serving note in CLAUDE.md).
const webDist = join(__dirname, '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/.*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`[gate-config] listening on ${PORT}`);
  if (!existsSync(webDist)) {
    console.log('[gate-config] no built UI at web/dist — API only');
  }
});

// Captive portal: on the hotspot every DNS name resolves to the gate (see
// install-gate-pi.sh), so a phone's connectivity probe lands here and the OS
// pops this page open by itself. Unset in the dev loop; the unit sets it to 80.
const CAPTIVE_PORT = process.env.CAPTIVE_PORT;
if (CAPTIVE_PORT) {
  createServer((req, res) => {
    // The address the phone reached us on, not a name: mDNS is not guaranteed
    // inside a captive-portal mini-browser.
    const host = (req.socket.localAddress ?? '').replace(/^::ffff:/, '');
    res.writeHead(302, { Location: `http://${host}:${PORT}/` }).end();
  })
    .on('error', (err) =>
      console.error(`[gate-config] captive redirect off: ${err.message}`),
    )
    .listen(Number(CAPTIVE_PORT));
}
