# Patient Ingest Service

NestJS service that accepts patient events over HTTP, queues them in RabbitMQ, and processes them into MongoDB. It is built to tolerate duplicates, out-of-order delivery and crashes.

## Quick start

```bash
docker compose up -d --build          # MongoDB, RabbitMQ, 2 app replicas, nginx on :8080
pnpm install && pnpm load-test        # 1000 events/min for 60s, then verifies the result
```

```bash
curl -X POST localhost:8080/events -H 'content-type: application/json' \
  -d '{"patientId":"p-1","type":"vitals","data":{"hr":72},"ts":"2026-01-01T10:00:00Z"}'
# 202 {"status":"accepted","idempotencyKey":"p-1:vitals:1767261600000"}
```

API docs: `http://localhost:8080/docs` · RabbitMQ UI: `http://localhost:15672` (guest/guest).
Host ports can be changed with `APP_HOST_PORT`, `MONGO_HOST_PORT`, `RABBITMQ_HOST_PORT`, `RABBITMQ_MANAGEMENT_HOST_PORT`.

## Architecture

```
             ┌──────────── app replica ×2 ─────────────┐
sender ─► nginx ─► EventModule ── publish (confirmed) ──►  RabbitMQ  patient.ingest (quorum)
             │    POST /events → 202                    │      │ 3 retries exhausted / malformed
             │                                          │      ▼
             │    PatientModule ◄──── consume ───────────────  patient.ingest.dlq
             │      ├─ event_logs  (dedupe + audit)     │
             │      ├─ external system (~5s, simulated) │
             │      └─ patients    (latest state)       │
             └──────────────────────────────────────────┘           MongoDB
```

A modular monolith: every replica serves HTTP **and** consumes the queue.

```
src/
  modules/
    event/      POST /events, envelope validation, idempotency key, event-log port
    patient/    queue consumer, processing use case, patient repository port
    health/
  shared/
    queue/      MessagePublisher / MessageSubscriber ports + RabbitMQ adapter
    database/   Mongoose schemas and repository implementations
    filters/    global exception filter
```

Modules depend on interfaces (`EventLogRepository`, `PatientRepository`, `PatientEventProcessor`, `MessagePublisher`, `MessageSubscriber`). Mongoose and amqplib live only in `shared/`, so you can read and test the use cases without the infrastructure.

### Flow

1. **`POST /events`** validates the envelope (Zod, via `StandardSchemaValidationPipe`) and derives the idempotency key `patientId:type:epochMs(ts)`. It publishes a persistent message and waits for the broker's **publisher confirm**. Only then does it answer `202`. If the broker cannot be reached within 5s, it answers `503` so the sender retries.
2. **The consumer** (prefetch 50 per replica) validates the message, then runs `PatientService.handle`:
   1. `event_logs`: atomic upsert by idempotency key. A key already `processed` is acked as a duplicate and skipped.
   2. Call the external system (simulated 5s).
   3. `patients`: conditional upsert, applied only if the event's `ts` is newer than the stored `lastEventAt`.
   4. Mark the log entry `processed` with outcome `applied` or `stale`, then ack.
3. **Failures** are retried 3 times, then dead-lettered to `patient.ingest.dlq`. Malformed messages go straight to the DLQ.

## How each operating condition is handled

| Condition | Answer |
|---|---|
| **Sender needs an immediate answer** while processing takes ~5s | Accept-then-process. The HTTP path does validation plus one confirmed publish (p50 ≈ 9ms, p99 ≈ 30ms under load). |
| **1000 events/min, growing** | 1000/min × 5s ≈ 84 events in flight. 2 replicas × prefetch 50 = 100 slots. The work is I/O-bound waiting, so one Node process holds many slots. To scale, add replicas (`docker compose up --scale app=4`; nginx re-resolves) or raise the prefetch. The queue absorbs bursts. |
| **Duplicates / sender retries** | A deterministic idempotency key with a unique index on `event_logs`. The same request always returns the same key, and the event is recorded and applied once. |
| **Out-of-order arrival** | The patient state is last-writer-wins on the **event** timestamp. The write is a single atomic `updateOne({patientId, lastEventAt: {$lt: ts}}, …, {upsert})`, so a late older event cannot overwrite newer state, even when two consumers race. |
| **Never lose an event** | `202` only after a publisher confirm on a durable, replicated quorum queue. Messages are acked only after the work is persisted. A crash before the ack means redelivery. Retries republish a confirmed copy *before* acking the original. Dead-lettering uses `at-least-once`. |
| **Never count twice** | Redelivery is safe: the log upsert is idempotent and the patient write is conditional. An entry left `pending` by a crash is processed again; a `processed` one is skipped. |
| **Processes killed at arbitrary moments** | On SIGTERM: stop consuming, drain in-flight messages, then close connections (`stop_grace_period: 30s`). On SIGKILL: unacked messages return to the queue. The connection manager reconnects and re-attaches consumers. nginx retries another replica on connection errors and 502/503. |

