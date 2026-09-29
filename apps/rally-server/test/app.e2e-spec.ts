import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/api/version (GET)', () => {
    // Under /api since the dashboard is served from the same origin at `/`
    // — see setGlobalPrefix in main.ts.
    return request(app.getHttpServer())
      .get('/api/version')
      .expect(200)
      .expect((res) =>
        expect(typeof (res.body as { version: unknown }).version).toBe(
          'string',
        ),
      );
  });

  afterEach(async () => {
    await app.close();
  });
});
