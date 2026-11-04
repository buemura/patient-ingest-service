import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import {
  type EventLogRepository,
  EventLogStatus,
  type NewEventLogEntry,
  type ProcessingOutcome,
} from '../../../../modules/event/repositories/event-log.repository.js';
import { isDuplicateKeyError } from '../mongo-errors.js';
import { EventLog } from '../schemas/event-log.schema.js';

@Injectable()
export class MongooseEventLogRepository implements EventLogRepository {
  constructor(
    @InjectModel(EventLog.name) private readonly model: Model<EventLog>,
  ) {}

  async register(entry: NewEventLogEntry): Promise<{ status: EventLogStatus }> {
    try {
      const doc = await this.model
        .findOneAndUpdate(
          { idempotencyKey: entry.idempotencyKey },
          { $setOnInsert: { ...entry, status: EventLogStatus.Pending } },
          { upsert: true, returnDocument: 'after', projection: { status: 1 } },
        )
        .lean()
        .orFail();
      return { status: doc.status };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const doc = await this.model
        .findOne({ idempotencyKey: entry.idempotencyKey }, { status: 1 })
        .lean()
        .orFail();
      return { status: doc.status };
    }
  }

  async markProcessed(
    idempotencyKey: string,
    outcome: ProcessingOutcome,
  ): Promise<void> {
    await this.model.updateOne(
      { idempotencyKey },
      {
        $set: {
          status: EventLogStatus.Processed,
          outcome,
          processedAt: new Date(),
        },
      },
    );
  }
}
