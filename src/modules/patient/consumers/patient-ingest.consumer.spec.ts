import type {
  IncomingMessage,
  MessageHandler,
  MessageSubscriber,
  SubscribeOptions,
} from '../../../shared/queue/message-subscriber.js';
import type { PatientIngestMessage } from '../dto/patient-ingest.dto.js';
import {
  PATIENT_INGEST_MAX_RETRIES,
  PATIENT_INGEST_QUEUE,
} from '../../../shared/queue/queue.constants.js';
import type { PatientService } from '../patient.service.js';
import { PatientIngestConsumer } from './patient-ingest.consumer.js';

class FakeMessage implements IncomingMessage {
  settlement?: 'ack' | 'retry' | 'deadLetter';

  constructor(
    readonly body: Buffer,
    readonly retryCount = 0,
  ) {}

  ack() {
    this.settlement = 'ack';
  }
  async retry() {
    this.settlement = 'retry';
  }
  deadLetter() {
    this.settlement = 'deadLetter';
  }
}

class FakeSubscriber implements MessageSubscriber {
  readonly subscriptions = new Map<string, MessageHandler>();
  readonly options = new Map<string, SubscribeOptions>();

  async subscribe(
    queue: string,
    handler: MessageHandler,
    options: SubscribeOptions,
  ) {
    this.subscriptions.set(queue, handler);
    this.options.set(queue, options);
  }
}

const validMessage: PatientIngestMessage = {
  idempotencyKey: 'key-1',
  patientId: 'p-1',
  type: 'vitals',
  data: { heartRate: 72 },
  ts: '2026-01-01T10:00:00.000Z',
  receivedAt: '2026-01-01T10:00:01.000Z',
};

const encode = (value: unknown) => Buffer.from(JSON.stringify(value));

describe('PatientIngestConsumer', () => {
  let subscriber: FakeSubscriber;
  let handled: PatientIngestMessage[];
  let failWith: Error | undefined;
  let consumer: PatientIngestConsumer;

  beforeEach(async () => {
    subscriber = new FakeSubscriber();
    handled = [];
    failWith = undefined;
    const service = {
      handlePatientIngest: async (event: PatientIngestMessage) => {
        if (failWith) throw failWith;
        handled.push(event);
        return 'applied';
      },
    } as unknown as PatientService;

    consumer = new PatientIngestConsumer(subscriber, service);
    await consumer.onApplicationBootstrap();
  });

  const deliver = async (message: FakeMessage) => {
    await subscriber.subscriptions.get(PATIENT_INGEST_QUEUE)!(message);
    return message;
  };

  it('subscribes to the patient ingest queue on startup', () => {
    expect(subscriber.subscriptions.has(PATIENT_INGEST_QUEUE)).toBe(true);
  });

  it('allows a failed message to be retried 3 times', () => {
    expect(subscriber.options.get(PATIENT_INGEST_QUEUE)).toEqual({
      maxRetries: PATIENT_INGEST_MAX_RETRIES,
    });
    expect(PATIENT_INGEST_MAX_RETRIES).toBe(3);
  });

  it('acknowledges a message once it has been handled', async () => {
    const message = await deliver(new FakeMessage(encode(validMessage)));

    expect(handled).toEqual([validMessage]);
    expect(message.settlement).toBe('ack');
  });

  it('asks for a retry when handling fails', async () => {
    failWith = new Error('external system down');

    const message = await deliver(new FakeMessage(encode(validMessage), 1));

    expect(message.settlement).toBe('retry');
  });

  it('dead-letters a message that is not valid JSON without retrying', async () => {
    const message = await deliver(new FakeMessage(Buffer.from('{not json')));

    expect(handled).toEqual([]);
    expect(message.settlement).toBe('deadLetter');
  });

  it('dead-letters a message that breaks the queue contract without retrying', async () => {
    const message = await deliver(
      new FakeMessage(encode({ ...validMessage, idempotencyKey: undefined })),
    );

    expect(handled).toEqual([]);
    expect(message.settlement).toBe('deadLetter');
  });
});
