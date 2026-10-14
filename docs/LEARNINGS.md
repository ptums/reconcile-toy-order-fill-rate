# Learnings: CSV bulk order update modernization

New concepts from the TWS-77 lessons. Each entry has the concept, how it applies to this project, and an interview answer. Written in ASD-STE100 style.

## At-least-once delivery

Lesson 1, part 2. Added 2026-10-13.

**Concept.** A message queue can send the same message more than once. A worker takes a message and confirms it (an *ack*) after the work is done. If the worker stops before the ack, the queue sends the message again.

**In this project.**

1. The upload makes one message for each CSV row.
2. A worker edits the order line, then writes `row: done` to the store, then sends the ack.
3. If the worker crashes after the edit but before the ack, the queue sends the row again.
4. Before each edit, the worker reads the row status. If the row is done, the worker skips it.

**Related concepts.**

- **Idempotency:** doing the same operation two times gives the same result as doing it one time.
- **Effectively-once processing:** at-least-once delivery plus idempotent workers. The queue alone cannot give exactly-once delivery.

**Interview answer.** "Our queue gives at-least-once delivery, so a message can come twice. We make each worker idempotent: it checks a per-row status before it edits, so a duplicate does nothing. Together that gives effectively-once processing."

## Async request-reply

Lesson 1, part 2. Added 2026-10-13.

**Concept.** An HTTP request is for short work. For long work, the API starts a background job and returns a job ID at once. The client asks for the job status later.

**In this project.** The 2021 server kept one request open for about 90 minutes (339 rows). The new API stores the file, creates a job and returns the job ID in less than 1 second. Workers do the rows.

## Stateless services and externalized state

Lesson 1, part 2. Added 2026-10-13.

**Concept.** A stateless service keeps no state in memory between requests. The state is in a shared, durable store.

**In this project.** More than one copy of the API runs in Kubernetes, and a copy can restart at any time. Job status and per-row status go in DynamoDB, so any copy can answer "status of job 42?" and a crashed job can continue.

## Leaky bucket rate limiting

Lesson 1, part 3. Added 2026-10-13.

**Concept.** The API gives each client a bucket of points. Each query costs points. The bucket refills at a fixed rate (the restore rate). When the bucket is empty, the API rejects queries with `THROTTLED`.

**In this project.** Every response has `extensions.cost.throttleStatus` with `maximumAvailable`, `currentlyAvailable` and `restoreRate`. The mock server copies this shape. (Real Shopify numbers: verify in the docs.)

**Wait formula.** Points needed = query cost − points available. Wait time = points needed ÷ restore rate. Example: cost 10, available 4, restore rate 50 per second: (10 − 4) ÷ 50 = 0.12 seconds. The bucket size (`maximumAvailable`) is not in the formula. It only sets the maximum that you can save.

**Simple explanation (high school level).** Think of an arcade game that costs tokens. You have a cup that holds up to 1,000 tokens. A machine drops 50 new tokens into your cup every second. Each game costs some tokens.

1. You want to play a game that costs 10 tokens.
2. You have 4 tokens in your cup. You need 6 more.
3. The machine gives you 50 tokens each second, so 6 tokens take 6 ÷ 50 = 0.12 seconds.
4. You wait 0.12 seconds, then you play.

The old code always waited 3 seconds before each game, even with a full cup. That is like standing at the machine for 3 seconds when you already have enough tokens. The new code counts the tokens first and waits only for the tokens it needs.

## Adaptive rate limiting and exponential backoff with jitter

Lesson 1, part 3. Added 2026-10-13.

**Concept.** Do not use fixed waits. Read the rate-limit data in each response and wait only when necessary. If the API still rejects a request, wait longer after each failure (for example 1 s, 2 s, 4 s), and add a random amount (jitter) so that many workers do not retry at the same time.

**In this project.** The 2021 code waited 3 to 5 seconds before each request. That was too slow when the bucket was full and too fast when many workers ran together.

**Interview answer.** "Fixed sleeps are wrong in both directions. We read the throttle status from each response, wait exactly long enough for the bucket to refill, and fall back to exponential backoff with jitter on a throttled error."

## Transient vs permanent errors

Lesson 1, part 4. Added 2026-10-13.

**Concept.** A transient error goes away by itself, so you retry it. A permanent error gives the same result each time, so you do not retry it.

| Error | Type | Action |
|---|---|---|
| `THROTTLED` | Transient | Retry with backoff |
| 503 or a network timeout | Transient | Check the row status, then retry |
| Order not found, SKU not in order | Permanent | Send to the DLQ now |
| Validation `userErrors` (for example a negative quantity) | Permanent | Send to the DLQ now. Better: reject the row when the CSV is uploaded |

