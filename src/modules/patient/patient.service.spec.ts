import type { PatientIngestMessage } from '../../shared/queue/messages/patient-ingest.message.js';
import type {
  EventLogRepository,
  NewEventLogEntry,
  ProcessingOutcome,
} from '../event/repositories/event-log.repository.js';
import { PatientService } from './patient.service.js';
import type { PatientEventProcessor } from './processing/patient-event-processor.js';
import type {
  PatientRepository,
  PatientState,
} from './repositories/patient.repository.js';

class InMemoryEventLog implements EventLogRepository {
  readonly entries = new Map<
    string,
    NewEventLogEntry & {
      status: 'pending' | 'processed';
      outcome?: ProcessingOutcome;
    }
  >();

  async register(entry: NewEventLogEntry) {
    const existing = this.entries.get(entry.idempotencyKey);
    if (existing) return { status: existing.status };
    this.entries.set(entry.idempotencyKey, { ...entry, status: 'pending' });
    return { status: 'pending' as const };
  }

  async markProcessed(idempotencyKey: string, outcome: ProcessingOutcome) {
    const entry = this.entries.get(idempotencyKey)!;
    entry.status = 'processed';
    entry.outcome = outcome;
  }
}

class InMemoryPatients implements PatientRepository {
  readonly patients = new Map<string, PatientState>();

  async upsertIfNewer(state: PatientState) {
    const current = this.patients.get(state.patientId);
    if (current && current.lastEventAt >= state.lastEventAt) return false;
    this.patients.set(state.patientId, state);
    return true;
  }
}

class RecordingProcessor implements PatientEventProcessor {
  readonly processed: string[] = [];
  failWith?: Error;

  async process(event: PatientIngestMessage) {
    if (this.failWith) throw this.failWith;
    this.processed.push(event.idempotencyKey);
  }
}

function message(
  overrides: Partial<PatientIngestMessage> = {},
): PatientIngestMessage {
  return {
    idempotencyKey: 'key-1',
    patientId: 'p-1',
    type: 'vitals',
    data: { heartRate: 72 },
    ts: '2026-01-01T10:00:00.000Z',
    receivedAt: '2026-01-01T10:00:01.000Z',
    ...overrides,
  };
}

describe('PatientService', () => {
  let eventLog: InMemoryEventLog;
  let patients: InMemoryPatients;
  let processor: RecordingProcessor;
  let service: PatientService;

  beforeEach(() => {
    eventLog = new InMemoryEventLog();
    patients = new InMemoryPatients();
    processor = new RecordingProcessor();
    service = new PatientService(eventLog, patients, processor);
  });

  it('processes a new event and stores it as the latest patient state', async () => {
    const outcome = await service.handlePatientIngest(message());

    expect(outcome).toBe('applied');
    expect(processor.processed).toEqual(['key-1']);
    expect(patients.patients.get('p-1')).toEqual({
      patientId: 'p-1',
      lastEventType: 'vitals',
      lastEventKey: 'key-1',
      lastEventAt: new Date('2026-01-01T10:00:00.000Z'),
      data: { heartRate: 72 },
    });
  });

  it('records the event in the log as processed', async () => {
    await service.handlePatientIngest(message());

    expect(eventLog.entries.get('key-1')).toMatchObject({
      patientId: 'p-1',
      type: 'vitals',
      ts: new Date('2026-01-01T10:00:00.000Z'),
      receivedAt: new Date('2026-01-01T10:00:01.000Z'),
      status: 'processed',
      outcome: 'applied',
    });
  });

  it('skips an event that was already processed', async () => {
    await service.handlePatientIngest(message());

    const outcome = await service.handlePatientIngest(message());

    expect(outcome).toBe('duplicate');
    expect(processor.processed).toEqual(['key-1']);
    expect(eventLog.entries.size).toBe(1);
  });

  it('reprocesses an event whose earlier attempt never completed', async () => {
    processor.failWith = new Error('crashed mid-processing');
    await expect(service.handlePatientIngest(message())).rejects.toThrow();
    processor.failWith = undefined;

    const outcome = await service.handlePatientIngest(message());

    expect(outcome).toBe('applied');
    expect(processor.processed).toEqual(['key-1']);
  });

  it('leaves a failed event pending and the patient untouched', async () => {
    processor.failWith = new Error('external system down');

    await expect(service.handlePatientIngest(message())).rejects.toThrow(
      'external system down',
    );

    expect(eventLog.entries.get('key-1')?.status).toBe('pending');
    expect(patients.patients.has('p-1')).toBe(false);
  });

  it('does not let an older event overwrite newer patient state', async () => {
    await service.handlePatientIngest(
      message({
        idempotencyKey: 'newer',
        ts: '2026-01-01T11:00:00.000Z',
        data: { v: 2 },
      }),
    );

    const outcome = await service.handlePatientIngest(
      message({
        idempotencyKey: 'older',
        ts: '2026-01-01T10:00:00.000Z',
        data: { v: 1 },
      }),
    );

    expect(outcome).toBe('stale');
    expect(patients.patients.get('p-1')?.data).toEqual({ v: 2 });
    expect(eventLog.entries.get('older')).toMatchObject({
      status: 'processed',
      outcome: 'stale',
    });
  });

  it('converges to the latest state regardless of arrival order', async () => {
    const events = [
      message({
        idempotencyKey: 'b',
        ts: '2026-01-01T10:00:02.000Z',
        data: { v: 2 },
      }),
      message({
        idempotencyKey: 'c',
        ts: '2026-01-01T10:00:03.000Z',
        data: { v: 3 },
      }),
      message({
        idempotencyKey: 'a',
        ts: '2026-01-01T10:00:01.000Z',
        data: { v: 1 },
      }),
    ];

    for (const event of events) await service.handlePatientIngest(event);

    expect(patients.patients.get('p-1')?.data).toEqual({ v: 3 });
    expect(processor.processed).toEqual(['b', 'c', 'a']);
  });
});
