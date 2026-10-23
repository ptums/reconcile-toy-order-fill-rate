# Learnings

Peter's questions while he builds the reconciler from scratch in TypeScript, with the answers. Newest at the bottom. Written in ASD-STE100 style.

The build plan:

1. The mock API server (a subset of the Toy-Shop Admin GraphQL API)
2. The queue package (NATS)
3. The CLI client: `reconcile.ts --file=<report>.csv`
4. The cloud infrastructure in AWS (aws cli)

## Questions

### Q1. What system design ideas are in the `orders` query? (Part 1, piece 5)

Asked 2026-10-18, before piece 5.

1. **Pagination (connections).** `edges { node }` and `first` limit the size of each response. Order #1001 has 243 lines. Without a limit, one response can be very large. Toy-Shop uses cursor pagination: each edge has a cursor, and the next page starts after it. Offset pagination (`page=3`) is simpler, but it skips or repeats items when data changes between pages.
2. **The client chooses the work.** In GraphQL, the client decides how much data to ask for. `lineItems(first: 250)` costs the server more than `first: 2`. For this reason, Toy-Shop gives each query a cost and rate-limits by cost, not by request count. The mock gets this later (the leaky bucket).
3. **The N+1 problem.** `Order.lineItems` is a resolver for each order. With 50 orders and a database, that is 1 query for the orders plus 50 queries for the lines. The fix is batching: collect the 50 order IDs, then make 1 query (the DataLoader pattern). Here the data is in memory, so there is no cost.
4. **Indexes.** `orders.filter(...)` reads every order (O(n)). With 2 orders, that is fine. With 1 million, use a `Map` keyed by name. That is the same idea as a database index: more memory, faster lookups.
5. **The schema is a contract.** The mock copies Toy-Shop's names and shapes. The client code then works with the real Toy-Shop API by a change of URL and token. This is the adapter pattern, and contract tests check that the two sides agree.
6. **In-memory state.** The orders live in the server's memory. A restart loads them again from the CSV (not durable), and two copies of the server have two different sets of orders (not shared). That is acceptable for a mock, but not for a real system of record.

**Interview answer.** "GraphQL lets the client pick the shape and size of the response, so we bound lists with cursor pagination, price queries by cost for rate limiting, and batch nested resolvers to avoid N+1 queries."

### Q2. Is an order edit "open a session, then make the edits in a follow-up call"? (Part 1, piece 6a)

Asked 2026-10-19, after piece 6a.

Yes, with one more step. An edit has 3 calls, not 2:

1. **`orderEditBegin`** opens the session. It returns a `CalculatedOrder`: a draft copy of the order lines.
2. **`orderEditSetQuantity`** stages a change on the draft. You can call it many times, one time for each line. The real order does not change.
3. **`orderEditCommit`** applies all the staged changes to the real order at once.

Why Toy-Shop uses this design:

- **Atomicity (all or nothing).** 40 line changes become one change to the order. A failure in the middle leaves the order as it was, not half edited. This is the same idea as a database transaction (`BEGIN`, the writes, `COMMIT`).
- **Preview.** The draft shows the new totals before anything is final.
- **One event.** The commit makes one order update, so the customer gets one email and the history has one entry, not 40.

A TypeScript comparison: `git add` stages changes, and `git commit` applies them as one unit.

**Interview answer.** "Toy-Shop order edits are transactional: begin returns a draft, set-quantity stages changes on it, and commit applies them atomically, so a multi-line change is all or nothing and produces one update."

**Follow-up (Peter): "It is the same approach as git."** The full mapping: `orderEditBegin` is a fresh working copy, `orderEditSetQuantity` is an edit plus `git add`, and `orderEditCommit` is `git commit` and `git push` in one step. One difference: git rejects a push when someone else pushed first (you must pull and merge). Toy-Shop does not check, so the last commit wins. Git uses optimistic concurrency control (detect the conflict at write time). Our mock does what Toy-Shop does, and part 2 prevents the conflict instead: one writer for each order.

### Q3. What is the common term for this process (begin, stage, commit)? (Part 1, piece 6a)

Asked 2026-10-19, after piece 6a.

1. **Transaction.** The general term. A group of changes that succeeds or fails as one unit. Databases give it the ACID properties; atomicity is the "all or nothing" part.
2. **Unit of Work pattern.** The name in application code (Martin Fowler, *Patterns of Enterprise Application Architecture*). An object records the changes, then writes them all at the end. ORMs use it: Hibernate's `Session`, Entity Framework's `DbContext.SaveChanges()`, MikroORM's `em.flush()` in TypeScript.
3. **Draft and publish (staging).** The name in content systems. Contentful, which Jess's site uses, works this way: you edit a draft, then publish it.

