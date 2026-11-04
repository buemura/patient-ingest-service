import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiTags } from '@nestjs/swagger';

import {
  type CreateEventDto,
  createEventSchema,
} from './dto/create-event.dto.js';
import { EventService } from './event.service.js';

@ApiTags('events')
@Controller('events')
export class EventController {
  constructor(private readonly eventService: EventService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'Event durably queued for processing' })
  async create(@Body({ schema: createEventSchema }) dto: CreateEventDto) {
    const { idempotencyKey } = await this.eventService.ingest(dto);

    return { status: 'accepted', idempotencyKey };
  }
}
