import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import type { Env } from '../../config/env.js';
import { EVENT_LOG_REPOSITORY } from '../../modules/patient/repositories/event-log.repository.js';
import { PATIENT_REPOSITORY } from '../../modules/patient/repositories/patient.repository.js';
import { MongooseEventLogRepository } from './mongoose/repositories/mongoose-event-log.repository.js';
import { MongoosePatientRepository } from './mongoose/repositories/mongoose-patient.repository.js';
import {
  EventLog,
  EventLogSchema,
} from './mongoose/schemas/event-log.schema.js';
import { Patient, PatientSchema } from './mongoose/schemas/patient.schema.js';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        uri: config.get('DATABASE_URL', { infer: true }),
        socketTimeoutMS: 30_000,
        serverSelectionTimeoutMS: 10_000,
      }),
    }),
    MongooseModule.forFeature([
      { name: EventLog.name, schema: EventLogSchema },
      { name: Patient.name, schema: PatientSchema },
    ]),
  ],
  providers: [
    { provide: EVENT_LOG_REPOSITORY, useClass: MongooseEventLogRepository },
    { provide: PATIENT_REPOSITORY, useClass: MongoosePatientRepository },
  ],
  exports: [EVENT_LOG_REPOSITORY, PATIENT_REPOSITORY],
})
export class DatabaseModule {}