Do not confuse it with **two-phase commit (2PC)**. 2PC is a protocol that makes several separate systems commit one transaction together. Here only one system (the store) takes part.

**Interview answer.** "An order edit is a transaction exposed through an API, the Unit of Work pattern: begin returns a draft, changes are staged on it, and commit applies them atomically."

### Q4. What are the ACID properties? (Part 1, piece 6a)

Asked 2026-10-19, after piece 6a. The 4 promises a transaction gives, and how the mock store compares:

| Property | Meaning | The mock store |
|---|---|---|
| **Atomicity** | All the changes apply, or none apply | Yes, after 6c: commit applies all the staged lines at once |
| **Consistency** | A transaction moves the data from one valid state to another valid state. Rules (for example "quantity is not negative") are never broken | Piece 7: a bad change returns a userError and changes nothing |
| **Isolation** | Transactions that run at the same time do not see each other's half-done work | Partly: each session edits its own copy. But the last commit wins, so one session can overwrite another (a "lost update") |
| **Durability** | After a commit, the change survives a crash or restart | No: the orders live in memory. A restart loads the CSV again |

**Interview answer.** "ACID: atomicity is all-or-nothing, consistency keeps invariants valid, isolation stops concurrent transactions from seeing each other's partial work, and durability means a committed change survives a crash."

### Q5. Why does the edit session work? Explain it for a high school student. (Part 1, piece 6c)

Asked 2026-10-19, after piece 6c passed (the 2-session test gave 5 and 9).

Think of the order as the **master sign-up sheet** on the teacher's desk.

1. **Begin.** Two students each get a photocopy of the sheet. They write on their own copy, so the master stays clean.
2. **Set quantity.** Each student changes one line on their copy and **circles** it. The circle says "I changed this one."
3. **Commit.** The teacher copies only the circled lines onto the master, then throws the photocopy away.

Student A circled line 1 (5). Student B circled line 2 (9). The master gets both changes. Without the circles, the teacher copies B's whole sheet, and B's old line 1 (15) erases A's 5. That is the "lost update."

If both students circle the same line, the last one to hand in the sheet wins. That is Peter's rule.

In the code: the photocopy is `session.lineItems`, the circles are `session.changed`, and the teacher is `orderEditCommit`. Sending only what changed (the difference, not the whole thing) is called a **delta** or a **patch**. HTTP `PATCH` and `git diff` use the same idea.

**Interview answer.** "Each edit session works on a snapshot and records which lines it touched; commit applies only those deltas, so concurrent sessions on different lines don't overwrite each other, and conflicts on the same line resolve as last-writer-wins."

### Q6. In the leaky bucket, if 38 points are left after a second passes, does it go back to 40? (Part 1, piece 8)

Asked 2026-10-19, before piece 8.

No. It goes **up to 88** (38 + 50). The bucket does not reset each second. It refills all the time, at 50 points per second, up to the maximum of 1,000. Unused points carry over until the bucket is full.

Two different designs:

| | Fixed window | Leaky bucket (Toy-Shop) |
|---|---|---|
| Rule | "50 points per second." A new second resets the count | "1,000 points, refilled at 50 per second" |
| Unused points | Lost at the end of the second | Kept, up to 1,000 |
| Bursts | Max 50 at once | Up to 1,000 at once, after a quiet period |
| Weak point | A client can send 50 at 0.99 s and 50 at 1.01 s: 100 in 0.02 s | None at the window edge |

How the server knows the time: it does not run a timer. It saves `available` and `lastUpdate` (a timestamp) for each bucket. On each request, it calculates the refill from the time that passed: `available = min(1000, available + secondsSince(lastUpdate) * 50)`. This is called **lazy refill**. Peter's idea of a timestamp and the system clock is this method, on the server side.

**Interview answer.** "A leaky or token bucket refills continuously and caps at a maximum, so it allows bursts after idle time without the edge spikes of a fixed window. You implement it lazily: store the level and a timestamp, and compute the refill on each request."

### Q7. If a test uses the current time, doesn't each run get a fresh second? (Part 1, piece 9c)

Asked 2026-10-21, before piece 9c.

