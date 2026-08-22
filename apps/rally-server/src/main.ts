import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
  await app.listen(process.env.PORT ?? 57430);
}
void bootstrap();
