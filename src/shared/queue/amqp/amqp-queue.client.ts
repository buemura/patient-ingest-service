import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConsumeMessage } from 'amqplib';
import amqp, {
  type AmqpConnectionManager,
  type ChannelWrapper,
} from 'amqp-connection-manager';

import type { Env } from '../../../config/env.js';
import type { MessagePublisher } from '../message-publisher.js';
import type {
  MessageHandler,
  MessageSubscriber,
  SubscribeOptions,
} from '../message-subscriber.js';
import {
  AmqpIncomingMessage,
  RETRY_COUNT_HEADER,
} from './amqp-incoming-message.js';
import { assertPatientIngestTopology } from './patient-ingest.topology.js';

const PUBLISH_TIMEOUT_MS = 5_000;

@Injectable()
export class AmqpQueueClient
  implements
    MessagePublisher,
    MessageSubscriber,
    OnModuleInit,
    BeforeApplicationShutdown,
    OnApplicationShutdown
{
  private readonly logger = new Logger(AmqpQueueClient.name);
  private readonly inFlight = new Set<Promise<void>>();
  private connection: AmqpConnectionManager;
  private publishChannel: ChannelWrapper;
  private consumeChannel: ChannelWrapper;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async onModuleInit(): Promise<void> {
    this.connection = amqp.connect([
      this.config.get('RABBITMQ_URL', { infer: true }),
    ]);
    this.connection.on('connect', () =>
      this.logger.log('Connected to RabbitMQ'),
    );
    this.connection.on('disconnect', ({ err }) =>
      this.logger.warn(
        `Disconnected from RabbitMQ: ${err?.message ?? 'unknown reason'}`,
      ),
    );

    this.publishChannel = this.connection.createChannel({
      confirm: true,
      setup: assertPatientIngestTopology,
    });
    this.consumeChannel = this.connection.createChannel({
      setup: assertPatientIngestTopology,
    });

    await Promise.all([
      this.publishChannel.waitForConnect(),
      this.consumeChannel.waitForConnect(),
    ]);
  }

  async publish(
    queue: string,
    message: object,
    messageId: string,
  ): Promise<void> {
    await this.publishChannel.sendToQueue(
      queue,
      Buffer.from(JSON.stringify(message)),
      {
        persistent: true,
        contentType: 'application/json',
        messageId,
        timeout: PUBLISH_TIMEOUT_MS,
      },
    );
  }

  async subscribe(
    queue: string,
    handler: MessageHandler,
    { maxRetries }: SubscribeOptions,
  ): Promise<void> {
    const republish = (raw: ConsumeMessage, retryCount: number) =>
      this.publishChannel
        .sendToQueue(queue, raw.content, {
          ...raw.properties,
          persistent: true,
          headers: {
            ...raw.properties.headers,
            [RETRY_COUNT_HEADER]: retryCount,
          },
          timeout: PUBLISH_TIMEOUT_MS,
        })
        .then(() => undefined);

    await this.consumeChannel.consume(
      queue,
      (raw) =>
        this.track(
          handler,
          new AmqpIncomingMessage(
            this.consumeChannel,
            raw,
            republish,
            maxRetries,
          ),
        ),
      { prefetch: this.config.get('RABBITMQ_PREFETCH', { infer: true }) },
    );
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.consumeChannel?.cancelAll();
    if (this.inFlight.size > 0) {
      this.logger.log(`Draining ${this.inFlight.size} in-flight message(s)`);
    }
    await Promise.allSettled(this.inFlight);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.connection?.close();
  }

  private track(handler: MessageHandler, message: AmqpIncomingMessage): void {
    const work = handler(message)
      .catch((error: unknown) => {
        this.logger.error(
          'Unhandled error in message handler',
          error instanceof Error ? error.stack : String(error),
        );
        return message.retry();
      })
      .finally(() => this.inFlight.delete(work));
    this.inFlight.add(work);
  }
}