Yes, and that is the problem. With `Date.now()`, the test does not control the time. A test that checks "50 points after 1 second" must then really wait 1 second, and the result depends on how fast the computer is. A slow run gets 52 points and fails. This is a **flaky test**: it passes and fails with no change to the code. It is also slow.

The fix is **clock injection**. `refill` and `take` take `now` as a parameter, with `Date.now()` as the default. The server passes nothing, so it uses the real clock. A test passes plain numbers: `take("t", 1000, 0)` empties the bucket at time 0, and `refill("t", 1000)` is "1 second later". The test controls time, so the result is the same on every run. Vitest also has fake timers (`vi.useFakeTimers()`), but a parameter is simpler and has no global state.

**Interview answer.** "I inject the clock as a parameter, so tests pass fixed timestamps. Tests that read the real clock are slow and flaky, and time-dependent logic should be deterministic under test."

### Q8. Shouldn't the worker do 1 edit at a time? (Part 2, before piece 10)

Asked 2026-10-21, before piece 10.

Yes, for each order. Piece 15 makes sure that only 1 worker edits a given order at a time, so 2 edits to one order never overlap. But "1 at a time" does not stop duplicates. A duplicate comes from **redelivery**, not from 2 workers at the same time:

1. The worker gets "set line 10011 to 5".
2. The worker commits the edit. The order now has 5.
3. The worker crashes before it sends the ack.
4. NATS did not get an ack, so it sends the same message again later.

The second delivery comes after the first is finished, one at a time, and it is still a duplicate. This is why at-least-once delivery means that the work must be safe to do 2 times. This property is called **idempotency**.

**Interview answer.** "Serializing work per key prevents concurrent conflicts, but not duplicates. At-least-once delivery redelivers any message whose ack was lost, so the handler itself must be idempotent."

### Q9. What is SQS FIFO, and what does "it implements the interface on AWS" mean? (Part 2, before piece 11)

Asked 2026-10-21, before piece 11.

**SQS** (Simple Queue Service) is the managed queue on AWS. AWS runs the servers, and you pay for each request. A **FIFO** queue (first in, first out) keeps the order of messages in each **message group**, and it removes duplicate sends with the same deduplication ID within 5 minutes.

"Implements the interface" means that we write 2 classes with the same methods: `NatsQueue` for local work and `SqsQueue` for AWS. The CLI and the worker call `queue.publish(...)` and do not know which one runs. That is the adapter pattern.

The same ideas in each system:

| Idea | NATS JetStream | SQS FIFO |
|---|---|---|
| Where messages wait | A stream | A queue |
| "I'm done" | `ack()` | `DeleteMessage` |
| Redelivery after a crash | No ack before the ack wait time | The visibility timeout ends |
| One writer for each order | A subject for each order (piece 15) | `MessageGroupId` = the order ID |
| Messages that fail too often | A dead-letter subject (piece 14) | A dead-letter queue (`maxReceiveCount`) |

**Interview answer.** "I put a small Queue interface in front of the broker. NATS JetStream backs it locally and SQS FIFO backs it on AWS, with the message group ID as the partition key, so one order is processed in order by one consumer."

### Q10. Is each row update its own session, and can the session ID find duplicates? (Part 2, before piece 11)

Asked 2026-10-21, before piece 11.

**In this plan, yes, each row is its own session.** One message is one row, so the worker runs begin, set quantity and commit for that row. That costs 3 mutations (30 points) for each row. One session for each order with many lines costs fewer calls (begin and commit 1 time), but then one message must carry many rows. Part 3 can batch if the cost is too high.

**The session ID can't find duplicates.** Toy-Shop makes the session ID in `orderEditBegin`, inside the worker, after the message was sent. A redelivered message runs begin again and gets a new session ID. So 2 deliveries of the same row have 2 different session IDs. The ID must come from the row itself, before the message is sent: for example `<report file>:<row number>`. This is a **deduplication key** (or idempotency key). SQS FIFO uses it as `MessageDeduplicationId`, and NATS uses it as the `Nats-Msg-Id` header.

**Interview answer.** "The idempotency key must be stable across retries, so it comes from the source record, not from anything the consumer generates. A server-generated session ID changes on every attempt."

### Q11. What is happening in part 2? Explain it for a high school student. (Part 2, before piece 11)

Asked 2026-10-21, before piece 11.

Think of a busy diner kitchen.

