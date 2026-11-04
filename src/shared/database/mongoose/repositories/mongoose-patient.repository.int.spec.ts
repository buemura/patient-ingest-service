import type { Connection, Model } from 'mongoose';

import type { PatientState } from '../../../../modules/patient/repositories/patient.repository.js';
import { startMongo } from '../../../../../test/utils/mongo-memory.js';
import { Patient, PatientSchema } from '../schemas/patient.schema.js';
import { MongoosePatientRepository } from './mongoose-patient.repository.js';

const state = (at: string, data: Record<string, unknown>): PatientState => ({
  patientId: 'p-1',
  lastEventType: 'vitals',
  lastEventKey: `key-${at}`,
  lastEventAt: new Date(at),
  data,
});

describe('MongoosePatientRepository', () => {
  let connection: Connection;
  let stop: () => Promise<void>;
  let model: Model<Patient>;
  let repository: MongoosePatientRepository;

  beforeAll(async () => {
    ({ connection, stop } = await startMongo());
    model = connection.model<Patient>(Patient.name, PatientSchema);
    await model.init();
    repository = new MongoosePatientRepository(model);
  });

  afterAll(async () => {
    await stop();
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  const stored = () => model.findOne({ patientId: 'p-1' }).lean();

  it('creates the patient on its first event', async () => {
    const applied = await repository.upsertIfNewer(
      state('2026-01-01T10:00:00Z', { v: 1 }),
    );

    expect(applied).toBe(true);
    expect(await stored()).toMatchObject({
      lastEventType: 'vitals',
      lastEventKey: 'key-2026-01-01T10:00:00Z',
      lastEventAt: new Date('2026-01-01T10:00:00Z'),
      data: { v: 1 },
    });
  });

  it('replaces the state with a newer event', async () => {
    await repository.upsertIfNewer(state('2026-01-01T10:00:00Z', { v: 1 }));

    const applied = await repository.upsertIfNewer(
      state('2026-01-01T11:00:00Z', { v: 2 }),
    );

    expect(applied).toBe(true);
    expect((await stored())?.data).toEqual({ v: 2 });
  });

  it('ignores an event older than the stored state', async () => {
    await repository.upsertIfNewer(state('2026-01-01T11:00:00Z', { v: 2 }));

    const applied = await repository.upsertIfNewer(
      state('2026-01-01T10:00:00Z', { v: 1 }),
    );

    expect(applied).toBe(false);
    expect((await stored())?.data).toEqual({ v: 2 });
  });

  it('ignores an event with the same timestamp as the stored state', async () => {
    await repository.upsertIfNewer(state('2026-01-01T10:00:00Z', { v: 1 }));

    const applied = await repository.upsertIfNewer(
      state('2026-01-01T10:00:00Z', { v: 'other' }),
    );

    expect(applied).toBe(false);
    expect((await stored())?.data).toEqual({ v: 1 });
  });

  it('ends with the newest state when events race in any order', async () => {
    const minutes = Array.from({ length: 30 }, (_, i) => i).sort(
      () => Math.random() - 0.5,
    );

    await Promise.all(
      minutes.map((m) =>
        repository.upsertIfNewer(
          state(new Date(Date.UTC(2026, 0, 1, 10, m)).toISOString(), { m }),
        ),
      ),
    );

    expect(await model.countDocuments({ patientId: 'p-1' })).toBe(1);
    expect((await stored())?.data).toEqual({ m: 29 });
  });
});