**Timeout warning.** After a timeout, you do not know if the edit happened. The server can commit the edit and then lose the response. Before the retry, read the row status (idempotency, see "At-least-once delivery").

**Fail fast.** Check the CSV for bad data (negative quantities, empty SKUs) at upload time. Then a bad row never goes into the queue.

**Simple explanation (high school level).** You call a friend and the line is busy. You call again later, because a busy line is temporary. You call a number that is not in service. Calling again will not help, so you write it down and find the right number.

## Dead-letter queue (DLQ) and replay

Lesson 1, part 4. Added 2026-10-13.

**Concept.** A dead-letter queue holds messages that failed too many times or failed with a permanent error. It keeps the full message and the error. After a person fixes the cause, they replay the messages and the work runs again.

**In this project.** A worker retries a transient error up to 5 times with exponential backoff. Then, or at once for a permanent error, it publishes the row to the NATS subject `orders.dlq` with the error. The failure report comes from the DLQ. In 2021, every failure became "please update manually."

**Why.** One bad row does not block the other rows, and no failed row is lost.

**Simple explanation (high school level).** At the post office, a letter with a wrong address does not stop all the other mail. It goes to a special "problem mail" box. Someone checks that box later, fixes the address and sends the letter again.

**Interview answer.** "We split errors into transient and permanent. Transient errors retry with exponential backoff and jitter up to a limit. Permanent errors, and anything over the limit, go to a dead-letter queue with the error attached, so the main queue keeps moving and we can replay after a fix."

## Producer, consumer and worker

Lesson 1, part 5. Added 2026-10-13.

**Concept.** A producer puts messages on a queue. A consumer takes messages from the queue and does the work. A worker is a background program that runs all the time; it is usually a consumer. "Producer" and "consumer" are roles for one queue, so one program can have both roles.

**In this project.** The upload API is the producer: it publishes one message for each row. The Python worker is the consumer of `orders.edit.*`. When a row fails, the worker publishes to `orders.dlq`, so for that subject the worker is a producer.

**Simple explanation (high school level).** In a restaurant, the server puts order tickets on the kitchen rail (producer). The cooks take the tickets and cook (consumers, workers).

## Race condition and lost update

Lesson 1, part 5. Added 2026-10-13.

**Concept.** A race condition happens when the result depends on which of two parallel operations finishes first. A lost update is one type: two writers read the same starting record, and the second write removes the first write.

**In this project.** Two workers open edit sessions on order 1001 at the same time. Worker A commits. Worker B commits a session that never saw A's change, so A's change can be lost. This is the same problem as two people booking the same appointment slot.

**Fixes.** Partition by key (one order goes to one worker), optimistic locking (each write checks a version number), or batch per order (one edit session for all rows of the order).

## Partition key, hot partitions and rebalancing

Lesson 1, part 5. Added 2026-10-13.

**Concept.** The queue has a fixed number of partitions. It calculates a hash of each message's partition key to pick a partition. The same key always goes to the same partition, and each partition has exactly one consumer at a time. One consumer can own more than one partition.

**Names.** Kafka: message key. NATS: a subject token mapped to a partition (`orders.edit.1001`). DynamoDB: partition key. Databases: shard key. The area of study is data partitioning (sharding).

**Choosing a key.** Use the smallest unit that must never be edited twice at the same time. Here that is the order ID, because Shopify edits go through an order-level session. Do not split one order into chunks for different workers; that brings back the lost update.

**Hot partition.** One key has much more work than the others. In the sample, order 1001 has 243 rows and order 1002 has 98. Only 2 workers have work, and one finishes long before the other. To make a big order faster, use fewer calls (one edit session for the order), not more workers.

**Rebalancing.** The queue assigns partitions to consumers. When a consumer stops, the queue moves its partitions to another consumer. Do not assign partitions to workers by hand.

**Capacity limit.** Workers mostly wait for the API, so CPU is not the limit. All workers share one rate-limit bucket, so after a point more workers only cause more `THROTTLED` errors.

**Simple explanation (high school level).** A store has 4 checkout lanes. Families go to a lane by the first letter of their last name, so one family always uses the same lane and one cashier. If one family has a very full cart, that lane is slow. Opening more lanes does not help that family.

## Reconciliation, system of record and diff before write

Lesson 1, part 5. Added 2026-10-13.

**Concept.** Reconciliation makes one system match another. The system of record is the system that owns the data. Diff before write means: read the current value and write only when it is different.

