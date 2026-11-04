import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Schema as MongooseSchema } from 'mongoose';

import {
  EventLogStatus,
  ProcessingOutcome,
} from '../../../../modules/patient/repositories/event-log.repository.js';

@Schema({ collection: 'event_logs', timestamps: true })
export class EventLog {
  @Prop({ required: true, unique: true })
  idempotencyKey: string;

  @Prop({ required: true, index: true })
  patientId: string;

  @Prop({ required: true })
  type: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  data: Record<string, unknown>;

  @Prop({ required: true })
  ts: Date;

  @Prop({ required: true })
  receivedAt: Date;

  @Prop({ type: String, required: true, enum: Object.values(EventLogStatus) })
  status: EventLogStatus;

  @Prop({ type: String, enum: Object.values(ProcessingOutcome) })
  outcome?: ProcessingOutcome;

  @Prop()
  processedAt?: Date;
}

export type EventLogDocument = HydratedDocument<EventLog>;

export const EventLogSchema = SchemaFactory.createForClass(EventLog);
EventLogSchema.index({ patientId: 1, ts: 1 });
