import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

/**
 * Built frontend, served by this process so a headless deployment has a UI
 * on the same port as the API. Resolved relative to the compiled output, so
 * it lands on `apps/web/dist` both in the repo and in the Docker image.
 */
const WEB_DIST = join(__dirname, '..', '..', 'web', 'dist');

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // The frontend is served from this same origin, and `/vehicles` is both a
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

  await app.listen(process.env.PORT ?? 57430);
}
void bootstrap();
