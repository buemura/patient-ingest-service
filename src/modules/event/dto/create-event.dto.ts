import { z } from 'zod';

export const createEventSchema = z.object({
  patientId: z.string().trim().min(1).max(128),
  type: z.string().trim().min(1).max(64),
  data: z.record(z.string(), z.unknown()),
  ts: z.iso.datetime({ offset: true }),
});

export type CreateEventDto = z.infer<typeof createEventSchema>;
