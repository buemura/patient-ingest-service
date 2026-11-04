import { Module } from '@nestjs/common';

import { EventController } from './event.controller.js';
import { EventService } from './event.service.js';

@Module({
  controllers: [EventController],
  providers: [EventService],
})
export class EventModule {}
