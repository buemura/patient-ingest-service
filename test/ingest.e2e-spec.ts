import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import amqplib from 'amqplib';
import type { Connection } from 'mongoose';
import request from 'supertest';

import { configureApp } from '../src/app.setup.js';
import { AppModule } from '../src/modules/app.module.js';
import {
  PATIENT_EVENT_PROCESSOR,
  type PatientEventProcessor,
} from '../src/modules/patient/processing/patient-event-processor.js';
import type { PatientIngestMessage } from '../src/modules/patient/dto/patient-ingest.dto.js';
import { PATIENT_INGEST_DLQ } from '../src/shared/queue/queue.constants.js';
import { waitFor } from './utils/wait-for.js';

class ControllableProcessor implements PatientEventProcessor {
  readonly attempts = new Map<string, number>();

  async process(event: PatientIngestMessage) {
    this.attempts.set(
      event.idempotencyKey,
      (this.attempts.get(event.idempotencyKey) ?? 0) + 1,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (event.patientId.startsWith('fail-')) {
      throw new Error('external system rejected the event');
    }
  }
}

describe('Event ingestion (e2e)', () => {
  let app: INestApplication;
  let db: Connection;
  let processor: ControllableProcessor;

  beforeAll(async () => {
    processor = new ControllableProcessor();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PATIENT_EVENT_PROCESSOR)
      .useValue(processor)
      .compile();

    app = moduleRef.createNestApplication({ logger: ['error'] });
    configureApp(app);
    await app.init();
    db = app.get(getConnectionToken());
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (body: object) =>
    request(app.getHttpServer()).post('/events').send(body);

  const event = (patientId: string, ts: string, data: object = {}) => ({
    patientId,
    type: 'vitals',
    data,
    ts,
  });

  const findPatient = (patientId: string) =>
    db.collection('patients').findOne({ patientId });

  const findLog = (idempotencyKey: string) =>
    db.collection('event_logs').findOne({ idempotencyKey });

  it('accepts an event and processes it into the patient state', async () => {
    const patientId = `p-${randomUUID()}`;

    const response = await post(
      event(patientId, '2026-01-01T10:00:00.000Z', { heartRate: 72 }),
    ).expect(202);

    const patient = await waitFor(() => findPatient(patientId));
    expect(patient).toMatchObject({ data: { heartRate: 72 } });
    expect(await findLog(response.body.idempotencyKey)).toMatchObject({
      status: 'processed',
      outcome: 'applied',
    });
  });

  it('records an event sent many times exactly once', async () => {
    const patientId = `p-${randomUUID()}`;
    const body = event(patientId, '2026-01-01T10:00:00.000Z', { v: 1 });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => post(body).expect(202)),
    );
    const { idempotencyKey } = responses[0].body;

    await waitFor(
      async () => (await findLog(idempotencyKey))?.status === 'processed',
    );
    await waitFor(async () => {
      const remaining = await app
        .get(getConnectionToken())
        .collection('event_logs')
        .countDocuments({ patientId, status: 'pending' });
      return remaining === 0;
    });
    expect(
      await db.collection('event_logs').countDocuments({ patientId }),
    ).toBe(1);
  });

  it('keeps the newest state when events arrive out of order', async () => {
    const patientId = `p-${randomUUID()}`;

    const newer = await post(
      event(patientId, '2026-01-01T11:00:00.000Z', { v: 2 }),
    ).expect(202);
    await waitFor(
      async () =>
        (await findLog(newer.body.idempotencyKey))?.status === 'processed',
    );

    const older = await post(
      event(patientId, '2026-01-01T10:00:00.000Z', { v: 1 }),
    ).expect(202);
    await waitFor(
      async () =>
        (await findLog(older.body.idempotencyKey))?.status === 'processed',
    );

    expect(await findPatient(patientId)).toMatchObject({ data: { v: 2 } });
    expect(await findLog(older.body.idempotencyKey)).toMatchObject({
      outcome: 'stale',
    });
  });

  it('retries a failing event 3 times and then moves it to the dead-letter queue', async () => {
    const patientId = `fail-${randomUUID()}`;

    const response = await post(
      event(patientId, '2026-01-01T10:00:00.000Z'),
    ).expect(202);
    const { idempotencyKey } = response.body;

    const deadLettered = await waitFor(() => takeFromDlq(idempotencyKey), {
      timeoutMs: 20_000,
      intervalMs: 250,
    });

    expect(processor.attempts.get(idempotencyKey)).toBe(4);
    expect(deadLettered.patientId).toBe(patientId);
    expect(await findLog(idempotencyKey)).toMatchObject({ status: 'pending' });
    expect(await findPatient(patientId)).toBeNull();
  });

  it('rejects an invalid envelope with 400', async () => {
    const response = await post({ patientId: 'p-1', type: 'vitals' }).expect(
      400,
    );

    expect(response.body).toMatchObject({ statusCode: 400, path: '/events' });
  });
});

async function takeFromDlq(
  idempotencyKey: string,
): Promise<PatientIngestMessage | undefined> {
  const connection = await amqplib.connect(process.env.RABBITMQ_URL!);
  const channel = await connection.createChannel();
  const others: amqplib.GetMessage[] = [];
  try {
    for (;;) {
      const message = await channel.get(PATIENT_INGEST_DLQ, { noAck: false });
      if (!message) return undefined;
      const body = JSON.parse(
        message.content.toString(),
      ) as PatientIngestMessage;
      if (body.idempotencyKey === idempotencyKey) {
        channel.ack(message);
        return body;
      }
      others.push(message);
    }
  } finally {
    for (const message of others) channel.nack(message, false, true);
    await channel.close();
    await connection.close();
  }
}
