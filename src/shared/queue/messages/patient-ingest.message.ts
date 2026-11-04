import { z } from 'zod';

export const patientIngestMessageSchema = z.object({
  idempotencyKey: z.string().min(1),
  patientId: z.string().min(1),
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  ts: z.iso.datetime(),
  receivedAt: z.iso.datetime(),
});

export type PatientIngestMessage = z.infer<typeof patientIngestMessageSchema>;
