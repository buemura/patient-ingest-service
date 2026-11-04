import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { z } from 'zod';

import type {
  IncomingMessage,
  MessageSubscriber,
} from './message-subscriber.js';

export abstract class QueueConsumer<T> implements OnApplicationBootstrap {
  protected abstract readonly queue: string;
  protected abstract readonly schema: z.ZodType<T>;
  protected abstract readonly maxRetries: number;

  protected readonly logger = new Logger(this.constructor.name);

  constructor(private readonly subscriber: MessageSubscriber) {}

  protected abstract handle(payload: T): Promise<unknown>;

  protected describe(_payload: T): string {
    return '';
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.subscriber.subscribe(
      this.queue,
      (message) => this.onMessage(message),
      { maxRetries: this.maxRetries },
    );
    this.logger.log(`Consuming ${this.queue}`);
  }

  private async onMessage(message: IncomingMessage): Promise<void> {
    const payload = this.parse(message.body);
    if (payload === undefined) {
      message.deadLetter();
      return;
    }

    try {
      await this.handle(payload);
      message.ack();
    } catch (error) {
      this.logger.warn(
        `Processing failed ${this.describe(payload)} retry=${message.retryCount}/${this.maxRetries}: ${errorMessage(error)}`,
      );
      await message.retry();
    }
  }

  private parse(body: Buffer): T | undefined {
    let json: unknown;
    try {
      json = JSON.parse(body.toString());
    } catch {
      this.logger.error('Unparseable message dead-lettered');
      return undefined;
    }

    const result = this.schema.safeParse(json);
    if (!result.success) {
      this.logger.error(
        `Invalid message dead-lettered: ${result.error.message}`,
      );
      return undefined;
    }
    return result.data;
  }
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
