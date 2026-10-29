import { createAdapter } from './adapters/create-adapter';
import { Buzzer } from './buzzer';
import { config } from './config';
import { EXIT_DECODER_FAILED } from './exit-codes';
import { log } from './log';
import { ClockState, StatusSignals } from './status-signals';
import { readChrony, refreshTimeSource } from './time-sync';
import { Uplink } from './uplink';

const adapter = createAdapter();
if (!adapter) {
  // Exit rather than fall back to the simulator: a typo would otherwise run a
  // gate at an event that times nothing real.
  log.error(`unknown ADAPTER "${config.adapter}"`);
  process.exit(1);
}

const buzzer = config.buzzerLine
  ? new Buzzer(config.buzzerLine, config.buzzerStatus)
  : undefined;
void buzzer?.play('powerOn');
// The sound for a decoder that can't run, played as the process leaves: only
// synchronous work runs in `exit`, hence playSync.
process.on('exit', (code) => {
  if (code === EXIT_DECODER_FAILED) {
    buzzer?.playSync('decoderFailed');
  }
});

const state = {
  connected: false,
  decoderRunning: false,
  clock: 'pending' as ClockState,
};

const uplink = new Uplink();
const sendHeartbeat = () =>
  void readChrony().then((sync) => {
    // No reading is not a warning: the dashboard shows it as unknown too.
    state.clock = sync?.ntpSynced === false ? 'bad' : 'ok';
    uplink.publishHeartbeat(sync);
  });
uplink.onConnect(() => {
  state.connected = true;
  sendHeartbeat();
  refreshTimeSource();
});
uplink.onDisconnect(() => (state.connected = false));
const heartbeatTimer = setInterval(sendHeartbeat, config.heartbeatIntervalMs);

const statusSignals = new StatusSignals();
const statusTimer = setInterval(() => {
  const signal = statusSignals.next(Date.now(), state);
  if (signal) {
    void buzzer?.play(signal);
  }
}, 1000);

void Promise.resolve(
  adapter.start(
    (transponderId, timestamp, metadata) =>
      uplink.publishDetection(transponderId, timestamp, metadata),
    () => buzzer?.beep(),
  ),
).then(() => (state.decoderRunning = true));

// SIGTERM is what systemd sends on stop/restart; SIGINT is Ctrl+C in dev.
async function shutdown() {
  clearInterval(heartbeatTimer);
  clearInterval(statusTimer);
  await adapter?.stop();
  uplink.end();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
