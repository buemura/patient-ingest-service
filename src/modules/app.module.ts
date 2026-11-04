import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from '../config/env.js';
import { QueueModule } from '../shared/queue/queue.module.js';
import { EventModule } from './event/event.module.js';
import { HealthModule } from './health/health.module.js';
import { PatientModule } from './patient/patient.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    QueueModule,
    HealthModule,
    EventModule,
    PatientModule,
  ],
})
export class AppModule {}
