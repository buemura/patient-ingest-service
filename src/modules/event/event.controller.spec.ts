import {
  type INestApplication,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  MESSAGE_PUBLISHER,
  type MessagePublisher,
} from '../../shared/queue/message-publisher.js';
import { EventController } from './event.controller.js';
import { EventService } from './event.service.js';

class FakePublisher implements MessagePublisher {
  readonly published: object[] = [];
  failing = false;

  async publish(_queue: string, message: object) {
    if (this.failing) throw new Error('broker unavailable');
    this.published.push(message);
  }
}

const validEvent = {
  patientId: 'p-1',
  type: 'vitals',
  data: { heartRate: 72 },
  ts: '2026-01-01T10:00:00.000Z',
};

describe('EventController', () => {
  let app: INestApplication;
  let publisher: FakePublisher;

  beforeEach(async () => {
    publisher = new FakePublisher();

    const moduleRef = await Test.createTestingModule({
      controllers: [EventController],
      providers: [
        EventService,
        { provide: MESSAGE_PUBLISHER, useValue: publisher },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(new StandardSchemaValidationPipe());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /events responds 202 with the idempotency key once queued', async () => {
    const response = await request(app.getHttpServer())
      .post('/events')
      .send(validEvent)
      .expect(202);

    expect(response.body).toEqual({
      status: 'accepted',
      idempotencyKey: 'p-1:vitals:1767261600000',
    });
    expect(publisher.published).toHaveLength(1);
  });

  it('POST /events responds the same key for a retried duplicate', async () => {
    const first = await request(app.getHttpServer())
      .post('/events')
      .send(validEvent);
    const second = await request(app.getHttpServer())
      .post('/events')
      .send(validEvent);

    expect(second.body.idempotencyKey).toBe(first.body.idempotencyKey);
  });

  it('POST /events rejects an invalid envelope with 400 without queuing it', async () => {
    await request(app.getHttpServer())
      .post('/events')
      .send({ ...validEvent, ts: 'yesterday' })
      .expect(400);

    expect(publisher.published).toHaveLength(0);
  });

  it('POST /events responds 503 when the event cannot be queued', async () => {
    publisher.failing = true;

    await request(app.getHttpServer())
      .post('/events')
      .send(validEvent)
      .expect(503);
  });
});
