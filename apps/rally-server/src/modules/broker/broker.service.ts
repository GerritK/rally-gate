import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createServer, Server } from 'net';
import Aedes from 'aedes';

@Injectable()
export class BrokerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrokerService.name);
  private aedes: Aedes;
  private server: Server;

  constructor(private readonly events: EventEmitter2) {}

  async onModuleInit() {
    const port = Number(process.env.MQTT_PORT ?? 57431);
    this.aedes = new Aedes();
    this.server = createServer(this.aedes.handle);

    this.aedes.on('publish', (packet, client) => {
      // client is null for internally-originated packets; only forward
      // messages that actually came from a connected gate-agent.
      if (!client) {
        return;
      }
      this.events.emit(`mqtt.${packet.topic}`, packet.payload);
      this.events.emit('mqtt.message', {
        topic: packet.topic,
        payload: packet.payload,
      });
    });

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
    }).catch((err: NodeJS.ErrnoException) => {
      const hint =
        err.code === 'EADDRINUSE'
          ? ' — another rally-server is probably already running'
          : '';
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
