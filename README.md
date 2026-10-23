# Reconcile: fix store orders from a supplier's fill-rate report

A supplier wanted a way to automate updating order quantities from the many CSV spreadsheets they receive each week. Their process was to go into their store management system and update each order by hand. This program automates that process, but it isn't straightforward. The store management system has a strict update policy that prevents bulk updates, so we needed another approach.

It's a from-scratch TypeScript rebuild of a Node.js tool I wrote in 2021 (kept in `legacy/` for comparison). I rebuilt it to learn backend system design by doing: queues, rate limits, retries, and making a rerun safe. It runs against a local mock of part of the Toy-Shop Admin GraphQL API, so you don't need a real store to try it.

## The results

For the same 339-row report:

|               | 2021 tool                  | This rebuild                        |
| ------------- | -------------------------- | ----------------------------------- |
| Time          | About 89 minutes of sleeps | 12.5 seconds                        |
| API calls     | 1,356                      | 114 (plus 38 free `THROTTLED`)      |
| Lines written | 339 (every row)            | 108 (only the ones that change)     |
| Run it again  | Writes all 339 rows again  | Writes nothing                      |
| A failure     | "Please update manually"   | Retried, or set aside with a reason |
| Tests         | 1 of 4 passing             | 29 passing                          |

12.5 seconds is as fast as the store's rate limit allows. The full numbers and how they were measured are in [`docs/RESULTS.md`](docs/RESULTS.md). The state of the old tool is in [`docs/BASELINE.md`](docs/BASELINE.md).

## How it works

```text
fill-rate CSV ──> CLI ──> NATS JetStream ──> worker ──> store (GraphQL)
                  1 message     3 partitions,       read, diff,
                  per order     1 order at a time   edit, commit
                                     │
                                     └──> DEAD stream (orders that can't be fixed)
```

1. The CLI reads the report and groups the rows by purchase order.
2. It puts 1 message per order on a queue (NATS JetStream).
3. A worker takes each order, reads it from the store, and compares it with the report.
4. Only the lines that changed get written, all in 1 edit session per order.
5. The message is acknowledged only after the edit is committed.

A few design choices worth knowing:

- **Safe to rerun.** Quantities are absolute ("set to 4"), not relative ("subtract 2"), and the worker diffs before it writes. A second run finds nothing to change.
- **Waits only as long as it needs.** The store uses a leaky-bucket rate limit (1,000 points, refilling at 50 a second). When the store says `THROTTLED`, the client works out the exact wait instead of sleeping a fixed time.
- **1 writer per order.** Orders are split into 3 partitions, and each partition handles 1 message at a time. Two updates to the same order never race.
- **Failures end somewhere.** Network or server errors retry with backoff and jitter (up to 5 attempts). An order that doesn't exist goes straight to a dead-letter stream with the reason. Nothing hangs.

## Try it

You need Node 22, pnpm and Docker.

```sh
pnpm install
pnpm dev:mock          # the mock store on http://localhost:8001 (set PORT to change it)
docker compose up -d   # NATS JetStream on port 4222
pnpm reconcile --file=fixtures/sample-orders.anon.csv
```

The first run changes 108 lines across 2 orders. Run it again and it changes 0.

Other useful commands:

- `pnpm test` runs the Vitest tests. No servers needed.
- `pnpm exec tsc` checks types. No output means no errors.
- `docker compose down -v` stops NATS and deletes the stored messages.
- GraphiQL for the mock store is at http://localhost:8001/graphql, and NATS monitoring is at http://localhost:8222.

The sample report is anonymized: 2 orders, `#1001` (242 lines) and `#1002` (97 lines). Try this query in GraphiQL:

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

## What's inside

| Path          | What                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `mock-store/` | The mock store: GraphQL Yoga, order edit sessions, `userErrors`, and the cost-based rate limit |
| `queue/`      | A small `Queue` interface and its NATS JetStream adapter: partitions, retries, dead letter     |
| `cli/`        | The report reader, store client, throttle, order editor, worker and the CLI itself             |
| `fixtures/`   | The anonymized sample report                                                                   |
| `legacy/`     | The 2021 tool, unchanged, for comparison                                                       |
| `tools/`      | The script that made the anonymized fixture                                                    |

Stack: TypeScript on Node 22 (ESM), `tsx`, pnpm, GraphQL Yoga, NATS JetStream 2.11 in Docker, and Vitest.

## How it was built

I built it by hand, 1 small piece at a time, with Claude Code as a tutor: each piece was explained, tested in a scratch folder first, and then I wrote it. These files keep that record:

| File                                   | What                                                            |
| -------------------------------------- | --------------------------------------------------------------- |
| [`REQUIREMENTS.md`](REQUIREMENTS.md)   | The plan, each part, and the decisions made along the way       |
| [`LEARNINGS.md`](LEARNINGS.md)         | The questions I asked during the build, with the answers        |
| [`PROCESS.md`](PROCESS.md)             | How the lessons worked                                          |
| [`SELF_LEARNING.md`](SELF_LEARNING.md) | Mistakes made during the lessons, and the rules that fixed them |
| [`CLAUDE.md`](CLAUDE.md)               | Instructions for Claude Code in this repo                       |

The plan had a 4th part that swapped NATS for AWS SQS. I dropped it: both do the same job here, and NATS was the one I wanted to learn.

Topics covered: cursor pagination, cost-based rate limiting, the N+1 problem, the schema as a contract (adapter pattern), idempotency, at-least-once delivery, per-order ordering with partitioned queues, and retries with backoff and jitter.
