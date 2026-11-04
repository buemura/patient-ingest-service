import {
  BadRequestException,
  Controller,
  Get,
  type INestApplication,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter } from './all-exceptions.filter.js';

@Controller('boom')
class BoomController {
  @Get('http')
  http() {
    throw new BadRequestException(['ts must be an ISO-8601 date']);
  }

  @Get('unknown')
  unknown() {
    throw new Error('connection string mongodb://admin:secret@db leaked');
  }
}

describe('AllExceptionsFilter', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BoomController],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('preserves status and message of HTTP exceptions', async () => {
    const response = await request(app.getHttpServer())
      .get('/boom/http')
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: ['ts must be an ISO-8601 date'],
      path: '/boom/http',
      timestamp: expect.any(String),
    });
  });

  it('hides details of unexpected errors behind a generic 500', async () => {
    const response = await request(app.getHttpServer())
      .get('/boom/unknown')
      .expect(500);

    expect(response.body).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
      path: '/boom/unknown',
      timestamp: expect.any(String),
    });
  });
});