**In this project.** The supplier report says what shipped. The store (the mock Shopify API) is the system of record for orders. Our databases only track the work. The worker reads the current line quantity and edits only if it is different. In the sample, 231 of 339 rows already match, so only 112 rows need an edit: about 67% less work.

**Interview answer.** "We treat the store as the system of record, and our job tables only track progress. Each worker diffs before it writes, so rows that already match cost one cheap read and no edit."

## Fan-out / fan-in and the single-writer principle

Lesson 1, part 5. Added 2026-10-13.

**Concept.** Fan-out splits work into independent pieces that run in parallel. Fan-in collects the results in one place. The single-writer principle says one thing (here, one order) has exactly one writer at a time. Rule: do the reads in parallel, and keep the writes to one thing in one place.

**In this project (two stages).**

1. **Diff stage (fan-out):** the producer splits each order's rows into batches. Subject: `orders.diff.<order>.<batch>`, for example `orders.diff.1001.3`. Many workers read the current quantities, validate the rows and compute the changes. They only read, so they cannot collide.
2. **Barrier:** each diff worker writes its changes and marks its batch done in DynamoDB. When all batches of an order are done, the last worker publishes one message to `orders.write.1001`.
3. **Write stage (fan-in):** one writer for each order applies all the changes in one edit session.

**Why not many writers on one order?** Optimistic locking works when conflicts are rare. Here every write to the order conflicts, so workers would only retry. Locks make workers wait in line, which is the same as one worker.

**Simple explanation (high school level).** A group project: each student researches one chapter at the same time (fan-out). One student types the final report (fan-in), so two people never type over each other in the same document.

**Interview answer.** "We fan out the read-heavy diff work by batch, since reads can't collide, then fan in to a single writer per order, partitioned by order ID. A completion counter acts as the barrier between the stages."

## Completion tracking: atomic counters and barriers

Lesson 1, part 5. Added 2026-10-13.

**Concept.** A barrier is a point where the system waits until all parallel work is finished. A counter is a simple way to build one. The counter must be atomic, it must not count a duplicate two times, and it must count failures.

**In this project.**

1. When the job starts, save the total on the job record: the number of **distinct orders** (2 in the sample), not the number of rows (339).
2. When an order is reconciled or sent to the DLQ, record that order as finished.
3. The job is finished when (distinct orders done + distinct orders failed) = total.

**The four rules.**

| Rule | What goes wrong without it |
|---|---|
| Count the right unit (orders, not rows) | The counter never reaches the total, or it reaches it too early |
| Increment atomically (DynamoDB `ADD`) | Two workers read 5, both write 6: a lost update, and the job never finishes |
| Count distinct orders, not events | At-least-once delivery reports an order two times, so "done" comes too early |
| Count failures too | An order in the DLQ is never "done", so the job never finishes (the 2021 hang, C3) |

**Trade-offs.**

| Option | Good | Bad |
|---|---|---|
| **Atomic counter** (`ADD done 1`) | One small item. Very cheap to read and write. | Counts events, not distinct orders. A duplicate delivery adds 1 again. Use it only with a dedup step before it. |
| **Set of finished order IDs on the job item** (`ADD finished {"1001"}`) | Adding an ID that is already in the set does nothing, so duplicates are safe. One read gives the count. | A DynamoDB item has a size limit (400 KB, verify). Good for thousands of orders, not millions. All workers write to one item, which is a hot key. |
| **One item for each order** (conditional `PutItem` if not exists, then a counter) | Scales to any size. The conditional write blocks duplicates. Each order has its own status for the report. | Two writes for each order. More code. |
| **Ask the queue** (pending messages in the NATS stream) | No extra table. | The queue does not know about failures in your app or about business rules. It ties job status to one queue product. |

**Default for this project.** One item for each order (conditional write) plus an atomic counter on the job item. It is safe against duplicates, it scales, and the per-order items also give the failure report. Do both writes in one DynamoDB transaction (`TransactWriteItems`). If they are two separate writes, a crash between them records the order but does not increment the counter.

**Consistency note.** DynamoDB reads are eventually consistent by default, so a status read can be slightly old. For the final "is the job finished?" check, use a strongly consistent read (`ConsistentRead=True`). This costs more, so use it only for that check.

**Simple explanation (high school level).** A teacher collects homework. Counting how many times a paper was handed in gives the wrong number if a student hands it in twice. A checklist of student names is better: checking a name two times changes nothing. Students who are absent are marked "absent", so the teacher can still finish the list.

**Worked example (high school level).** The teacher has 3 students: Ana, Ben and Cal. Before class, the teacher writes "total = 3" at the top of the checklist.

