import type { PatientIngestMessage } from '../dto/patient-ingest.dto.js';
import type { PatientEventProcessor } from './patient-event-processor.js';

export class SimulatedPatientEventProcessor implements PatientEventProcessor {
  constructor(private readonly delayMs: number) {}

  async process(_event: PatientIngestMessage): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }
}
