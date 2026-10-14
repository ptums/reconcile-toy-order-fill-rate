# Reconcile toy orders with supplier fill-rate reports

Makes store orders match a supplier's fill-rate report. When a supplier ships fewer pieces than were ordered, the matching order lines in the store are set to the shipped quantity.

This is a modernization of a 2021 Node.js tool. The original code is in `legacy/` for comparison. `docs/AUDIT.md` is the baseline, and `docs/LEARNINGS.md` records the concepts behind the new design.

## This project does not use Shopify

The store is a **mock**: `services/mock_store` copies the shape of a subset of the Shopify Admin GraphQL API (the same operation names, fields, `userErrors` and cost-based rate limits). It holds only generated test data.

The worker talks to the store through one adapter, `packages/store_client`. To use the real Shopify Admin GraphQL API, change two settings and no code:

```
STORE_GRAPHQL_URL=https://<store>.myshopify.com/admin/api/<version>/graphql.json
STORE_TOKEN=<Admin API access token>
```

## Layout

| Path | Role |
|---|---|
| `services/api` | Upload API (producer): stores the CSV, creates a job, publishes one message per row |
| `services/worker` | Worker (consumer): diffs and reconciles order lines through the adapter |
| `services/mock_store` | Mock store: Shopify Admin GraphQL subset |
| `packages/store_client` | Adapter: one GraphQL client for the mock or real Shopify |
| `fixtures/` | Anonymized sample report (`tools/anonymize_sample.py` makes it) |
| `docs/` | Audit, ADRs, concept log |
| `legacy/` | The 2021 Node.js code, unchanged |

## Run

```
cp .env.example .env
uv sync
uv run pytest
docker compose up -d     # NATS, Postgres, DynamoDB Local, LocalStack
uv run uvicorn mock_store.app:app --port 8001
```
