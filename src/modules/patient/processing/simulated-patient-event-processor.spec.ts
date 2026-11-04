import type { PatientIngestMessage } from '../../../shared/queue/messages/patient-ingest.message.js';
import { SimulatedPatientEventProcessor } from './simulated-patient-event-processor.js';

const event = { idempotencyKey: 'key-1' } as PatientIngestMessage;

describe('SimulatedPatientEventProcessor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes the configured delay to complete', async () => {
    const processor = new SimulatedPatientEventProcessor(5000);
    let done = false;

    const pending = processor.process(event).then(() => (done = true));

    await vi.advanceTimersByTimeAsync(4999);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toBe(true);
  });
});
