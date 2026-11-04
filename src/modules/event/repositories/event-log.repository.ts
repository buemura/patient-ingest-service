export const EVENT_LOG_REPOSITORY = Symbol('EVENT_LOG_REPOSITORY');

export type EventLogStatus = 'pending' | 'processed';
export type ProcessingOutcome = 'applied' | 'stale';

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
