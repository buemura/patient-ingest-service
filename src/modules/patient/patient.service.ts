import { Inject, Injectable, Logger } from '@nestjs/common';

import type { PatientIngestMessage } from './dto/patient-ingest.dto.js';
import {
  PATIENT_EVENT_PROCESSOR,
  type PatientEventProcessor,
} from './processing/patient-event-processor.js';
import {
  EVENT_LOG_REPOSITORY,
  EventLogStatus,
  ProcessingOutcome,
  type EventLogRepository,
} from './repositories/event-log.repository.js';
import {
  PATIENT_REPOSITORY,
  type PatientRepository,
} from './repositories/patient.repository.js';

export enum SkippedOutcome {
  Duplicate = 'duplicate',
}

export type HandleOutcome = ProcessingOutcome | SkippedOutcome;

@Injectable()
export class PatientService {
  private readonly logger = new Logger(PatientService.name);

  constructor(
    @Inject(EVENT_LOG_REPOSITORY) private readonly eventLog: EventLogRepository,
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepository,
    @Inject(PATIENT_EVENT_PROCESSOR)
    private readonly processor: PatientEventProcessor,
  ) {}

  async handlePatientIngest(
    event: PatientIngestMessage,
  ): Promise<HandleOutcome> {
    const ts = new Date(event.ts);
    const { status } = await this.eventLog.register({
      idempotencyKey: event.idempotencyKey,
      patientId: event.patientId,
      type: event.type,
      data: event.data,
      ts,
      receivedAt: new Date(event.receivedAt),
    });

    if (status === EventLogStatus.Processed) {
      this.logger.log(`Duplicate event skipped key=${event.idempotencyKey}`);
      return SkippedOutcome.Duplicate;
    }

    await this.processor.process(event);

    const applied = await this.patients.upsertIfNewer({
      patientId: event.patientId,
      lastEventType: event.type,
      lastEventKey: event.idempotencyKey,
      lastEventAt: ts,
      data: event.data,
    });
    const outcome = applied
      ? ProcessingOutcome.Applied
      : ProcessingOutcome.Stale;

    await this.eventLog.markProcessed(event.idempotencyKey, outcome);

    this.logger.log(
      `Event processed patientId=${event.patientId} key=${event.idempotencyKey} outcome=${outcome}`,
    );

    return outcome;
  }
}
