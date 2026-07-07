import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createServer, Server } from 'net';
import Aedes from 'aedes';

@Injectable()
export class BrokerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrokerService.name);
  private aedes: Aedes;
  private server: Server;

  constructor(private readonly events: EventEmitter2) {}

  onModuleInit() {
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
      this.events.emit('mqtt.message', { topic: packet.topic, payload: packet.payload });
    });

    this.server.listen(port, () => {
      this.logger.log(`Embedded MQTT broker listening on port ${port}`);
    });
  }

  onModuleDestroy() {
    this.server?.close();
    this.aedes?.close();
  }
}
