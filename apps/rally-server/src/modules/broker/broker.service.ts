import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createServer, Server, Socket } from 'net';
import { Aedes, type AuthenticateError, type Client } from 'aedes';
import { DETECTION_TOPIC_PREFIX } from '@rally-gate/shared';
import { portClashHint } from '../../port-owner';
import { GateLogin, GatePairingService } from '../gates/gate-pairing.service';

function remoteAddress(client: Client): string | null {
  return (client.conn as Socket).remoteAddress?.replace(/^::ffff:/, '') ?? null;
}

@Injectable()
export class BrokerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrokerService.name);
  private aedes: Aedes;
  private server: Server;

  constructor(
    private readonly events: EventEmitter2,
    private readonly pairing: GatePairingService,
  ) {}

  async onModuleInit() {
    const port = Number(process.env.MQTT_PORT ?? 57431);
    // Gates logged in with a key; under GATES_AUTO_ACCEPT the rest are dev
    // tools (simulate, screenshots) publishing for any gate.
    const gates = new WeakSet<Client>();
    this.aedes = await Aedes.createBroker({
      authenticate: (client, username, password, done) => {
        if (!username && this.pairing.allowsAnonymous) {
          return done(null, true);
        }
        const result =
          username && client.id === username
            ? this.pairing.login(
                username,
                password?.toString() ?? '',
                remoteAddress(client),
              )
            : GateLogin.REFUSED;
        if (result === GateLogin.ACCEPTED) {
          gates.add(client);
          return done(null, true);
        }
        const error = new Error(result) as AuthenticateError;
        error.returnCode = result === GateLogin.SEND_KEY ? 4 : 5;
        done(error, false);
      },
      // A gate speaks for itself only, and listens to nothing.
      authorizePublish: (client, packet, callback) => {
        // client is null for internally-originated packets.
        if (!client) {
          return callback(null);
        }
        if (
          gates.has(client) &&
          !packet.topic.startsWith(`${DETECTION_TOPIC_PREFIX}/${client.id}/`)
        ) {
          return callback(
            new Error(`${client.id} may not publish to ${packet.topic}`),
          );
        }
        // Handled here rather than on 'publish' because Aedes PUBACKs a QoS 1
        // packet only after this calls back: a detection the database didn't
        // take errors, Aedes drops the connection unacknowledged, and the
        // gate keeps the detection and publishes it again on reconnect.
        this.events
          .emitAsync('mqtt.message', {
            topic: packet.topic,
            payload: packet.payload,
            address: remoteAddress(client),
          })
          .then(
            () => callback(null),
            (err: Error) => {
              this.logger.warn(
                `Not acknowledging ${packet.topic} from ${client.id}, the gate will send it again: ${err.message}`,
              );
              callback(err);
            },
          );
      },
      authorizeSubscribe: (client, subscription, callback) =>
        callback(null, gates.has(client) ? null : subscription),
    });
    this.server = createServer(this.aedes.handle);

    // Awaited, so a bind failure rejects out of onModuleInit and Nest aborts
    // startup. Without a listener on 'error', node rethrows it *after* Nest
    // has logged "successfully started", so a port clash — a marshal opening
    // a second copy of the packaged exe — reads as a random stack trace from
    // a healthy-looking server.
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, () => {
        this.logger.log(`Embedded MQTT broker listening on port ${port}`);
        resolve();
      });
    }).catch(async (err: NodeJS.ErrnoException) => {
      const hint = await portClashHint(port, 'tcp', err);
      this.logger.error(
        `Embedded MQTT broker cannot listen on port ${port}: ${err.message}${hint}. Gates cannot deliver detections, so startup is aborted rather than continuing without timing.`,
      );
      throw err;
    });

    // Past startup, keep a listener attached so a later socket error is
    // logged rather than becoming an uncaught exception mid-event.
    this.server.on('error', (err) =>
      this.logger.error(`Embedded MQTT broker error: ${err.message}`),
    );
  }

  onModuleDestroy() {
    this.server?.close();
    this.aedes?.close();
  }
}
