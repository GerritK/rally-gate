import { BeamEdge } from './adapters/beam.adapter';

/** Everything gate-agent reads from its environment (gate.env on a Pi). */
export const config = {
  gateId: process.env.GATE_ID ?? 'START_WP1',
  mqttHost: process.env.MQTT_HOST ?? 'localhost',
  mqttPort: process.env.MQTT_PORT ?? '57431',
  heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS ?? 15000),
  adapter: process.env.ADAPTER ?? 'simulated',
  simulated: {
    transponderIds: (process.env.TRANSPONDERS ?? '1234567')
      .split(',')
      .map((t) => t.trim()),
    intervalMs: process.env.SIMULATE_INTERVAL_MS
      ? Number(process.env.SIMULATE_INTERVAL_MS)
      : undefined,
  },
  beam: {
    line: process.env.BEAM_GPIO ?? 'GPIO17',
    edge: (process.env.BEAM_EDGE ?? 'rising') as BeamEdge,
    lockoutMs: Number(process.env.BEAM_LOCKOUT_MS ?? 500),
  },
  openstint: {
    gain: Number(process.env.OPENSTINT_GAIN ?? 20),
  },
};
