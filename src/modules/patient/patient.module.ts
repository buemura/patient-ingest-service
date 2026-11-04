import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.js';
import { DatabaseModule } from '../../shared/database/database.module.js';
import { PatientIngestConsumer } from './patient.consumer.js';
import { PatientService } from './patient.service.js';
import { PATIENT_EVENT_PROCESSOR } from './processing/patient-event-processor.js';
import { SimulatedPatientEventProcessor } from './processing/simulated-patient-event-processor.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    PatientService,
    PatientIngestConsumer,
    {
      provide: PATIENT_EVENT_PROCESSOR,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new SimulatedPatientEventProcessor(
          config.get('PROCESSING_DELAY_MS', { infer: true }),
        ),
    },
  ],
})
export class PatientModule {}
