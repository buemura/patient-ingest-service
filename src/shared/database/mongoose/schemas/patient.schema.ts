import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({ collection: 'patients', timestamps: true })
export class Patient {
  @Prop({ required: true, unique: true })
  patientId: string;

  @Prop({ required: true })
  lastEventType: string;

  @Prop({ required: true })
  lastEventKey: string;

  @Prop({ required: true })
  lastEventAt: Date;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  data: Record<string, unknown>;
}

export type PatientDocument = HydratedDocument<Patient>;

export const PatientSchema = SchemaFactory.createForClass(Patient);
