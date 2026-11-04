import type { Channel } from 'amqplib';

import {
  PATIENT_INGEST_DLQ,
  PATIENT_INGEST_DLX,
  PATIENT_INGEST_QUEUE,
} from '../queue.constants.js';

export async function assertPatientIngestTopology(
  channel: Channel,
): Promise<void> {
  await channel.assertExchange(PATIENT_INGEST_DLX, 'direct', { durable: true });
  await channel.assertQueue(PATIENT_INGEST_DLQ, {
    durable: true,
    arguments: { 'x-queue-type': 'quorum' },
  });
  await channel.bindQueue(
    PATIENT_INGEST_DLQ,
    PATIENT_INGEST_DLX,
    PATIENT_INGEST_QUEUE,
  );

  await channel.assertQueue(PATIENT_INGEST_QUEUE, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': PATIENT_INGEST_DLX,
      'x-dead-letter-routing-key': PATIENT_INGEST_QUEUE,
      'x-dead-letter-strategy': 'at-least-once',
      'x-overflow': 'reject-publish',
    },
  });
}