1. **The report is a stack of order slips.** Each slip is one row: "table 1001, item 8876963, make it 5."
2. **The queue is the ticket rail.** The CLI puts every slip on the rail. Cooks take slips off the rail one at a time.
3. **The worker is a cook.** The cook makes the change in Toy-Shop (begin, set quantity, commit).
4. **The ack is spiking the slip** on the "done" spike. Only then does the slip leave the kitchen.
5. **Spike after cooking, not before.** If the cook spikes first and then trips, the slip is gone and the food never gets made. If the cook cooks first and trips before spiking, the slip goes back on the rail and another cook makes it again. A second plate is better than no plate.
6. **"Make it 5", not "add 3".** If the slip is made 2 times, "make it 5" still gives 5. "Add 3" gives 6 extra. That is idempotency.
7. **A number on each slip** (`report.csv:7`) lets the kitchen see "we already did slip 7". The cook's own receipt number can't do that, because it is new each time.
8. **One cook for each table** (piece 15), so 2 cooks never change the same table's order at the same time.

The message shape is the slip: `id` (the slip number), `orderId` (the table), `sku` (the item), `quantity` (make it this many).

### Q12. Where does http://localhost:8222 come from? (Part 2, piece 12a)

Asked 2026-10-21, after piece 12a.

From 2 lines in `docker-compose.yml`:

1. `-m 8222` in `command` turns on the NATS **monitoring server**, a small read-only HTTP server inside NATS.
2. `"8222:8222"` in `ports` connects port 8222 on the laptop to port 8222 in the container.

NATS uses 2 ports. **4222** is the client port: the code connects there with the NATS protocol, not HTTP. **8222** is for people and tools to look in, with HTTP and JSON. Useful pages:

- `/healthz`: is the server up (piece 10)
- `/jsz?streams=true`: the streams and their message counts (piece 12a)
- `/connz`: the connected clients
- `/varz`: the server settings and stats

The monitoring port has no login, so it stays on localhost and is never open to the internet. Production systems read the same pages with Prometheus to make dashboards.

### Q13. Can part 4 run on local AWS copies, with no AWS sign-up? (Part 4, asked before part 3)

Asked 2026-10-21, before part 3.

Yes, for most of it. Each AWS service has a local copy that runs in Docker:

- **DynamoDB:** DynamoDB Local, from AWS. The same API, on the laptop.
- **SQS (also FIFO):** ElasticMQ, an open-source server with the SQS API. The AWS SDK points to it with an `endpoint` setting.
- **S3:** S3Mock or MinIO. Both have the S3 API.
- **Lambda:** AWS SAM CLI (`sam local invoke`) runs the function in a Docker container.
- **All in one:** LocalStack copies many services, but from version 2026.03.0 it needs a LocalStack auth token. The free Hobby plan is for non-commercial use. That is a LocalStack account, not an AWS account.

The code does not change between local and real AWS. Only the `endpoint` and the credentials change (the adapter pattern again). The limit: a local copy does not test IAM permissions, real limits or real costs. Interview answer: "I develop against local emulators and run 1 deploy to real AWS to prove IAM and the infrastructure."

This project already has an AWS profile (`reconciler`) and the $5 budget, so the real deploy is still possible at the end.

### Q14. What does `for (;;)` mean? Does it run all the time? (Part 3, piece 19)

Asked 2026-10-21, at piece 19.

`for (;;)` is a loop with no start, no condition and no step, so it never stops by itself. It is the same as `while (true)`. The loop body must leave with `return` or `throw`.

In `withThrottle`, each pass does 1 of 3 things:

1. The store answers with no THROTTLED error: `return` the answer. The loop ends.
2. The query costs more than a full bucket: `throw`. Waiting can never fix it, so the loop ends.
3. THROTTLED: `sleep` for (cost − available) ÷ restoreRate seconds, then go to the top and send again.

It does not "run all the time". It sleeps between tries, so it uses no CPU while it waits. Usually the second try works. If another client with the same token used the points in the meantime, it waits again.

A correction to the first idea: `withThrottle` does not throttle. The **store** throttles (the leaky bucket from piece 8). `withThrottle` reacts: it reads the bucket numbers in the THROTTLED answer and waits only as long as necessary. Interview answer: "The server enforces the limit; the client respects it with a calculated backoff, not a fixed sleep."

### Q15. Where does the `AWS_ACCESS_KEY_ID=local ... aws sqs list-queues` line go? (Part 4, piece 23)

Asked 2026-10-21, at piece 23.

In the terminal, as 1 command. It is not for a file. Run it from any folder, after `docker compose up -d`.

`NAME=value` words before a command set environment variables **for that 1 command only**. When the command ends, they are gone, and the shell is the same as before. So:

