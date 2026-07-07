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

async function main() {
  console.log(await put('/stages/WP1', { name: 'Wilderness Pass 1', stageNumber: 1, status: 'READY' }));
  console.log(await put('/gates/START_WP1', { name: 'Start WP1', role: 'stage_start', stageId: 'WP1', enabled: true }));
  console.log(await put('/gates/SPLIT1_WP1', { name: 'Split 1 WP1', role: 'stage_split', stageId: 'WP1', splitIndex: 1, enabled: true }));
  console.log(await put('/gates/FINISH_WP1', { name: 'Finish WP1', role: 'stage_finish', stageId: 'WP1', enabled: true }));
  console.log(await post('/vehicles', { startNumber: '12', driverName: 'Demo Driver', transponderId: '1234567' }));
  console.log('Demo data seeded. Trigger a run with:');
  console.log('  npm run simulate -- --gate START_WP1 --transponder 1234567');
  console.log('  npm run simulate -- --gate SPLIT1_WP1 --transponder 1234567');
  console.log('  npm run simulate -- --gate FINISH_WP1 --transponder 1234567');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
