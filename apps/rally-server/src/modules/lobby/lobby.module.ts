import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from '../../app.controller';
import { EventFilesController } from '../event-files/event-files.controller';
import { EventFilesService } from '../event-files/event-files.service';
import { LobbyAuthController } from './lobby-auth.controller';
import { LobbyGuard, LobbyLogins } from './lobby.guard';

/**
 * What the server boots instead of `AppModule` while no event is open
 * (`startsInLobby`): the dashboard and `/event`, nothing that needs an event
 * database — no TypeORM, MQTT broker or SNTP. Picking an event restarts the
 * server into it.
 */
@Module({
  imports: [EventEmitterModule.forRoot()],
  controllers: [AppController, LobbyAuthController, EventFilesController],
  providers: [
    EventFilesService,
    LobbyLogins,
    { provide: APP_GUARD, useClass: LobbyGuard },
  ],
})
export class LobbyModule {}
