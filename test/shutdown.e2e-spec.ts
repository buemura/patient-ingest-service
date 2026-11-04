import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import mongoose from 'mongoose';
import request from 'supertest';

import { configureApp } from '../src/app.setup.js';
import { AppModule } from '../src/modules/app.module.js';
import {
  PATIENT_EVENT_PROCESSOR,
  type PatientEventProcessor,
} from '../src/modules/patient/processing/patient-event-processor.js';
import { waitFor } from './utils/wait-for.js';

class SlowProcessor implements PatientEventProcessor {
  started = 0;

  async process() {
    this.started++;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
}

describe('Graceful shutdown (e2e)', () => {
  it('finishes in-flight events before the process stops', async () => {
    const processor = new SlowProcessor();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PATIENT_EVENT_PROCESSOR)
      .useValue(processor)
      .compile();
    const app: INestApplication = moduleRef.createNestApplication({
      logger: ['error'],
    });
    configureApp(app);
    await app.init();
    const dbName = app.get(getConnectionToken()).name;

    const response = await request(app.getHttpServer())
      .post('/events')
      .send({
        patientId: `p-${randomUUID()}`,
        type: 'vitals',
        data: {},
        ts: '2026-01-01T10:00:00.000Z',
      })
      .expect(202);
    await waitFor(async () => processor.started > 0);

    await app.close();

    const db = await mongoose
      .createConnection(process.env.DATABASE_URL!, { dbName })
      .asPromise();
    try {
      const log = await db
        .collection('event_logs')
        .findOne({ idempotencyKey: response.body.idempotencyKey });
      expect(log).toMatchObject({ status: 'processed' });
    } finally {
      await db.close();
    }
  });
});
