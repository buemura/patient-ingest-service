import { buildIdempotencyKey } from './idempotency-key.js';

describe('buildIdempotencyKey', () => {
  it('is deterministic for the same patientId, type and timestamp', () => {
    const a = buildIdempotencyKey('p-1', 'vitals', '2026-01-01T10:00:00.000Z');
    const b = buildIdempotencyKey('p-1', 'vitals', '2026-01-01T10:00:00.000Z');

    expect(a).toBe(b);
  });

  it('treats the same instant in different timezone notations as equal', () => {
    const utc = buildIdempotencyKey('p-1', 'vitals', '2026-01-01T10:00:00Z');
    const offset = buildIdempotencyKey(
      'p-1',
      'vitals',
      '2026-01-01T12:00:00.000+02:00',
    );

    expect(utc).toBe(offset);
  });

  it('differs when any component differs', () => {
    const base = buildIdempotencyKey('p-1', 'vitals', '2026-01-01T10:00:00Z');

    expect(
      buildIdempotencyKey('p-2', 'vitals', '2026-01-01T10:00:00Z'),
    ).not.toBe(base);
    expect(buildIdempotencyKey('p-1', 'labs', '2026-01-01T10:00:00Z')).not.toBe(
      base,
    );
    expect(
      buildIdempotencyKey('p-1', 'vitals', '2026-01-01T10:00:00.001Z'),
    ).not.toBe(base);
  });

  it('cannot be forged by shifting separators between components', () => {
    const a = buildIdempotencyKey('p:1', 'vitals', '2026-01-01T10:00:00Z');
    const b = buildIdempotencyKey('p', '1:vitals', '2026-01-01T10:00:00Z');

    expect(a).not.toBe(b);
  });

  it('concatenates patientId, type and epoch milliseconds', () => {
    const key = buildIdempotencyKey('p-1', 'vitals', '2026-01-01T10:00:00Z');

    expect(key).toBe('p-1:vitals:1767261600000');
  });
});
