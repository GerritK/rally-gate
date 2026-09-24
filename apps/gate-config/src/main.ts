import express from 'express';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  fieldDescriptors,
  GateConfig,
  isFieldName,
  readConfig,
  validate,
  writeConfig,
} from './config-file';
import {
  agentActive,
  applyTimeSource,
  clockTracking,
  recentLog,
  restartAgent,
} from './system';

const PORT = Number(process.env.GATE_CONFIG_PORT ?? 57434);

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
