import { EventEmitter2 } from '@nestjs/event-emitter';
import { connectAsync, MqttClient } from 'mqtt';
import { AddressInfo } from 'net';
import { GatePairingService } from '../gates/gate-pairing.service';
import { BrokerService } from './broker.service';

describe('BrokerService acknowledgement', () => {
  let broker: BrokerService;
  let gate: MqttClient | null = null;

  afterEach(async () => {
    await gate?.endAsync(true);
    broker.onModuleDestroy();
  });

  it('withholds the PUBACK until the detection is stored, so the gate sends it again', async () => {
    // The database was unreachable for the first delivery (Postgres restarting).
    const store = jest
      .fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValue(undefined);
    const events = new EventEmitter2();
    events.on('mqtt.message', store);
    process.env.MQTT_PORT = '0';
    broker = new BrokerService(events, {
      allowsAnonymous: true,
    } as unknown as GatePairingService);
    await broker.onModuleInit();
    const { port } = (
      broker as unknown as { server: { address(): AddressInfo } }
    ).server.address();

    // A gate-agent's session: persistent, so a dropped connection resends.
    gate = await connectAsync(`mqtt://127.0.0.1:${port}`, {
      clientId: 'G1',
      clean: false,
      reconnectPeriod: 100,
    });
    await gate.publishAsync('rally/gates/G1/detections', 'e1', { qos: 1 });

    // publishAsync resolves on the PUBACK, which only the second delivery got.
    expect(store).toHaveBeenCalledTimes(2);
    expect(
      (store.mock.calls[1] as [{ payload: Buffer }])[0].payload.toString(),
    ).toBe('e1');
  });
});