- `AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local`: fake keys. ElasticMQ accepts any keys. They also stop the CLI from using the real `reconciler` profile.
- `AWS_REGION=us-east-2`: the AWS SDK and CLI need a Region, even for a local copy.
- `--endpoint-url http://localhost:9324`: send the request to ElasticMQ on the laptop, not to AWS.

The same idea comes back in the SQS adapter: the code reads `endpoint` and the keys from env vars, so only the env vars change between local and real AWS.

### Q16. How does SQS tie into NATS and JetStream? (Part 4, piece 24)

Asked 2026-10-21, at piece 24.

Both are adapters for the same `Queue` interface (`queue/queue.ts`). The worker and the CLI only know the interface, so they do not change. `QUEUE=sqs` picks SQS; the default is NATS. This is the adapter pattern from part 2.

| Idea | NATS JetStream (`nats.ts`) | SQS FIFO (`sqs.ts`) |
|---|---|---|
| Where messages live | Stream `ROWS`, WorkQueue retention | Queue `orders.fifo` |
| Drop a double publish | `msgID`, 2-minute window | `MessageDeduplicationId`, 5-minute window |
| Done | `ack()` | `DeleteMessage` |
| Try again later | `nak(delayMs)` | `ChangeMessageVisibility` (seconds) |
| No answer in 30 s: send again | `ack_wait` 30 s | visibility timeout 30 s |
| Attempt number | `deliveryCount` | `ApproximateReceiveCount` |
| Dead letter | Stream `DEAD` (the worker sends) | Queue `orders-dead.fifo` (the worker sends; redrive at 6 is the safety net) |
| 1 writer per order | Built by hand: 3 partitions, `max_ack_pending: 1` | Built in: `MessageGroupId` = the order ID |

The differences: JetStream is a log. It keeps messages in a stream, and with other retention it can replay them and serve many consumers. SQS is only a queue: a message is gone after the delete. NATS also does plain publish/subscribe and request/reply with no storage. SQS is managed by AWS, so there is no server to run. NATS needs a server (Docker here, or Synadia Cloud).

Interview answer: "I put the queue behind an interface, built a NATS JetStream adapter first, then an SQS FIFO adapter. The worker didn't change. FIFO message groups gave me per-order ordering for free, where on JetStream I had to partition by hand."

### Q17. Do NATS and SQS serve the same purpose? (Part 4, piece 24)

Asked 2026-10-21, at piece 24.

**In this project, yes.** Both are a work queue: hold 1 job per order, give it to 1 worker, delete it after the ack, send it again after a failure.

**In general, no.** SQS does only that 1 job. NATS does many jobs in 1 server. On AWS, each of those jobs is a different service:

| Job | NATS | AWS |
|---|---|---|
| Work queue | JetStream, WorkQueue retention | SQS |
| Publish to many subscribers (fan-out) | Core NATS subjects | SNS, EventBridge |
| A log you can replay | JetStream, Limits retention | Kinesis, MSK (Kafka) |
| Request/reply between services | Core NATS request/reply | API Gateway + Lambda, or HTTP |
| Key-value store | JetStream KV | DynamoDB, ElastiCache |
| File store | JetStream Object Store | S3 |

So the choice is: 1 flexible system that you run (NATS, or Synadia Cloud), or several managed AWS services that you join together. Inside AWS with a simple queue, SQS is less work. For edge devices, many regions, or messaging between services on more than 1 cloud, NATS fits better. This is the question for TWS-101.

### Q18. Does it make sense to have both NATS and SQS? (Part 4, piece 24)

Asked 2026-10-21, at piece 24.

**In this project, yes.** It is a learning project. The 2 adapters prove the `Queue` interface works, and the build teaches both systems. That is the interview story.

**In a real system, usually no, not for the same job.** 2 queue systems for 1 job means 2 things to run, watch, secure and pay for, and 2 sets of failure modes. Pick 1.

When both make sense:

- **Different jobs.** For example, NATS for fast messages between services or edge devices, and SQS for durable work inside AWS. Each tool does the job it is best at.
- **A migration.** Move from one to the other over weeks, with both running for a short time. The interface makes that safer: switch 1 worker at a time.

A trap: NATS on the laptop and SQS in production. Then tests don't run what production runs. That is why part 4 runs ElasticMQ locally: the same SQS API as AWS.

Interview answer: "One queue per job. The interface lets me change the queue without touching the worker, which matters for a migration, not for running both forever."
