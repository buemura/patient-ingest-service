import { createEventSchema } from './create-event.dto.js';

const valid = {
  patientId: 'p-1',
  type: 'vitals',
  data: { heartRate: 72 },
  ts: '2026-01-01T10:00:00.000Z',
};

describe('createEventSchema', () => {
  it('accepts a well-formed envelope', () => {
    expect(createEventSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts timestamps with a timezone offset', () => {
    const result = createEventSchema.safeParse({
      ...valid,
      ts: '2026-01-01T12:00:00+02:00',
    });

    expect(result.success).toBe(true);
  });

  it.each(['patientId', 'type', 'data', 'ts'])('requires %s', (field) => {
    const { [field]: _omitted, ...rest } = valid as Record<string, unknown>;

    expect(createEventSchema.safeParse(rest).success).toBe(false);
  });

  it.each([
    ['empty patientId', { patientId: '' }],
    ['blank type', { type: '   ' }],
    ['non-object data', { data: 'text' }],
    ['array data', { data: [1, 2] }],
    ['non-ISO timestamp', { ts: '01/01/2026' }],
    ['timestamp without timezone', { ts: '2026-01-01T10:00:00' }],
  ])('rejects %s', (_label, override) => {
    expect(createEventSchema.safeParse({ ...valid, ...override }).success).toBe(
      false,
    );
  });
});
