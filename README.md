# Patient Ingest Service

NestJS service that accepts patient events over HTTP, queues them in RabbitMQ, and processes them into MongoDB. It is built to tolerate duplicates, out-of-order delivery and crashes.
