import { Test } from '@nestjs/testing';

import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('returns ok status', () => {
    expect(controller.healthCheck()).toEqual({ status: 'ok' });
  });
});
