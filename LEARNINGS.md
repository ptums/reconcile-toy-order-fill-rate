# Learnings

Peter's questions while he builds the reconciler from scratch in TypeScript, with the answers. Newest at the bottom. Written in ASD-STE100 style.

The build plan:

1. The mock API server (a subset of the Shopify Admin GraphQL API)
2. The queue package (NATS)
3. The CLI client: `reconcile.ts --file=<report>.csv`
4. The cloud infrastructure in AWS (aws cli)

## Questions

### Q1. What system design ideas are in the `orders` query? (Part 1, piece 5)

Asked 2026-10-18, before piece 5.

1. **Pagination (connections).** `edges { node }` and `first` limit the size of each response. Order #1001 has 243 lines. Without a limit, one response can be very large. Shopify uses cursor pagination: each edge has a cursor, and the next page starts after it. Offset pagination (`page=3`) is simpler, but it skips or repeats items when data changes between pages.
2. **The client chooses the work.** In GraphQL, the client decides how much data to ask for. `lineItems(first: 250)` costs the server more than `first: 2`. For this reason, Shopify gives each query a cost and rate-limits by cost, not by request count. The mock gets this later (the leaky bucket).
3. **The N+1 problem.** `Order.lineItems` is a resolver for each order. With 50 orders and a database, that is 1 query for the orders plus 50 queries for the lines. The fix is batching: collect the 50 order IDs, then make 1 query (the DataLoader pattern). Here the data is in memory, so there is no cost.
4. **Indexes.** `orders.filter(...)` reads every order (O(n)). With 2 orders, that is fine. With 1 million, use a `Map` keyed by name. That is the same idea as a database index: more memory, faster lookups.
5. **The schema is a contract.** The mock copies Shopify's names and shapes. The client code then works with the real Shopify API by a change of URL and token. This is the adapter pattern, and contract tests check that the two sides agree.
6. **In-memory state.** The orders live in the server's memory. A restart loads them again from the CSV (not durable), and two copies of the server have two different sets of orders (not shared). That is acceptable for a mock, but not for a real system of record.

**Interview answer.** "GraphQL lets the client pick the shape and size of the response, so we bound lists with cursor pagination, price queries by cost for rate limiting, and batch nested resolvers to avoid N+1 queries."

### Q2. Is an order edit "open a session, then make the edits in a follow-up call"? (Part 1, piece 6a)

Asked 2026-10-19, after piece 6a.

Yes, with one more step. An edit has 3 calls, not 2:

1. **`orderEditBegin`** opens the session. It returns a `CalculatedOrder`: a draft copy of the order lines.
2. **`orderEditSetQuantity`** stages a change on the draft. You can call it many times, one time for each line. The real order does not change.
3. **`orderEditCommit`** applies all the staged changes to the real order at once.

Why Shopify uses this design:

- **Atomicity (all or nothing).** 40 line changes become one change to the order. A failure in the middle leaves the order as it was, not half edited. This is the same idea as a database transaction (`BEGIN`, the writes, `COMMIT`).
- **Preview.** The draft shows the new totals before anything is final.
- **One event.** The commit makes one order update, so the customer gets one email and the history has one entry, not 40.

A TypeScript comparison: `git add` stages changes, and `git commit` applies them as one unit.

**Interview answer.** "Shopify order edits are transactional: begin returns a draft, set-quantity stages changes on it, and commit applies them atomically, so a multi-line change is all or nothing and produces one update."

**Follow-up (Peter): "It is the same approach as git."** The full mapping: `orderEditBegin` is a fresh working copy, `orderEditSetQuantity` is an edit plus `git add`, and `orderEditCommit` is `git commit` and `git push` in one step. One difference: git rejects a push when someone else pushed first (you must pull and merge). Shopify does not check, so the last commit wins. Git uses optimistic concurrency control (detect the conflict at write time). Our mock does what Shopify does, and part 2 prevents the conflict instead: one writer for each order.

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

| | Fixed window | Leaky bucket (Shopify) |
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

**The session ID can't find duplicates.** Shopify makes the session ID in `orderEditBegin`, inside the worker, after the message was sent. A redelivered message runs begin again and gets a new session ID. So 2 deliveries of the same row have 2 different session IDs. The ID must come from the row itself, before the message is sent: for example `<report file>:<row number>`. This is a **deduplication key** (or idempotency key). SQS FIFO uses it as `MessageDeduplicationId`, and NATS uses it as the `Nats-Msg-Id` header.

**Interview answer.** "The idempotency key must be stable across retries, so it comes from the source record, not from anything the consumer generates. A server-generated session ID changes on every attempt."

### Q11. What is happening in part 2? Explain it for a high school student. (Part 2, before piece 11)

Asked 2026-10-21, before piece 11.

Think of a busy diner kitchen.

1. **The report is a stack of order slips.** Each slip is one row: "table 1001, item 8876963, make it 5."
2. **The queue is the ticket rail.** The CLI puts every slip on the rail. Cooks take slips off the rail one at a time.
3. **The worker is a cook.** The cook makes the change in Shopify (begin, set quantity, commit).
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
