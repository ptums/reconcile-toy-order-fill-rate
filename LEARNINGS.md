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
