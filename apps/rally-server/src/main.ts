import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { RESTART_EXIT_CODE } from './modules/event-files/event-files';
import { ensureWindowsFirewall } from './windows-firewall';

/**
 * Built frontend, served by this process so a headless deployment has a UI
 * on the same port as the API. Resolved relative to the compiled output, so
 * it lands on `apps/web/dist` both in the repo and in the Docker image.
 */
const WEB_DIST = join(__dirname, '..', '..', 'web', 'dist');

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Open SSE streams would otherwise hold app.close() open forever.
    forceCloseConnections: true,
    logger:
      process.env.LOG_LEVEL === 'warn' ? ['warn', 'error', 'fatal'] : undefined,
  });

  // The frontend is served from this same origin, and `/entries` is both a
  // REST resource and a dashboard page. The prefix is what keeps a new
  // endpoint from silently shadowing a page.
  app.setGlobalPrefix('api');
  app.enableCors({ origin: '*' });
  app.useGlobalPipes(
    new ValidationPipe({
      // Rejecting rather than silently stripping: both close the hole (no
      // setting Stage.status through a generic update), but only a 400 tells
      // a marshal their request did nothing.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Absent when the server runs without a built frontend — the standalone
  // dev loop, where Vite serves it on 57440 instead. Skipped rather than
  // failing, since the API is perfectly usable on its own.
  if (existsSync(WEB_DIST)) {
    app.useStaticAssets(WEB_DIST);
    // Non-API GETs that aren't real files are client-side routes, and need
    // index.html for vue-router's history mode to resolve a deep link.
    //
    // Registered before `listen()` on purpose: Nest installs its own catch-all
    // 404 while initialising, so middleware added afterwards never runs.
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(join(WEB_DIST, 'index.html'));
    });
  }

  const port = process.env.PORT ?? 57430;
  await app.listen(port);
  const url = `http://localhost:${port}`;
  // Not through the logger: the standalone console runs at LOG_LEVEL=warn,
  // and this is the one line a marshal needs from it.
  console.log(`Dashboard: ${url}`);
  if (process.env.DB_TYPE !== 'postgres') {
    console.log(`Event file: ${String(app.get(DataSource).options.database)}`);
  }
  app.get(EventEmitter2).once('app.restart', () => {
    // A moment for the response to the switch request to reach the browser.
    setTimeout(() => {
      void app.close().finally(() => process.exit(RESTART_EXIT_CODE));
    }, 200);
  });
  if (process.env.OPEN_BROWSER === '1') {
    openBrowser(url);
  }
  // Not awaited: the UAC prompt must not hold up a server that works locally.
  void ensureWindowsFirewall();
}
void bootstrap();

function openBrowser(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  // No browser found is fine: the URL is in the console.
  execFile(command, args, () => {});
}
