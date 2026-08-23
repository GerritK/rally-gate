// Seeds a minimal demo event: two gates (start/finish), one stage, one vehicle.
// Usage: node scripts/seed-demo-data.js [apiBaseUrl]
// All API routes live under /api — rally-server serves the dashboard from the
// same port, so the prefix is what keeps `/vehicles` the page and
// `/api/vehicles` the resource. Pass a bare origin and the prefix is added.
const argBase = process.argv[2] ?? 'http://localhost:57430';
const API_BASE = argBase.endsWith('/api') ? argBase : `${argBase}/api`;

async function put(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function assign(gateId, stageId, role, splitIndex) {
  console.log(await put(`/gates/${gateId}`, { name: gateId }));
  console.log(
    await post('/gate-assignments', { gateId, stageId, role, splitIndex }),
  );
}

async function main() {
  console.log(
    // No `status` — it's server-owned and starts NOT_STARTED; the API
    // rejects unknown properties. Activation happens via /stages/WP1/activate.
    await post('/stages', {
      id: 'WP1',
      name: 'Wilderness Pass 1',
      stageNumber: 1,
    }),
  );
  await assign('START_WP1', 'WP1', 'stage_start');
  await assign('SPLIT1_WP1', 'WP1', 'stage_split', 1);
  await assign('FINISH_WP1', 'WP1', 'stage_finish');
  console.log(await post('/stages/WP1/activate'));
  console.log(
    await post('/vehicles', {
      startNumber: '12',
      driverName: 'Demo Driver',
      transponderId: '1234567',
    }),
  );
  console.log('Demo data seeded. Trigger a run with:');
  console.log('  npm run simulate -- --gate START_WP1 --transponder 1234567');
  console.log('  npm run simulate -- --gate SPLIT1_WP1 --transponder 1234567');
  console.log('  npm run simulate -- --gate FINISH_WP1 --transponder 1234567');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
