import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  MESSAGE_PUBLISHER,
  type MessagePublisher,
} from '../../shared/queue/message-publisher.js';
import type { PatientIngestMessage } from '../../shared/queue/messages/patient-ingest.message.js';
import { PATIENT_INGEST_QUEUE } from '../../shared/queue/queue.constants.js';
import { buildIdempotencyKey } from './domain/idempotency-key.js';
import type { CreateEventDto } from './dto/create-event.dto.js';

export interface IngestResult {
  idempotencyKey: string;
}

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    @Inject(MESSAGE_PUBLISHER) private readonly publisher: MessagePublisher,
  ) {}

  async ingest(dto: CreateEventDto): Promise<IngestResult> {
    const idempotencyKey = buildIdempotencyKey(dto.patientId, dto.type, dto.ts);

    const message: PatientIngestMessage = {
      idempotencyKey,
      patientId: dto.patientId,
      type: dto.type,
      data: dto.data,
      ts: new Date(dto.ts).toISOString(),
      receivedAt: new Date().toISOString(),
    };

    try {
      await this.publisher.publish(
        PATIENT_INGEST_QUEUE,
        message,
        idempotencyKey,
      );
    } catch (error) {
      this.logger.error(
        `Failed to queue event key=${idempotencyKey}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException(
        'Event could not be queued, please retry',
      );
    }

    this.logger.log(
      `Event queued patientId=${dto.patientId} type=${dto.type} key=${idempotencyKey}`,
    );

    return { idempotencyKey };
  }
}
