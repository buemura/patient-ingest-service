import type { ConsumeMessage, Message } from 'amqplib';

import type { IncomingMessage } from '../message-subscriber.js';

export const RETRY_COUNT_HEADER = 'x-retry-count';

export interface Acknowledger {
  ack(message: Message): void;
  nack(message: Message, allUpTo?: boolean, requeue?: boolean): void;
}

export type Republisher = (
  message: ConsumeMessage,
  retryCount: number,
) => Promise<void>;

export class AmqpIncomingMessage implements IncomingMessage {
  private settled = false;

  constructor(
    private readonly channel: Acknowledger,
    private readonly message: ConsumeMessage,
    private readonly republish: Republisher,
    private readonly maxRetries: number,
  ) {}

  get body(): Buffer {
    return this.message.content;
  }

  get retryCount(): number {
    return Number(this.message.properties.headers?.[RETRY_COUNT_HEADER] ?? 0);
  }

  ack(): void {
    if (this.claim()) this.channel.ack(this.message);
  }

  async retry(): Promise<void> {
    if (!this.claim()) return;

    if (this.retryCount >= this.maxRetries) {
      this.channel.nack(this.message, false, false);
      return;
    }

    try {
      await this.republish(this.message, this.retryCount + 1);
      this.channel.ack(this.message);
    } catch {
      this.channel.nack(this.message, false, true);
    }
  }

  deadLetter(): void {
    if (this.claim()) this.channel.nack(this.message, false, false);
  }

  private claim(): boolean {
    if (this.settled) return false;
    this.settled = true;
    return true;
  }
}
