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

  /**
   * Every API route lives under `/api`, because the frontend is served from
   * the same origin and the two collide otherwise: `/vehicles` is both a
   * REST resource and a page in the dashboard, and `/` is both the health
   * route and `index.html`. Prefixing is what keeps the split unambiguous,
   * rather than depending on which router happens to match first — and it
   * stops a new endpoint from silently shadowing a page later.
   */
  app.setGlobalPrefix('api');
  app.enableCors({ origin: '*' });
  app.useGlobalPipes(
    new ValidationPipe({
      // Drop anything the DTO doesn't declare, then reject rather than
      // silently ignore it. Stripping alone would close the security hole
      // (an entity field like Stage.status can no longer be set through a
      // generic create/update), but a marshal whose request quietly did
      // nothing has no way to tell — a 400 naming the property does.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Absent when the server runs without a built frontend — the standalone
  // dev loop, where Vite serves it on 57432 instead. Skipped rather than
  // failing, since the API is perfectly usable on its own.
  if (existsSync(WEB_DIST)) {
    app.useStaticAssets(WEB_DIST);
    // Any GET that isn't a real file and isn't the API is a client-side
    // route (`/results/stages/WP1`), and has to return index.html for
    // vue-router's history mode to resolve it — otherwise a deep link or a
    // refresh away from `/` is a 404.
    //
    // Registered here, *before* `listen()` initialises Nest, on purpose:
    // Nest installs its own catch-all not-found handler while initialising,
    // so middleware added afterwards never runs. Ordering ends up
    // static files -> this fallback -> Nest, which is safe only because
    // `setGlobalPrefix` put every API route under `/api` — nothing else
    // needs to reach the framework's router.
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
