export const EVENT_LOG_REPOSITORY = Symbol('EVENT_LOG_REPOSITORY');

export enum EventLogStatus {
  Pending = 'pending',
  Processed = 'processed',
}

export enum ProcessingOutcome {
  Applied = 'applied',
  Stale = 'stale',
}

export interface NewEventLogEntry {
  idempotencyKey: string;
  patientId: string;
  type: string;
  data: Record<string, unknown>;
  ts: Date;
  receivedAt: Date;
}

export interface EventLogRepository {
  register(entry: NewEventLogEntry): Promise<{ status: EventLogStatus }>;
  markProcessed(
    idempotencyKey: string,
    outcome: ProcessingOutcome,
  ): Promise<void>;
}
