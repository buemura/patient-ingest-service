import type { PatientIngestMessage } from '../dto/patient-ingest.dto.js';

export const PATIENT_EVENT_PROCESSOR = Symbol('PATIENT_EVENT_PROCESSOR');

export interface PatientEventProcessor {
  process(event: PatientIngestMessage): Promise<void>;
}
