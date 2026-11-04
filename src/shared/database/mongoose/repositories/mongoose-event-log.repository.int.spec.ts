import type { Connection, Model } from 'mongoose';

import {
  type NewEventLogEntry,
  ProcessingOutcome,
} from '../../../../modules/patient/repositories/event-log.repository.js';
import { startMongo } from '../../../../../test/utils/mongo-memory.js';
import { EventLog, EventLogSchema } from '../schemas/event-log.schema.js';
import { MongooseEventLogRepository } from './mongoose-event-log.repository.js';

const entry = (key = 'key-1'): NewEventLogEntry => ({
  idempotencyKey: key,
  patientId: 'p-1',
  type: 'vitals',
  data: { heartRate: 72 },
  ts: new Date('2026-01-01T10:00:00.000Z'),
  receivedAt: new Date('2026-01-01T10:00:01.000Z'),
});

describe('MongooseEventLogRepository', () => {
  let connection: Connection;
  let stop: () => Promise<void>;
  let model: Model<EventLog>;
  let repository: MongooseEventLogRepository;

  beforeAll(async () => {
    ({ connection, stop } = await startMongo());
    model = connection.model<EventLog>(EventLog.name, EventLogSchema);
    await model.init();
    repository = new MongooseEventLogRepository(model);
  });

  afterAll(async () => {
    await stop();
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  it('stores a new event as pending', async () => {
    const result = await repository.register(entry());

    expect(result).toEqual({ status: 'pending' });
    expect(
      await model.findOne({ idempotencyKey: 'key-1' }).lean(),
    ).toMatchObject({
      patientId: 'p-1',
      type: 'vitals',
      data: { heartRate: 72 },
      ts: new Date('2026-01-01T10:00:00.000Z'),
      status: 'pending',
    });
  });

  it('keeps the first copy when the same event is registered again', async () => {
    await repository.register(entry());

    await repository.register({ ...entry(), data: { heartRate: 999 } });

    const docs = await model.find({ idempotencyKey: 'key-1' }).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0].data).toEqual({ heartRate: 72 });
  });

  it('reports an event as processed once marked', async () => {
    await repository.register(entry());

    await repository.markProcessed('key-1', ProcessingOutcome.Stale);

    expect(await repository.register(entry())).toEqual({ status: 'processed' });
    expect(
      await model.findOne({ idempotencyKey: 'key-1' }).lean(),
    ).toMatchObject({
      outcome: 'stale',
      processedAt: expect.any(Date),
    });
  });

  it('stores exactly one entry when the same event is registered concurrently', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => repository.register(entry())),
    );

    expect(results.every((r) => r.status === 'pending')).toBe(true);
    expect(await model.countDocuments({ idempotencyKey: 'key-1' })).toBe(1);
  });
});
