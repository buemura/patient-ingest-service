import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

import mongoose from 'mongoose';

const { values: args } = parseArgs({
  options: {
    rate: { type: 'string', default: '1000' },
    duration: { type: 'string', default: '60' },
    patients: { type: 'string', default: '100' },
    duplicates: { type: 'string', default: '0.2' },
    url: { type: 'string', default: 'http://localhost:8080' },
    mongo: {
      type: 'string',
      default:
        'mongodb://admin:admin@localhost:27017/patient-ingest?authSource=admin',
    },
    'settle-timeout': { type: 'string', default: '180' },
  },
});

const ratePerMinute = Number(args.rate);
const durationSec = Number(args.duration);
const patientCount = Number(args.patients);
const duplicateRatio = Number(args.duplicates);
const settleTimeoutSec = Number(args['settle-timeout']);

interface PlannedEvent {
  patientId: string;
  type: string;
  data: Record<string, unknown>;
  ts: string;
}

const runId = randomUUID().slice(0, 8);

function planEvents(): PlannedEvent[] {
  const total = Math.round((ratePerMinute / 60) * durationSec);
  const unique = Math.round(total / (1 + duplicateRatio));
  const base = Date.UTC(2026, 0, 1);

  const events: PlannedEvent[] = Array.from({ length: unique }, (_, i) => {
    const patientId = `load-${runId}-${i % patientCount}`;
    const sequence = Math.floor(i / patientCount);
    return {
      patientId,
      type: 'vitals',
      data: { sequence },
      ts: new Date(base + sequence * 1000).toISOString(),
    };
  });

  const duplicates = Array.from(
    { length: total - unique },
    () => events[Math.floor(Math.random() * events.length)],
  );

  const all = [...events, ...duplicates];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

interface SendStats {
  accepted: number;
  failed: number;
  latenciesMs: number[];
}

async function send(event: PlannedEvent, stats: SendStats): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const started = performance.now();
    try {
      const response = await fetch(`${args.url}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5_000),
      });
      stats.latenciesMs.push(performance.now() - started);
      if (response.status === 202) {
        stats.accepted++;
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  stats.failed++;
}

async function sendAtRate(events: PlannedEvent[]): Promise<SendStats> {
  const stats: SendStats = { accepted: 0, failed: 0, latenciesMs: [] };
  const intervalMs = 60_000 / ratePerMinute;
  const inFlight: Promise<void>[] = [];
  const started = Date.now();

  for (const [i, event] of events.entries()) {
    const due = started + i * intervalMs;
    const wait = due - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    inFlight.push(send(event, stats));
    if (i % ratePerMinute === 0 && i > 0) {
      console.log(`  sent ${i}/${events.length}`);
    }
  }
  await Promise.all(inFlight);
  return stats;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
  );
}

async function verify(events: PlannedEvent[]): Promise<boolean> {
  const db = await mongoose.createConnection(args.mongo).asPromise();
  const logs = db.collection('event_logs');
  const patients = db.collection('patients');
  const runFilter = { patientId: { $regex: `^load-${runId}-` } };

  const expectedUnique = new Set(events.map((e) => `${e.patientId}|${e.ts}`))
    .size;
  const expectedLatest = new Map<string, string>();
  for (const e of events) {
    const current = expectedLatest.get(e.patientId);
    if (!current || e.ts > current) expectedLatest.set(e.patientId, e.ts);
  }

  console.log(
    `\nWaiting for ${expectedUnique} distinct events to be processed...`,
  );
  const deadline = Date.now() + settleTimeoutSec * 1000;
  let processed = 0;
  while (Date.now() < deadline) {
    processed = await logs.countDocuments({
      ...runFilter,
      status: 'processed',
    });
    process.stdout.write(`\r  processed ${processed}/${expectedUnique}`);
    if (processed >= expectedUnique) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  console.log();

  const logged = await logs.countDocuments(runFilter);
  const pending = await logs.countDocuments({
    ...runFilter,
    status: 'pending',
  });
  const wrongState: string[] = [];
  for await (const patient of patients.find(runFilter)) {
    const expected = expectedLatest.get(patient.patientId);
    if (patient.lastEventAt.toISOString() !== expected) {
      wrongState.push(patient.patientId);
    }
  }
  const patientCountStored = await patients.countDocuments(runFilter);
  await db.close();

  const checks: [string, boolean, string][] = [
    [
      'every distinct event recorded exactly once',
      logged === expectedUnique,
      `${logged}/${expectedUnique}`,
    ],
    ['no event left unprocessed', pending === 0, `${pending} pending`],
    [
      'every patient stored',
      patientCountStored === expectedLatest.size,
      `${patientCountStored}/${expectedLatest.size}`,
    ],
    [
      'every patient on its newest event',
      wrongState.length === 0,
      `${wrongState.length} wrong`,
    ],
  ];

  console.log('\nResults');
  for (const [label, ok, detail] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} (${detail})`);
  }
  return checks.every(([, ok]) => ok);
}

async function main(): Promise<void> {
  const events = planEvents();
  console.log(
    `Run ${runId}: ${events.length} requests over ${durationSec}s (${ratePerMinute}/min), ` +
      `${patientCount} patients, ~${Math.round(duplicateRatio * 100)}% duplicates`,
  );

  const started = Date.now();
  const stats = await sendAtRate(events);
  console.log(
    `\nSent in ${((Date.now() - started) / 1000).toFixed(1)}s: ${stats.accepted} accepted, ${stats.failed} failed; ` +
      `latency p50=${percentile(stats.latenciesMs, 0.5).toFixed(0)}ms ` +
      `p95=${percentile(stats.latenciesMs, 0.95).toFixed(0)}ms ` +
      `p99=${percentile(stats.latenciesMs, 0.99).toFixed(0)}ms`,
  );

  const ok = (await verify(events)) && stats.failed === 0;
  console.log(
    `\nTotal ${((Date.now() - started) / 1000).toFixed(1)}s — ${ok ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'}`,
  );
  process.exit(ok ? 0 : 1);
}

await main();
