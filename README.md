# Reconcile: store orders vs supplier fill-rate report

A supplier sends a fill-rate report (CSV). It shows how many pieces of each item the supplier shipped for each purchase order. When the supplier ships fewer pieces than ordered, the store order lines must change to the shipped quantity.

This project does that change automatically. It is a from-scratch TypeScript rebuild of a 2021 Node.js tool (`legacy/`), and a learning project for system design. It runs against a mock of a subset of the Shopify Admin GraphQL API, not a real store.

Linear ticket: TWS-77.

## Status

Part 1 (the mock store) is done: queries, edit sessions, userErrors, the cost-based leaky bucket, and Vitest tests. Part 2 (the queue package) is done: a `Queue` interface with a NATS JetStream adapter, retries with a delay, a dead letter, and 1 writer per order. Part 3 (the CLI) is done: it reads the report, queues 1 message per order, and edits each order in 1 session, with throttle waits, retries and a summary. A second run changes nothing. 29 tests pass. Part 4 (AWS) is dropped. Next: the deliverables (baseline and results docs). See `REQUIREMENTS.md` → "Where we stopped".

## Build plan

| Part | What                                                                                                    | Status  |
| ---- | ------------------------------------------------------------------------------------------------------- | ------- |
| 1    | Mock API server (`mock-store/`): GraphQL Yoga on `node:http`, in the shape of the Shopify Admin API     | Done    |
| 2    | Queue package (`queue/`): a `Queue` interface with a NATS JetStream adapter (local). SQS FIFO in part 4 | Done    |
| 3    | CLI client: `reconcile.ts --file=<report>.csv`                                                          | Done    |
| 4    | AWS services. Dropped (Peter, 2026-10-21): NATS is the only queue                                       | Dropped |

## Stack

- TypeScript on Node 22, ESM
- `tsx` to run (no build step), `tsc` (`noEmit`) to check types
- pnpm
- GraphQL Yoga + `graphql`
- NATS JetStream 2.11 in Docker (`@nats-io/transport-node`, `@nats-io/jetstream`)

## Run it

```sh
pnpm install
pnpm dev:mock
```

The mock store starts on port 8001 (set `PORT` to change it).

- Health check: `curl http://localhost:8001/health` → `{"status":"ok"}`
- GraphiQL: http://localhost:8001/graphql
- Tests: `pnpm test` (Vitest, no server needed)

Start the local queue (NATS in Docker):

```sh
docker compose up -d
```

- Clients: port 4222. Monitoring: http://localhost:8222 (`/healthz`, `/jsz?streams=true`)
- Reconcile the sample report (with the mock and NATS running): `pnpm reconcile --file=fixtures/sample-orders.anon.csv`
- Stop it: `docker compose down` (add `-v` to delete the stored messages)

Check types:

```sh
pnpm exec tsc
```

No output means no type errors.

## Try a query

```graphql
{
  orders(first: 5, query: "name:1001") {
    edges {
      node {
        id
        name
        lineItems(first: 3) {
          edges {
            node {
              id
              sku
              quantity
            }
          }
        }
      }
    }
  }
}
```

The mock store loads its orders from `fixtures/sample-orders.anon.csv`: 2 orders, `#1001` (242 lines) and `#1002` (97 lines). With no `query`, `orders` returns all orders up to `first`.

## Repo layout

| Path                        | What                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `mock-store/server.ts`      | HTTP server on port 8001, with `GET /health`                                                                                   |
| `mock-store/app.ts`         | `createApp()`: the GraphQL schema, the resolvers and the cost plugin, with new state for each call                             |
| `mock-store/bucket.ts`      | The leaky bucket: lazy refill, one bucket for each access token                                                                |
| `mock-store/cost.ts`        | The query cost: 10 for a mutation, plus `first` for each connection                                                            |
| `mock-store/*.test.ts`      | Vitest tests. Each test calls `createApp()` and sends requests with `app.fetch`, with no port. Bucket tests pass a fixed `now` |
| `mock-store/store.ts`       | Loads the orders from the CSV report                                                                                           |
| `queue/queue.ts`            | The `Queue` interface: `OrderMessage`, `Delivery`, `MAX_ATTEMPTS`                                                              |
| `queue/nats.ts`             | The NATS JetStream adapter: streams `ROWS` and `DEAD`, 3 partitions with 1 message at a time each                              |
| `cli/report.ts`             | Reads the report: 1 order per PO, with Pieces Shipped as the quantity                                                          |
| `cli/store-client.ts`       | `gql()` for 1 store, with plain `fetch`                                                                                        |
| `cli/throttle.ts`           | Waits on THROTTLED only as long as the bucket needs                                                                            |
| `cli/apply-order.ts`        | Edits 1 order: read, diff, begin, set the changed lines, commit                                                                |
| `cli/worker.ts`             | Handles 1 delivery: ack, nak with backoff and jitter, or dead letter                                                           |
| `cli/reconcile.ts`          | The CLI: publishes 1 message per order, runs the worker, prints the summary                                                    |
| `docker-compose.yml`        | Local NATS 2.11 with JetStream                                                                                                 |
| `fixtures/`                 | The anonymized sample report. Do not change                                                                                    |
| `legacy/`                   | The 2021 Node.js tool, for reference. Do not change                                                                            |
| `tools/anonymize-sample.ts` | Made the anonymized fixture from a real report (needs its own setup)                                                           |

## Docs

| File               | What                                                                         |
| ------------------ | ---------------------------------------------------------------------------- |
| `REQUIREMENTS.md`  | What we build, the full plan, and where we stopped                           |
| `docs/BASELINE.md` | The 2021 tool before the rebuild: how it works, speed, failures, code health |
| `PROCESS.md`       | How the lessons work: one piece at a time, how work is checked               |
| `LEARNINGS.md`     | Questions asked during the build, with answers and interview answers         |
| `SELF_LEARNING.md` | Mistakes made during the lessons, and the rules that prevent them            |
| `CLAUDE.md`        | Instructions for Claude Code, including the AWS rules                        |

## System design topics

Pagination (cursors vs offsets), cost-based rate limiting (leaky bucket), the N+1 problem, indexes, the schema as a contract (adapter pattern), idempotency, at-least-once delivery, per-order ordering with partitioned queues, and retries with backoff and jitter.
