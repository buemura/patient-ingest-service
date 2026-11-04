import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import type {
  PatientRepository,
  PatientState,
} from '../../../../modules/patient/repositories/patient.repository.js';
import { isDuplicateKeyError } from '../mongo-errors.js';
import { Patient } from '../schemas/patient.schema.js';

@Injectable()
export class MongoosePatientRepository implements PatientRepository {
  constructor(
    @InjectModel(Patient.name) private readonly model: Model<Patient>,
  ) {}

  async upsertIfNewer(state: PatientState): Promise<boolean> {
    try {
      await this.model.updateOne(
        { patientId: state.patientId, lastEventAt: { $lt: state.lastEventAt } },
        { $set: state },
        { upsert: true },
      );
      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  }
}
