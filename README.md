# Reconcile toy orders with supplier fill-rate reports

Makes store orders match a supplier's fill-rate report. When a supplier ships fewer pieces than were ordered, the matching order lines in the store are set to the shipped quantity.

This is a modernization of a 2021 Node.js tool. The original code is in `legacy/` for comparison. `docs/AUDIT.md` is the baseline, and `docs/LEARNINGS.md` records the concepts behind the new design.

## This project does not use Shopify

The store is a **mock**: `services/mock-store` copies the shape of a subset of the Shopify Admin GraphQL API (the same operation names, fields, `userErrors` and cost-based rate limits). It holds only generated test data.

The worker talks to the store through one adapter, `packages/store-client`. To use the real Shopify Admin GraphQL API, change two settings and no code:

```
STORE_GRAPHQL_URL=https://<store>.myshopify.com/admin/api/<version>/graphql.json
STORE_TOKEN=<Admin API access token>
```

## Layout

A pnpm workspace. TypeScript (strict, ESM) on Node 22. Tests use vitest; scripts run with tsx.

| Path | Role |
|---|---|
| `services/api` | Upload API (producer, Hono): stores the CSV, creates a job, publishes one message per row |
| `services/worker` | Worker (consumer): diffs and reconciles order lines through the adapter |
| `services/mock-store` | Mock store (GraphQL Yoga): Shopify Admin GraphQL subset |
| `packages/store-client` | Adapter: one GraphQL client for the mock or real Shopify |
| `packages/queue` | Queue interface, with adapters for NATS JetStream (local) and SQS FIFO (AWS) |
| `fixtures/` | Anonymized sample report (`tools/anonymize-sample.ts` makes it) |
| `docs/` | Audit, ADRs, concept log |
| `legacy/` | The 2021 Node.js code, unchanged |

## Environments

| | Local | AWS |
|---|---|---|
| Runtime | k3d Kubernetes | Lambda |
| Queue | NATS JetStream | SQS FIFO |
| Job state | DynamoDB Local | DynamoDB on-demand |
| Files | LocalStack S3 | S3 |
| Results | Postgres | Neon free Postgres |

The AWS setup uses AWS CLI scripts only, in `infra/` (to come). The monthly cost cap is $5, with an AWS Budget alert.

The worker uses the `Queue` interface from `packages/queue`, not NATS or SQS directly. So the same worker code runs in both environments.

## Run

```
cp .env.example .env
pnpm install
pnpm test                # all packages
pnpm typecheck           # all packages
docker compose up -d     # NATS, Postgres, DynamoDB Local, LocalStack
pnpm --filter mock-store dev
```
