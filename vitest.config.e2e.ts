import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: {
      PORT: '3000',
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ??
        'mongodb://admin:admin@localhost:27017/patient-ingest-e2e?authSource=admin',
      RABBITMQ_URL:
        process.env.E2E_RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
      RABBITMQ_PREFETCH: '10',
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
