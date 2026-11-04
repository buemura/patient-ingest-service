import { ServiceUnavailableException } from '@nestjs/common';

import type { MessagePublisher } from '../../shared/queue/message-publisher.js';
import { PATIENT_INGEST_QUEUE } from '../../shared/queue/queue.constants.js';
import { buildIdempotencyKey } from './domain/idempotency-key.js';
import { EventService } from './event.service.js';

class FakePublisher implements MessagePublisher {
  readonly published: { queue: string; message: unknown; messageId: string }[] =
    [];
  failWith?: Error;

  async publish(queue: string, message: object, messageId: string) {
    if (this.failWith) throw this.failWith;
    this.published.push({ queue, message, messageId });
  }
}

const dto = {
  patientId: 'p-1',
  type: 'vitals',
  data: { heartRate: 72 },
  ts: '2026-01-01T12:00:00+02:00',
};

describe('EventService', () => {
  let publisher: FakePublisher;
  let service: EventService;

  beforeEach(() => {
    publisher = new FakePublisher();
    service = new EventService(publisher);
  });

  it('returns the idempotency key derived from the event', async () => {
    const result = await service.ingest(dto);

    expect(result.idempotencyKey).toBe(
      buildIdempotencyKey(dto.patientId, dto.type, dto.ts),
    );
  });

  it('publishes the event to the patient ingest queue keyed by idempotency key', async () => {
    const { idempotencyKey } = await service.ingest(dto);

    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]).toMatchObject({
      queue: PATIENT_INGEST_QUEUE,
      messageId: idempotencyKey,
      message: {
        idempotencyKey,
        patientId: 'p-1',
        type: 'vitals',
        data: { heartRate: 72 },
      },
    });
  });

  it('normalises the event timestamp to UTC', async () => {
    await service.ingest(dto);

    expect(publisher.published[0].message).toMatchObject({
      ts: '2026-01-01T10:00:00.000Z',
    });
  });

  it('stamps the time the event was received', async () => {
    await service.ingest(dto);

    const { receivedAt } = publisher.published[0].message as {
      receivedAt: string;
    };
    expect(Date.parse(receivedAt)).not.toBeNaN();
  });

  it('reports publish failures as service unavailable so the sender retries', async () => {
    publisher.failWith = new Error('broker unavailable');

    await expect(service.ingest(dto)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
