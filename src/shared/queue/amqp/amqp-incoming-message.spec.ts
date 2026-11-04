import type { ConsumeMessage, Message } from 'amqplib';

import {
  type Acknowledger,
  AmqpIncomingMessage,
  type Republisher,
} from './amqp-incoming-message.js';

class FakeChannel implements Acknowledger {
  readonly calls: { method: 'ack' | 'nack'; requeue?: boolean }[] = [];

  ack(_message: Message) {
    this.calls.push({ method: 'ack' });
  }
  nack(_message: Message, _allUpTo?: boolean, requeue?: boolean) {
    this.calls.push({ method: 'nack', requeue });
  }
}

const raw = (headers: Record<string, unknown> = {}) =>
  ({
    content: Buffer.from('{}'),
    properties: { headers },
    fields: {},
  }) as unknown as ConsumeMessage;

const MAX_RETRIES = 3;

describe('AmqpIncomingMessage', () => {
  let channel: FakeChannel;
  let republished: number[];
  let republishFails: boolean;
  const republish: Republisher = async (_message, retryCount) => {
    if (republishFails) throw new Error('broker unavailable');
    republished.push(retryCount);
  };

  const incoming = (headers?: Record<string, unknown>) =>
    new AmqpIncomingMessage(channel, raw(headers), republish, MAX_RETRIES);

  beforeEach(() => {
    channel = new FakeChannel();
    republished = [];
    republishFails = false;
  });

  it('exposes the message body', () => {
    expect(incoming().body.toString()).toBe('{}');
  });

  it('reads how many times the message has been retried', () => {
    expect(incoming({ 'x-retry-count': 2 }).retryCount).toBe(2);
  });

  it('treats a first delivery as zero retries', () => {
    expect(incoming().retryCount).toBe(0);
  });

  it('acks', () => {
    incoming().ack();

    expect(channel.calls).toEqual([{ method: 'ack' }]);
  });

  it('retries by republishing with an incremented retry count, then acking the original', async () => {
    await incoming({ 'x-retry-count': 1 }).retry();

    expect(republished).toEqual([2]);
    expect(channel.calls).toEqual([{ method: 'ack' }]);
  });

  it('dead-letters instead of retrying once retries are exhausted', async () => {
    await incoming({ 'x-retry-count': MAX_RETRIES }).retry();

    expect(republished).toEqual([]);
    expect(channel.calls).toEqual([{ method: 'nack', requeue: false }]);
  });

  it('returns the original to the queue when the retry copy cannot be published', async () => {
    republishFails = true;

    await incoming().retry();

    expect(channel.calls).toEqual([{ method: 'nack', requeue: true }]);
  });

  it('dead-letters by rejecting without requeue', () => {
    incoming().deadLetter();

    expect(channel.calls).toEqual([{ method: 'nack', requeue: false }]);
  });

  it('settles a message only once', async () => {
    const message = incoming();

    message.ack();
    await message.retry();
    message.deadLetter();

    expect(channel.calls).toEqual([{ method: 'ack' }]);
    expect(republished).toEqual([]);
  });
});
