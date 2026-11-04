import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';

import {
  type IncomingMessage,
  MESSAGE_SUBSCRIBER,
  type MessageSubscriber,
} from '../../shared/queue/message-subscriber.js';
import {
  type PatientIngestMessage,
  patientIngestMessageSchema,
} from '../../shared/queue/messages/patient-ingest.message.js';
import {
  PATIENT_INGEST_MAX_RETRIES,
  PATIENT_INGEST_QUEUE,
} from '../../shared/queue/queue.constants.js';
import { PatientService } from './patient.service.js';

@Injectable()
export class PatientIngestConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(PatientIngestConsumer.name);

  constructor(
    @Inject(MESSAGE_SUBSCRIBER) private readonly subscriber: MessageSubscriber,
    private readonly patientService: PatientService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.subscriber.subscribe(
      PATIENT_INGEST_QUEUE,
      (message) => this.onMessage(message),
      { maxRetries: PATIENT_INGEST_MAX_RETRIES },
    );
    this.logger.log(`Consuming ${PATIENT_INGEST_QUEUE}`);
  }

  private async onMessage(message: IncomingMessage): Promise<void> {
    const event = this.parse(message.body);
    if (!event) {
      message.deadLetter();
      return;
    }

    try {
      await this.patientService.handle(event);
      message.ack();
    } catch (error) {
      this.logger.warn(
        `Processing failed key=${event.idempotencyKey} retry=${message.retryCount}/${PATIENT_INGEST_MAX_RETRIES}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await message.retry();
    }
  }

  private parse(body: Buffer): PatientIngestMessage | undefined {
    try {
      const result = patientIngestMessageSchema.safeParse(
        JSON.parse(body.toString()),
      );
      if (result.success) return result.data;
      this.logger.error(
        `Invalid message dead-lettered: ${result.error.message}`,
      );
    } catch {
      this.logger.error('Unparseable message dead-lettered');
    }
    return undefined;
  }
}
