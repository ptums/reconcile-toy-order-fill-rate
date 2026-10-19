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
