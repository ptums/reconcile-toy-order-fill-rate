# Requirements: reconcile store orders with a supplier fill-rate report

Linear ticket: TWS-77. Written in ASD-STE100 style. See `PROCESS.md` for how the lessons work.

## Purpose

A supplier sends a fill-rate report (CSV). It shows how many pieces of each item the supplier shipped for each purchase order. When the supplier ships fewer pieces than ordered, the store order lines must change to the shipped quantity.

This is a rebuild, from scratch, of a 2021 Node.js tool (`legacy/`). The rebuild is a learning project for system design. It does not use a real store: it uses a mock of a subset of the Toy-Shop Admin GraphQL API.

## The report

`fixtures/sample-orders.anon.csv`: 343 rows: 339 order lines in 2 orders (#1001: 242 lines, #1002: 97 lines), plus 4 total rows with no Item (1 subtotal for each PO, and 2 grand totals). 108 lines differ (#1001: 95, #1002: 13). It has no quoted fields.

| Report column    | Meaning                               |
| ---------------- | ------------------------------------- |
| `PO No.`         | The store order name (`#1001`)        |
| `Item`           | The SKU                               |
| `Pieces Ordered` | The quantity on the order now         |
| `Pieces Shipped` | The quantity the order line must have |

`tools/anonymize-sample.ts` made this file from a real report. It needs its own setup (`fflate`) before it runs again.

## Build plan

### Part 1. Mock API server (`mock-store/`)

A GraphQL server that copies the shape of Toy-Shop's Admin API. Stack: `node:http` + GraphQL Yoga. Port 8001. Run: `pnpm dev:mock`. GraphiQL: http://localhost:8001/graphql.

| Piece | What                                                                                                                                                                                                                                                                                                                                                                                                   | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1     | Project setup: `package.json`, TypeScript, tsx, `tsconfig.json`                                                                                                                                                                                                                                                                                                                                        | Done   |
| 2     | `node:http` server with `GET /health` and 404                                                                                                                                                                                                                                                                                                                                                          | Done   |
| 3     | GraphQL Yoga with `shop { name }`                                                                                                                                                                                                                                                                                                                                                                      | Done   |
| 4     | `store.ts`: load the orders from the report (`loadOrders`)                                                                                                                                                                                                                                                                                                                                             | Done   |
| 5     | `orders(first, query: "name:1001")` and `Order.lineItems(first)`, in the connection shape (`edges { node }`). No `query` returns all orders up to `first`                                                                                                                                                                                                                                              | Done   |
| 6     | Edit sessions: `orderEditBegin`, `orderEditSetQuantity`, `orderEditCommit`. Each session edits a copy and tracks its changed lines; commit applies only those (last commit wins, per line)                                                                                                                                                                                                             | Done   |
| 7     | `userErrors` for bad input: unknown order, unknown session, line not in the session, negative quantity. HTTP 200, no change (Peter's rule: a bad `commit` returns a userError and changes nothing). Peter's rule (2026-10-19): `orderEditSetQuantity` rejects a bad line at once, so the commit applies the good lines; the CLI reports the rejected lines at the end, like the legacy `createFailure` | Done   |
| 8     | Cost-based leaky bucket: query cost, `extensions.cost.throttleStatus`, `THROTTLED` error. One bucket for each access token. Decided 2026-10-19: lazy refill (a level and a timestamp, no timer); the server rejects at once with `THROTTLED` (holding requests is a bottleneck), and the client calculates its wait from `throttleStatus`                                                              | Done   |
| 9     | Tests with Vitest. 9a: `createApp()` (in `app.ts`) builds a new store each call, so each test starts clean (test isolation). 9b: the first 2 tests with `app.fetch` (no port). 9c: bucket tests with a fixed clock (`now` as a parameter), a userError and `THROTTLED`. 9d: the other bad-input cases as a table-driven test (`it.each`) and the second commit. 12 tests pass (2026-10-21)             | Done   |

Toy-Shop facts checked against a real store API's docs (2026-10-18): the example bucket is `maximumAvailable 1000`, `restoreRate 50`; a mutation costs 10; an object costs 1; a connection costs by `first`; one query can't cost more than 1,000.

### Part 2. Queue package (`queue/`)

A `Queue` interface (`queue.ts`) and a NATS JetStream adapter (`nats.ts`). Local NATS 2.11 runs in Docker (`docker compose up -d`): clients on port 4222, monitoring on port 8222. On AWS, the same interface gets an SQS FIFO adapter (part 4).

| Piece | What                                                                                                                                                                                  | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 10    | NATS JetStream in Docker (`docker-compose.yml`). `/healthz` returns `ok`                                                                                                              | Done   |
| 11    | The `Queue` interface: `OrderMessage`, `Delivery` (`ack`, `nak`, `deadLetter`, `attempt`), `publish`, `consume`, `close`. Types only                                                  | Done   |
| 12    | The NATS adapter. 12a: connect and publish (stream `ROWS`, the row key as `msgID`, so a second publish is dropped). 12b: consume and ack (the ack deletes the message)                | Done   |
| 13    | `nak(delayMs)`: a failed row comes back after the delay. `attempt` is the delivery count                                                                                              | Done   |
| 14    | Dead letters: stream `DEAD` on `dead.>`. `deadLetter(reason)` publishes the row with the reason to `dead.rows`, then acks the original                                                | Done   |
| 15    | 1 writer per order: 3 partitions (`rows.<order % 3>.<order>`), 1 consumer per partition with `max_ack_pending: 1`. Rows for 1 order run in sequence; different orders run in parallel | Done   |

Decisions (2026-10-20 to 2026-10-21):

- At-least-once delivery. The worker acks after the commit. An ack before the commit is at-most-once, and a crash loses the row.
- A message carries the absolute quantity (Pieces Shipped), never "add" or "remove", so a second delivery gives the same result (idempotency).
- One message for each report row, and each row is its own edit session. The dedup key is the row (`<report file>:<row number>`), not the session ID. Batching rows per order is possible in part 3.
- Peter: WorkQueue retention (choice B). An ack deletes the message, so a row is not done again.
- Peter: the dead letter keeps its messages (a log), for debugging.
- Peter: a permanent error (a `userError`) goes to the dead letter at once. A transient error (`THROTTLED`) gets a delayed retry, up to `MAX_ATTEMPTS` = 5, then goes to the dead letter. The retry delay is (cost − available) ÷ 50 seconds.
- Peter: partition by order, like the SQS FIFO `MessageGroupId` (choice B). A delayed `nak` keeps the partition's 1 place, so a newer row for the same order cannot go first.
- SQS FIFO mapping: `MessageGroupId` = the order ID, `MessageDeduplicationId` = the row key, `DeleteMessage` = ack, the visibility timeout = redelivery, a DLQ with `maxReceiveCount` = the dead letter.

Pieces 10 to 15 used 1 message per row and small try scripts. Part 3 changed the message to 1 per order (`OrderMessage`) and deleted the try scripts (Peter, 2026-10-21; git history keeps them). Check the streams: `curl -s "http://localhost:8222/jsz?streams=true"`. If you change the consumers, reset NATS with `docker compose down -v` (a WorkQueue stream does not allow overlapping consumers).

### Part 3. CLI client (`cli/`)

Run: `pnpm reconcile --file=<report>.csv`. Env vars: `STORE_URL` (default `http://localhost:8001/graphql`), `STORE_TOKEN`, `NATS_URL` (default `localhost:4222`), so the real Toy-Shop API can replace the mock.

| Piece | What                                                                                                                                                                                                                             | Status |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 16    | `report.ts`: `readReport()` groups the report rows by order, with Pieces Shipped as the quantity, and skips the total rows. 16b: the same fix in `mock-store/store.ts` (it loaded 1 empty line per order from the subtotal rows) | Done   |
| 17    | `OrderMessage` replaces `RowMessage`: `id`, `orderId`, `lines: { sku, quantity }[]`                                                                                                                                              | Done   |
| 18    | `store-client.ts`: `storeClient(url, token, fetch)` returns `gql()`. Plain `fetch`, passed in, so tests use `createApp()` with no port                                                                                           | Done   |
| 19    | `throttle.ts`: `withThrottle(gql, sleep)`. On THROTTLED it waits (cost − available) ÷ restoreRate seconds, then sends again. A query that costs more than a full bucket throws. Tests pass a fake sleep                          | Done   |
| 20    | `apply-order.ts`: `applyOrder()` reads the order, diffs against the store, then begin, set each changed line, commit. A rejected line does not stop the good lines                                                               | Done   |
| 21    | `worker.ts`: `handleDelivery()` acks after the commit, naks a transient error with backoff and jitter (1, 2, 4, 8 s + up to 1 s), and sends a `PermanentError` or the 5th failure to the dead letter                             | Done   |
| 22    | `reconcile.ts`: publishes 1 message per order, runs the worker in the same process, prints progress and a summary of rejected lines and dead letters                                                                             | Done   |

Decisions (2026-10-21):

- Peter: 1 message per order (choice B), so 1 edit session per order. It uses about 1/3 of the points of 1 message per row. A retry does the whole order again, which is safe because the quantities are absolute.
- The worker diffs against the store, not against Pieces Ordered. It must read the order anyway (the report has SKUs, the edit needs line item IDs), and a second run of the same report changes nothing.
- Peter: plain `fetch` for the store client (choice A), with no GraphQL library, so the cost data stays visible.
- The THROTTLED wait happens inside the edit session, so the session stays open. A `nak` would start the whole order again.
- `PermanentError`: an order that does not exist. A commit userError is transient: a retry starts a new session, reads again and diffs again.
- Peter: the worker runs in the CLI process (choice A). Part 4 splits it into a separate worker with job status in DynamoDB.
- Peter: the dedup ID is `<file>:<order ID>:<run start time>` (choice A). Each run does the work; the dedup catches only a double publish in 1 run. The store diff gives the idempotency.

### Part 4. AWS services (dropped)

Dropped by Peter (2026-10-21): for this educational project, NATS is the only queue. Before that, the plan was local AWS emulators (ElasticMQ for SQS FIFO, DynamoDB Local, S3Mock, the SAM CLI), with no AWS sign-up. A local test of ElasticMQ showed that a FIFO message group locks while a message is in flight, so SQS gives 1 writer per order with no partitions. The questions about SQS vs NATS are Q15 to Q18 in the question log.

The AWS profile `reconciler` (Region `us-east-2`) and the budget `monthly-5-usd` still exist, for a later project.

## Where we stopped

Part 1, pieces 6 and 7 are done and verified (2026-10-19). Edit sessions work (begin, set quantity, commit), and 2 sessions on different lines of #1001 both apply (5 and 9). Bad input returns `userErrors` and changes nothing: an unknown order, an unknown session, a line not in the session, a negative quantity. A second commit of the same session gives a userError (the idempotency problem, for part 3). Piece 8 is done and verified (2026-10-19): each response has `extensions.cost` with `throttleStatus`, and a request that costs more than the bucket holds gets `THROTTLED` (HTTP 200, `actualQueryCost: null`). Piece 9a is done: the GraphQL app moved to `mock-store/app.ts` as `createApp()`, and `server.ts` only serves it. Piece 9 is done (2026-10-21): 12 Vitest tests pass with `pnpm test`, and part 1 is complete. Part 2 is done and verified (2026-10-21): pieces 10 to 15, run by Peter against local NATS. A throttled row retries 5 times and goes to the dead letter, a bad row goes there at once, and rows for order 1001 run in sequence while order 1002 runs in parallel. Part 3 is done and verified (2026-10-21): pieces 16 to 22, 29 Vitest tests. Peter ran `pnpm reconcile` against the mock and local NATS: run 1 changed 108 lines (#1001: 95, #1002: 13), and run 2 changed 0. In scratch, with the store stopped, each order retried with backoff and went to the dead letter on attempt 5. Part 4 (AWS) is dropped (Peter, 2026-10-21). The baseline doc is done (2026-10-21): `docs/BASELINE.md`. The results doc is done (2026-10-21): `docs/RESULTS.md` (12.5 s against about 89 minutes; 114 calls against 1,356). Next: **the proof pages** for the order automation card on tumulty.me.
