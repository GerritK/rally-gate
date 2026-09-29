import { createAdapter } from './adapters/create-adapter';
import { config } from './config';
import { log } from './log';
import { refreshTimeSource } from './time-sync';
import { Uplink } from './uplink';

const adapter = createAdapter();
if (!adapter) {
  // Exit rather than fall back to the simulator: a typo would otherwise run a
  // gate at an event that times nothing real.
  log.error(`unknown ADAPTER "${config.adapter}"`);
  process.exit(1);
}

const uplink = new Uplink();
uplink.onConnect(() => {
  uplink.publishHeartbeat();
  refreshTimeSource();
});
const heartbeatTimer = setInterval(
  () => uplink.publishHeartbeat(),
  config.heartbeatIntervalMs,
);

void adapter.start((transponderId, timestamp) =>
  uplink.publishDetection(transponderId, timestamp),
);

// SIGTERM is what systemd sends on stop/restart; SIGINT is Ctrl+C in dev.
async function shutdown() {
  clearInterval(heartbeatTimer);
  await adapter?.stop();
  uplink.end();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
