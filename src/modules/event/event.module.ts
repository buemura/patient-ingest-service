import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../shared/database/database.module.js';
import { EventController } from './event.controller.js';
import { EventService } from './event.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [EventController],
  providers: [EventService],
})
export class EventModule {}
