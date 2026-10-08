// Regenerates the README screenshots in docs/images/ from a throwaway event.
// Usage: npm run screenshots   (after building shared, rally-server and web)
// Uses Playwright's Chromium (`npx playwright install chromium` once), or an
// installed browser with SCREENSHOT_CHANNEL=msedge / chrome.
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mqtt = require('mqtt');
const { ulid } = require('ulid');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'http://localhost:57430';
const API = `${ORIGIN}/api`;
const OUT = path.join(ROOT, 'docs/images');
// Not the field port 57431: a real gate on this network would heartbeat into
// the throwaway event, auto-register and end up in the README.
const MQTT_PORT = 58431;
const SHOTS = [
  ['/live/WP2', 'live'],
  ['/results/overall', 'results'],
  ['/entries', 'entries'],
  ['/hardware', 'hardware'],
];

const GATES = [
  'START_WP1',
  'SPLIT_WP1',
  'FINISH_WP1',
  'START_WP2',
  'SPLIT_WP2',
  'FINISH_WP2',
];
// startNumber, first, last, flag, body, chassis, class, status, WP1 pace (s)
const ENTRIES = [
  [
    3,
    'Mika',
    'Lahtinen',
    'fi',
    'Toyota GR Yaris Rally1',
    'Kyosho Fazer',
    'Pro',
    'SCRUTINEERED',
    61.2,
  ],
  [
    7,
    'Sophie',
    'Marchand',
    'fr',
    'Citroën C3 WRC',
    'Tamiya TT-02',
    'Pro',
    'SCRUTINEERED',
    62.8,
  ],
  [
    11,
    'Jonas',
    'Becker',
    'de',
    'VW Polo GTI R5',
    'HPI WR8',
    'Pro',
    'SCRUTINEERED',
    63.5,
  ],
  [
    12,
    'Elena',
    'Rossi',
    'it',
    'Lancia Delta Integrale',
    'Tamiya TT-02',
    'Classic',
    'CHECKED_IN',
    68.1,
  ],
  [
    15,
    'Tom',
    'Hughes',
    'gb-wls',
    'Ford Escort Mk2',
    'Tamiya MF-01X',
    'Classic',
    'SCRUTINEERED',
    70.4,
  ],
  [
    21,
    'Lars',
    'Nygaard',
    'no',
    'Subaru Impreza WRC',
    'HPI WR8',
    'Pro',
    'SCRUTINEERED',
    62.1,
  ],
  [
    24,
    'Ana',
    'García',
    'es',
    'Seat Ibiza Kit Car',
    'Tamiya M-05',
    'Junior',
    'CHECKED_IN',
    74.9,
  ],
  [
    31,
    'Pieter',
    'de Vries',
    'nl',
    'Hyundai i20 N Rally1',
    'Kyosho Fazer',
    'Pro',
    'SCRUTINEERED',
    61.7,
  ],
  [
    33,
    'Lukas',
    'Novák',
    'cz',
    'Škoda Fabia RS Rally2',
    'Tamiya TT-02',
    'Junior',
    'REGISTERED',
    77.3,
  ],
  [
    42,
    'Emma',
    'Lindqvist',
    'se',
    'Audi Quattro S1',
    'Tamiya TT-01',
    'Classic',
    'SCRUTINEERED',
    69.0,
  ],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const transponder = (startNumber) => String(1000000 + startNumber);

async function call(method, urlPath, body) {
  const res = await fetch(API + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(
      `${method} ${urlPath}: ${res.status} ${JSON.stringify(json)}`,
    );
  return json;
}

async function serverUp() {
  return fetch(`${API}/stages`).then(
    () => true,
    () => false,
  );
}

async function seed(client, version) {
  const pub = (topic, payload) =>
    new Promise((r) =>
      client.publish(topic, JSON.stringify(payload), { qos: 1 }, r),
    );
  const heartbeats = () =>
    Promise.all(
      GATES.map((g) =>
        pub(`rally/gates/${g}/heartbeat`, {
          capabilities: 'beam',
          sentAt: new Date().toISOString(),
          version,
          chronySynced: true,
          chronyOffsetMs: +(Math.random() * 2).toFixed(1),
        }),
      ),
    );
  // Sequential with a pause: the rule engine needs a start before its finish.
  const detect = async (gateId, startNumber, t) => {
    await pub(`rally/gates/${gateId}/detections`, {
      eventId: ulid(),
      gateId,
      transponderId: transponder(startNumber),
      timestampGate: new Date(t).toISOString(),
      source: 'simulated',
    });
    await sleep(80);
  };

  await call('PUT', '/rally-info', {
    name: 'Gravel Cup Round 3',
    location: 'Steinbruch Hollenberg',
  });
  const classes = {};
  for (const name of ['Pro', 'Classic', 'Junior'])
    classes[name] = (
      await call('POST', '/entry-classes', { name, main: true })
    ).id;

  await heartbeats();
  await sleep(500);
  for (const g of GATES)
    await call('PUT', `/gates/${g}`, { name: g.replace('_', ' ') });

  await call('POST', '/stages', {
    id: 'WP1',
    name: 'Quarry Loop',
    stageNumber: 1,
  });
  await call('POST', '/stages', {
    id: 'WP2',
    name: 'Forest Run',
    stageNumber: 2,
  });
  for (const s of ['WP1', 'WP2']) {
    await call('POST', '/gate-assignments', {
      gateId: `START_${s}`,
      stageId: s,
      role: 'stage_start',
    });
    await call('POST', '/gate-assignments', {
      gateId: `SPLIT_${s}`,
      stageId: s,
      role: 'stage_split',
      splitIndex: 1,
    });
    await call('POST', '/gate-assignments', {
      gateId: `FINISH_${s}`,
      stageId: s,
      role: 'stage_finish',
    });
  }

  for (const [
    startNumber,
    first,
    last,
    flag,
    body,
    chassis,
    cls,
    status,
  ] of ENTRIES)
    await call('POST', '/entries', {
      startNumber,
      driverFirstName: first,
      driverLastName: last,
      driverFlag: flag,
      body,
      chassis,
      transponders: [{ kind: 'RC', identifier: transponder(startNumber) }],
      classIds: [classes[cls]],
      status,
    });

  // WP1: everyone through, then closed.
  const now = Date.now();
  await call('POST', '/stages/WP1/activate');
  for (const [i, e] of ENTRIES.entries()) {
    const start = now - 50 * 60_000 + i * 60_000;
    const dur = e[8] * 1000 + Math.random() * 900;
    await detect('START_WP1', e[0], start);
    await detect(
      'SPLIT_WP1',
      e[0],
      start + dur * (0.44 + Math.random() * 0.02),
    );
    await detect('FINISH_WP1', e[0], start + dur);
  }
  await sleep(500);
  await call('POST', '/stages/WP1/close');

  // WP2: running — most finished, someone on stage, the last two waiting.
  await call('POST', '/stages/WP2/activate');
  for (const [i, e] of ENTRIES.slice(0, 8).entries()) {
    const start = now - 7 * 60_000 + i * 50_000;
    const dur = e[8] * 1.31 * 1000 + Math.random() * 1500;
    await detect('START_WP2', e[0], start);
    if (start + dur * 0.5 < now)
      await detect('SPLIT_WP2', e[0], start + dur * 0.5);
    if (start + dur < now) await detect('FINISH_WP2', e[0], start + dur);
  }
  return heartbeats;
}

function screenshot(route, name) {
  const channel = process.env.SCREENSHOT_CHANNEL;
  execSync(
    [
      'npx --yes playwright screenshot',
      channel ? `--channel=${channel}` : '',
      // English whatever this machine's language: the README is English.
      '--viewport-size=1440,900 --color-scheme=dark --lang=en --wait-for-timeout=2500',
      ORIGIN + route,
      JSON.stringify(path.join(OUT, `${name}.png`)),
    ].join(' '),
    { stdio: 'inherit' },
  );
}

async function main() {
  const serverMain = path.join(ROOT, 'apps/rally-server/dist/main.js');
  for (const built of [serverMain, path.join(ROOT, 'apps/web/dist/index.html')])
    if (!fs.existsSync(built))
      throw new Error(
        `${built} missing — build shared, rally-server and web first`,
      );
  if (await serverUp())
    throw new Error(
      `something is already running on ${ORIGIN} — stop it first`,
    );

  const dbPath = path.join(
    os.tmpdir(),
    `rally-gate-screenshots-${Date.now()}.sqlite`,
  );
  const server = spawn(process.execPath, [serverMain], {
    cwd: path.join(ROOT, 'apps/rally-server'),
    env: {
      ...process.env,
      DB_TYPE: 'sqlite',
      DB_PATH: dbPath,
      MQTT_PORT: String(MQTT_PORT),
      MDNS_DISABLE: '1',
      LOG_LEVEL: 'warn',
    },
    stdio: 'inherit',
  });
  const client = mqtt.connect(`mqtt://localhost:${MQTT_PORT}`, {
    reconnectPeriod: 500,
  });
  try {
    for (let i = 0; !(await serverUp()); i++) {
      if (i > 60) throw new Error('rally-server did not come up');
      await sleep(500);
    }
    await new Promise((r) =>
      client.connected ? r() : client.once('connect', r),
    );
    // Gates report the server's own build, or Hardware flags a version mismatch.
    const { version } = await call('GET', '/version');
    const heartbeats = await seed(client, version);

    fs.mkdirSync(OUT, { recursive: true });
    for (const [route, name] of SHOTS) {
      await heartbeats(); // keeps every gate inside the 30s online window
      screenshot(route, name);
    }
  } finally {
    client.end(true);
    server.kill();
    await sleep(500);
    fs.rmSync(dbPath, { force: true });
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