## Decisions and trade-offs

- **The consumer writes the event log, not the HTTP endpoint.** The API depends only on RabbitMQ, so there is no dual write. Writing to Mongo and then publishing could leave a logged-but-never-queued event, and a deduplicating retry would then swallow it. *Cost:* duplicates travel through the queue and are only dropped at the consumer, and the log holds events that were processed or are being processed, not everything that was received.
- **Last-writer-wins on `ts`.** This is correct when an event carries the state it describes. If events were *deltas*, the right design would be to buffer and re-apply them in order per patient. The full event log is kept, so state can be rebuilt by replaying it. *Cost:* two different events for the same patient with an identical `ts` resolve to whichever arrived first.
- **Concurrency instead of per-patient ordering.** Events for one patient may be processed in parallel. Correctness comes from the conditional write, not from serialised consumption (no single-active-consumer, no partitioning). This keeps throughput independent of how traffic is spread across patients.
- **Retries are counted by the application, not the broker.** I tried quorum-queue `x-delivery-limit` first. On RabbitMQ 4.4, AMQP 0.9.1 `nack(requeue)` does not increment the delivery count, so failing messages looped forever. Retries are now an `x-retry-count` header: republish (confirmed), then ack. The policy (`maxRetries: 3`) sits next to the consumer that owns it. *Cost:* retries are immediate, with no backoff.
- **The external call is at-least-once.** If a crash lands after the 5s call but before the `processed` mark, the call happens again on redelivery. This is inherent without a transactional outbox at the external system, and is why the external system should accept the idempotency key.
- **The idempotency key is a readable concatenation, not a hash.** `patientId:type:epochMs` can be read in logs and Mongo without a lookup, and its length is bounded by the envelope limits. `patientId` and `type` are URI-encoded so a `:` inside them cannot shift the boundary: `("a:b","c")` ≠ `("a","b:c")`. The timestamp is normalised to epoch ms, so `10:00Z` and `12:00+02:00` are the same event.

## Testing

| Suite | Command | Needs | Covers |
|---|---|---|---|
| Unit | `pnpm test` | nothing | key derivation, validation, use case (dedupe, crash-redelivery, stale events, ordering), consumer ack/retry/DLQ decisions, AMQP settlement mapping, error responses |
| Integration | `pnpm test:integration` | nothing (in-memory mongod) | Mongo repositories: unique-index dedupe under 20 concurrent registers, conditional upsert under 30 racing out-of-order writes |
| E2E | `pnpm test:e2e` | `docker compose up -d mongodb rabbitmq` | full HTTP → RabbitMQ → Mongo flow, duplicates, out-of-order, **4 attempts then DLQ**, graceful shutdown drains in-flight work |
| Load | `pnpm load-test` | full stack | sustained rate, ~20% duplicates, shuffled order; asserts exactly-once, nothing pending, newest state per patient |

The e2e suite reads `E2E_DATABASE_URL` and `E2E_RABBITMQ_URL` when your infra runs elsewhere.

**Measured locally** (2 replicas, 5s processing, 1000 events/min for 60s, 20% duplicates, one replica `SIGKILL`ed for 15s mid-run): 1000/1000 accepted. 833/833 distinct events recorded exactly once, 0 pending, all 100 patients on their newest event. Everything settled 66s after the first request.

## What I would do with more time

- **Claim an event before calling the external system.** A replay that arrives while the original is still `pending` gets processed by a second worker. The stored result stays correct, but the external call runs twice (about 1% of events in load tests). The fix is a lease on the `event_logs` document: an atomic `findOneAndUpdate` claims it, and messages that find it held wait in a TTL queue that dead-letters back to the main queue. *Cost:* a crashed worker's event waits out the lease, and the downstream system should still deduplicate on the idempotency key.
- **Delayed retries with backoff** (a TTL'd retry queue that dead-letters back), so a struggling external system is not hammered.
- **A DLQ replay tool** and alerting on DLQ depth.
- **Observability:** metrics for queue depth, consumer lag, processing latency, and outcomes (applied/stale/duplicate); trace ids from request to consumer; structured JSON logs.
- **Readiness vs liveness:** `/health` only reports that the process is up. Readiness should check Mongo and RabbitMQ, so nginx stops routing to an instance that cannot publish.
- **Split the API and the workers** into separate deployments, so each scales on its own signal (request rate vs queue depth).
- **Backpressure:** cap the queue length and return `503` / `Retry-After` beyond it, instead of growing without bound.
- **Index management** through migrations rather than Mongoose `autoIndex` at startup; a TTL or archive policy for `event_logs`.
- **A Mongo replica set** in compose (production must have one for durability), and RabbitMQ as a 3-node cluster so quorum queues actually replicate.