1. Ana hands in her paper. The teacher checks "Ana". Finished: 1 of 3.
2. Ana forgets she already did it and hands it in again. "Ana" is already checked, so nothing changes. Finished: still 1 of 3. (With a plain counter, it would say 2 of 3, which is wrong.)
3. Ben hands in his paper. Finished: 2 of 3.
4. Cal is sick. The teacher marks "Cal: absent". Absent counts as finished. Finished: 3 of 3.
5. 3 of 3, so the teacher stops waiting and grades the papers. Without the "absent" mark, the teacher would wait for Cal forever.

In the project: students are orders, handing in a paper is a worker finishing an order, the second hand-in is a duplicate message, and "absent" is an order in the DLQ.

**Interview answer.** "We save the expected total when the job starts. Each order writes its own completion record with a conditional put, so a duplicate delivery is a no-op, and that same write increments an atomic counter. Failures count toward the total. The final check uses a strongly consistent read."

## Observability: logs, metrics, traces

Lesson 1, part 6. Added 2026-10-13.

**Concept.** Observability means you can answer "what is happening, and why?" without new code. Logs are events (JSON with fields). Metrics are numbers over time. Traces follow one request through every service. A correlation ID (here, the job ID) connects all three.

**In this project.** Structured logs with `job`, `order`, `row`, `event` and `ms`. Metrics: rows done each minute, failures, `THROTTLED` count, consumer lag. Traces with OpenTelemetry from the API through NATS (trace context in the message headers) to the worker and the mock API. In 2021 the only signal was `console.log`.

**Reading the signals.**

| Consumer lag | `THROTTLED` | Bottleneck | Action |
|---|---|---|---|
| Going up | Near zero | Workers | Add workers, or find why each worker is slow |
| Going up | High | The API rate limit | Fewer workers or less concurrency, back off, make fewer calls |
| Flat or going down | Any | None | No change |

## Shared rate limiter and the thundering herd

Lesson 1, part 6. Added 2026-10-13.

**Scenario.** Five reports are uploaded at 9 AM. The autoscaler sees the lag and starts 20 workers. The API sustains about 5 edits each second (mock numbers); the workers try about 40. The bucket empties, every worker gets `THROTTLED`, they all back off and retry at the same moment (a thundering herd), and the work is slower than with 4 workers.

**Solution (Peter's).** Cap the workers at 4 and use a shared rate limiter.

1. **Shared limiter:** one token bucket in a shared store (Redis or DynamoDB) that copies the API's bucket. A worker takes tokens before each call. Workers wait for the limiter, not for a `THROTTLED` error.
2. **Cap the autoscaler:** scale on consumer lag, but set the maximum worker count from the API limit (sustained rate ÷ rate for one worker). More workers than that only wait.
3. **Jitter:** add a random delay to every retry, so workers do not retry together.
4. **Fairness:** take work from the 5 jobs in turn (round-robin), so one big job does not block the small ones.
5. **Fewer calls:** one edit session per order and diff before write give more finished rows for the same points.

**Simple explanation (high school level).** A water fountain gives one cup every second. If 20 people push to the fountain at once, nobody drinks faster and people spill water. Make a line with 4 places, give out numbered tickets, and let each group of friends take turns.

**Interview answer.** "When the downstream API is the bottleneck, scaling out makes it worse. We cap concurrency at what the rate limit supports, put a shared token bucket in front of the API, add jitter to retries, and round-robin across jobs for fairness."

## Protocol vs model, and dependency inversion

Lesson 2, part 1. Added 2026-10-13.

**Concept.** A model describes data: what an object has (fields). A protocol describes behavior: what an object can do (methods). A Python `typing.Protocol` uses structural typing: a class matches if its methods match, with no inheritance. The type checker (Pyright or mypy) checks it; Python does not check it at runtime. An abstract base class (ABC) is nominal: a class must inherit from it.

**In this project.** `StoreClient` (`packages/store_client/src/store_client/protocol.py`) is a protocol: anything with `execute()`. `ThrottleStatus` is a model (a dataclass). The worker depends on `StoreClient`, not on httpx or Shopify. Tests pass a fake; production passes `GraphQLStoreClient`. This is dependency inversion: code depends on an abstraction, not on a concrete class.

**Simple explanation (high school level).** A model is a form: "this record has a name and a quantity." A protocol is a job description: "whoever does this job must be able to run a query." The job description does not care who you are, only what you can do.

**Interview answer.** "The worker depends on a Protocol, so the mock store, real Shopify and a test fake are all interchangeable without inheritance. Models describe data; protocols describe behavior."
