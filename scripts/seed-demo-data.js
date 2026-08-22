// Seeds a minimal demo event: two gates (start/finish), one stage, one vehicle.
// Usage: node scripts/seed-demo-data.js [apiBaseUrl]
const API_BASE = process.argv[2] ?? 'http://localhost:57430';

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
    await post('/stages', {
      id: 'WP1',
      name: 'Wilderness Pass 1',
      stageNumber: 1,
      status: 'NOT_STARTED',
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
