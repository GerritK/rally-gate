import { FIELDS, readSettings } from '../fields';
import { BeamEdge } from './adapters/beam.adapter';

const { settings, invalid } = readSettings(process.env);

/** Fields of gate.env that break their rule; main.ts refuses to start on any. */
export const invalidSettings = invalid;

/** Everything gate-agent reads from its environment (gate.env on a Pi). */
export const config = {
  gateId: settings.GATE_ID!,
  mqttHost: settings.MQTT_HOST!,
  mqttPort: settings.MQTT_PORT!,
  heartbeatIntervalMs: Number(settings.HEARTBEAT_INTERVAL_MS),
  adapter: settings.ADAPTER as (typeof FIELDS.ADAPTER.oneOf)[number],
  simulated: {
    transponderIds: settings.TRANSPONDERS!.split(','),
    intervalMs: settings.SIMULATE_INTERVAL_MS
      ? Number(settings.SIMULATE_INTERVAL_MS)
      : undefined,
  },
  beam: {
    line: `GPIO${settings.BEAM_GPIO}`,
    edge: settings.BEAM_EDGE as BeamEdge,
    lockoutMs: Number(settings.BEAM_LOCKOUT_MS),
  },
  buzzerLine: settings.BUZZER_GPIO ? `GPIO${settings.BUZZER_GPIO}` : undefined,
  buzzerStatus: settings.BUZZER_STATUS !== 'off',
  openstint: {
    gain: Number(settings.OPENSTINT_GAIN),
  },
  pairWindowMs: Number(settings.PAIR_WINDOW_MS),
  forwardBeamOnly: settings.FORWARD_BEAM_ONLY === 'on',
};
