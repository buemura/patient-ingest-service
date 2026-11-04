const SEPARATOR = ':';

export function buildIdempotencyKey(
  patientId: string,
  type: string,
  ts: string,
): string {
  const epochMs = new Date(ts).getTime();

  return [
    encodeURIComponent(patientId),
    encodeURIComponent(type),
    epochMs,
  ].join(SEPARATOR);
}
