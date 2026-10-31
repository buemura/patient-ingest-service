import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // AppModule validates env on import; provide values so e2e runs without a .env file.
    env: {
      PORT: '3000',
      DATABASE_URL: 'mongodb://localhost:27017/patient-ingest-test',
      RABBITMQ_URL: 'amqp://localhost:5672',
      RABBITMQ_PREFETCH: '10',
    },
  },
});
