# Requirements: reconcile store orders with a supplier fill-rate report

Linear ticket: TWS-77. Written in ASD-STE100 style. See `PROCESS.md` for how the lessons work.

## Purpose

A supplier sends a fill-rate report (CSV). It shows how many pieces of each item the supplier shipped for each purchase order. When the supplier ships fewer pieces than ordered, the store order lines must change to the shipped quantity.

This is a rebuild, from scratch, of a 2021 Node.js tool (`legacy/`). The rebuild is a learning project for system design. It does not use a real store: it uses a mock of a subset of the Shopify Admin GraphQL API.

## The report

`fixtures/sample-orders.anon.csv`: 341 lines in 2 orders (#1001: 243 lines, #1002: 98 lines), plus 2 total rows with no PO. It has no quoted fields.

| Report column | Meaning |
|---|---|
| `PO No.` | The store order name (`#1001`) |
| `Item` | The SKU |
| `Pieces Ordered` | The quantity on the order now |
| `Pieces Shipped` | The quantity the order line must have |

`tools/anonymize-sample.ts` made this file from a real report. It needs its own setup (`fflate`) before it runs again.

## Build plan

### Part 1. Mock API server (`mock-store/`)

A GraphQL server that copies the shape of Shopify's Admin API. Stack: `node:http` + GraphQL Yoga. Port 8001. Run: `pnpm dev:mock`. GraphiQL: http://localhost:8001/graphql.

| Piece | What | Status |
|---|---|---|
| 1 | Project setup: `package.json`, TypeScript, tsx, `tsconfig.json` | Done |
| 2 | `node:http` server with `GET /health` and 404 | Done |
| 3 | GraphQL Yoga with `shop { name }` | Done |
| 4 | `store.ts`: load the orders from the report (`loadOrders`) | Done |
| 5 | `orders(first, query: "name:1001")` and `Order.lineItems(first)`, in the connection shape (`edges { node }`). No `query` returns all orders up to `first` | Done |
| 6 | Edit sessions: `orderEditBegin`, `orderEditSetQuantity`, `orderEditCommit` | **Next** |
| 7 | `userErrors` for bad input: unknown order, unknown session, line not in the session, negative quantity. HTTP 200, no change (Peter's rule: a bad `commit` returns a userError and changes nothing) | To do |
| 8 | Cost-based leaky bucket: query cost, `extensions.cost.throttleStatus`, `THROTTLED` error. One bucket for each access token | To do |
| 9 | Tests with Vitest | To do |

Shopify facts checked on shopify.dev (2026-10-18): the example bucket is `maximumAvailable 1000`, `restoreRate 50`; a mutation costs 10; an object costs 1; a connection costs by `first`; one query can't cost more than 1,000.

### Part 2. Queue package (NATS)

- A `Queue` interface, and a NATS JetStream adapter. Local NATS runs in Docker.
- One message for each report row. Partition by order ID, so one order has one writer.
- At-least-once delivery, ack after the work, a dead-letter subject for failed rows.
- On AWS, the same interface gets an SQS FIFO adapter (message group = order ID).

### Part 3. CLI client

- Run: `reconcile.ts --file=<report>.csv`. It shows the progress in the terminal.
- It reads the report, finds each order, diffs before it writes (only lines that change), and edits each order in one edit session.
- It reads `throttleStatus` and waits only as long as necessary (no fixed sleeps). It retries transient errors with backoff and jitter. Permanent errors go to a failure report.
- Store URL and token come from environment variables, so the real Shopify API can replace the mock.

### Part 4. Cloud infrastructure in AWS

- AWS CLI only. Profile `reconciler`, Region `us-east-2`. Cost cap $5 a month.
- Done: the budget `monthly-5-usd`.
- Planned: DynamoDB on-demand for job and row status (single table `reconciler-jobs`, PK `JOB#<id>`, SK `META` / `ORDER#<n>` / `ROW#<n>`, TTL on `expiresAt`), S3 for the reports, SQS FIFO, Lambda.
- Not used (cost): EKS, NAT gateway, RDS, load balancers. Kubernetes runs only on the local machine (k3d), if at all.

## Where we stopped

Part 1, piece 5 is done and verified (2026-10-18): `orders(first: 5)` returns #1001 and #1002, and `orders(query: "name:1001")` returns #1001 with its line items. Next: **part 1, piece 6, edit sessions.**
