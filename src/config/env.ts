import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .regex(
      /^mongodb(\+srv)?:\/\//,
      'must be a mongodb:// or mongodb+srv:// URL',
    ),
  RABBITMQ_URL: z
    .string()
    .regex(/^amqps?:\/\//, 'must be an amqp:// or amqps:// URL'),
  RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(50),
  PROCESSING_DELAY_MS: z.coerce.number().int().nonnegative().default(5000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
