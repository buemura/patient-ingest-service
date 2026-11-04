export const PATIENT_REPOSITORY = Symbol('PATIENT_REPOSITORY');

export interface PatientState {
  patientId: string;
  lastEventType: string;
  lastEventKey: string;
  lastEventAt: Date;
  data: Record<string, unknown>;
}

export interface PatientRepository {
  upsertIfNewer(state: PatientState): Promise<boolean>;
}
