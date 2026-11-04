import { Inject, Injectable } from '@nestjs/common';

import {
  MESSAGE_SUBSCRIBER,
  type MessageSubscriber,
} from '../../../shared/queue/message-subscriber.js';
import {
  type PatientIngestMessage,
  patientIngestMessageSchema,
} from '../../../shared/queue/messages/patient-ingest.message.js';
import { QueueConsumer } from '../../../shared/queue/queue-consumer.js';
import {
  PATIENT_INGEST_MAX_RETRIES,
  PATIENT_INGEST_QUEUE,
} from '../../../shared/queue/queue.constants.js';
import { PatientService } from '../patient.service.js';

@Injectable()
export class PatientIngestConsumer extends QueueConsumer<PatientIngestMessage> {
  protected readonly queue = PATIENT_INGEST_QUEUE;
  protected readonly schema = patientIngestMessageSchema;
  protected readonly maxRetries = PATIENT_INGEST_MAX_RETRIES;

  constructor(
    @Inject(MESSAGE_SUBSCRIBER) subscriber: MessageSubscriber,
    private readonly patientService: PatientService,
  ) {
    super(subscriber);
  }

  protected handle(event: PatientIngestMessage) {
    return this.patientService.handlePatientIngest(event);
  }

  protected describe(event: PatientIngestMessage) {
    return `key=${event.idempotencyKey}`;
  }
}
