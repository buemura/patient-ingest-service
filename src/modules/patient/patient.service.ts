import { Inject, Injectable, Logger } from '@nestjs/common';

import type { PatientIngestMessage } from '../../shared/queue/messages/patient-ingest.message.js';
import {
  EVENT_LOG_REPOSITORY,
  type EventLogRepository,
  type ProcessingOutcome,
} from '../event/repositories/event-log.repository.js';
import {
  PATIENT_EVENT_PROCESSOR,
  type PatientEventProcessor,
} from './processing/patient-event-processor.js';
import {
  PATIENT_REPOSITORY,
  type PatientRepository,
} from './repositories/patient.repository.js';

export type HandleOutcome = ProcessingOutcome | 'duplicate';

@Injectable()
export class PatientService {
  private readonly logger = new Logger(PatientService.name);

  constructor(
    @Inject(EVENT_LOG_REPOSITORY) private readonly eventLog: EventLogRepository,
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepository,
    @Inject(PATIENT_EVENT_PROCESSOR)
    private readonly processor: PatientEventProcessor,
  ) {}

  async handle(event: PatientIngestMessage): Promise<HandleOutcome> {
    const ts = new Date(event.ts);
    const { status } = await this.eventLog.register({
      idempotencyKey: event.idempotencyKey,
      patientId: event.patientId,
      type: event.type,
      data: event.data,
      ts,
      receivedAt: new Date(event.receivedAt),
    });

    if (status === 'processed') {
      this.logger.log(`Duplicate event skipped key=${event.idempotencyKey}`);
      return 'duplicate';
    }

    await this.processor.process(event);

    const applied = await this.patients.upsertIfNewer({
      patientId: event.patientId,
      lastEventType: event.type,
      lastEventKey: event.idempotencyKey,
      lastEventAt: ts,
      data: event.data,
    });
    const outcome: ProcessingOutcome = applied ? 'applied' : 'stale';

    await this.eventLog.markProcessed(event.idempotencyKey, outcome);

    this.logger.log(
      `Event processed patientId=${event.patientId} key=${event.idempotencyKey} outcome=${outcome}`,
    );

    return outcome;
  }
}
