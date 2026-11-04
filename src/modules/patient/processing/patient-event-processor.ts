import type { PatientIngestMessage } from '../../../shared/queue/messages/patient-ingest.message.js';

export const PATIENT_EVENT_PROCESSOR = Symbol('PATIENT_EVENT_PROCESSOR');

export interface PatientEventProcessor {
  process(event: PatientIngestMessage): Promise<void>;
}
