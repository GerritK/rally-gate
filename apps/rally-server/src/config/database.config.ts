import { join } from 'node:path';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import {
  eventsDir,
  resolveEventFile,
} from '../modules/event-files/event-files';

export function buildDatabaseConfig(): TypeOrmModuleOptions {
  const dbType = process.env.DB_TYPE ?? 'sqlite';

  if (dbType === 'postgres') {
    return {
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME ?? 'rally',
      password: process.env.DB_PASSWORD ?? 'rally',
      database: process.env.DB_NAME ?? 'rally_gate',
      autoLoadEntities: true,
      synchronize: true,
    };
  }

  const dir = eventsDir();
  return {
    type: 'better-sqlite3',
    database: dir
      ? join(dir, resolveEventFile(dir))
      : (process.env.DB_PATH ?? 'rally-gate.sqlite'),
    autoLoadEntities: true,
    synchronize: true,
  };
}
