import { Global, Module } from '@nestjs/common';

import { AmqpQueueClient } from './amqp/amqp-queue.client.js';
import { MESSAGE_PUBLISHER } from './message-publisher.js';
import { MESSAGE_SUBSCRIBER } from './message-subscriber.js';

@Global()
@Module({
  providers: [
    AmqpQueueClient,
    { provide: MESSAGE_PUBLISHER, useExisting: AmqpQueueClient },
    { provide: MESSAGE_SUBSCRIBER, useExisting: AmqpQueueClient },
  ],
  exports: [MESSAGE_PUBLISHER, MESSAGE_SUBSCRIBER],
})
export class QueueModule {}
