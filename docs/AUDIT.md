# Modernization audit: CSV bulk order updates (2021)

Status: draft for TWS-77. Written in ASD-STE100 style.

## 1. Purpose

This audit records the state of the 2021 tool. It is the baseline for the modernization.

The modernized version does not connect to Shopify. It uses a mock GraphQL server. The mock copies the shape of the Shopify Admin GraphQL API: the same operation names, the same fields, the same `userErrors` and the same cost-based rate limits. The mock does not use client data.

The client code talks to the mock through one adapter. To use the real Shopify Admin GraphQL API, change the endpoint URL and the access token. No other code changes are necessary.

## 2. What the tool does

1. A user uploads a CSV file. Each row has an order number, an item description, a SKU and a final quantity.
2. The server divides the rows into groups of 20.
3. For each row, the server sends four GraphQL requests: find the order, start an order edit, set the new quantity, and commit the edit.
4. The server waits 3 to 5 seconds between requests.
5. The server writes each success and each failure to MongoDB.
6. A results page shows the number of updated items and each failure with a manual action.

Input: the source data is a supplier fill-rate report. It shows how many pieces of each item the supplier shipped for each purchase order. The tool set each store order line to the shipped quantity. The report columns map to the tool columns like this:

| Report column | Tool column |
|---|---|
| PO No. | Order # |
| Item | SKU |
| Item Desc | Description |
| Pieces Shipped | Final Qty |

The test data is `fixtures/sample-orders.anon.csv`. `tools/anonymize-sample.ts` makes it from a real report. The real report is not in the repository.

Stack: Node.js, Express, Handlebars, MongoDB (Mongoose 5), node-fetch 2, csv-parse 4. It was hosted on a DigitalOcean server. There are 82 commits from March to May 2021.

## 3. Findings

Severity: **High** = wrong data or a hang. **Medium** = a design limit. **Low** = clean-up.

Findings come from reading the code. I did not run the tool. I did not run the tests or `npm audit`.

### Correctness

| # | Severity | Finding | Location |
|---|---|---|---|
| C1 | Medium | The server reads the CSV as a stream and parses each `data` chunk as a full file. A file larger than 64 KiB arrives in more than one chunk, so a row can split between two chunks. Each chunk also calls `res.redirect`, so the second call fails because the response is already sent. A typical file had about 340 rows. As a CSV with all 15 report columns, that is about 47 KB (136 bytes for each row), which is one chunk. The bug is latent: it starts at about 480 rows. | `src/index.js:68` |
| C2 | High | Each stage resolves its promise when the row with the last index finishes. Requests do not always finish in order, so the next stage can start before all rows are done. Results can be lost. | `src/regular-orders.js` (all four stages) |
| C3 | High | If no row gets an order ID, the second stage never resolves its promise. The request then waits forever, because the socket timeout is set to about 24 days. | `src/regular-orders.js:64`, `src/index.js:53` |
| C4 | High | The log line reads `ordersWithGIDUrls[index]`. After one row fails, the indexes do not match, and the line throws a `TypeError`. | `src/regular-orders.js:46`, `:161` |
| C5 | Medium | `description` is not defined in the commit stage, so this failure path throws a `ReferenceError`. | `src/regular-orders.js:207` |
| C6 | Medium | Network errors are returned as data (`.catch((err) => err)`). The caller then reads `.data` on an error object and throws. | `utils/query-execution.js:16`, `:30` |
| C7 | Low | `formatDate` takes `data` but reads `date`. | `utils/helpers.js:1` |

### Security

| # | Severity | Finding | Location |
|---|---|---|---|
| S1 | High | `.env.local` is committed. It holds the store URL, the Admin API token and the MongoDB URI. | commit `bff7d6d` |
| S2 | Medium | Queries put user input (order names) into the GraphQL string. Use GraphQL variables. | `utils/regular-queries.js` |
| S3 | Medium | The upload endpoint has no authentication. | `src/index.js` |
| S4 | Medium | The dependencies are from 2021 (Express 4.17, Mongoose 5, node-fetch 2). They probably have known vulnerabilities. Run `npm audit` to confirm. | `package.json` |

### Design and system limits

| # | Severity | Finding | Concept |
|---|---|---|---|
| D1 | High | One HTTP request does all the work. A large file keeps the request open for hours. | Background jobs, job queue |
| D2 | Medium | Fixed waits (3 to 5 s) control the rate. The tool ignores the rate-limit data that the API returns. | Adaptive rate limiting, backoff |
| D3 | Medium | Each run deletes all results. Two users at the same time overwrite each other. | Per-job state, multi-tenancy |
| D4 | Medium | A failed row is recorded but not retried. | Retries, dead-letter queue |
| D5 | Medium | A second upload of the same file sends all the edits again. | Idempotency keys |
| D6 | Medium | Two rows for the same order run as separate edits. They can conflict. | Concurrency, partitioning by key |
| D7 | Low | Logs are `console.log` only. There are no metrics. | Observability |
| D8 | Low | The draft-order code is never called. | Dead code |

### Tests

| # | Severity | Finding |
|---|---|---|
| T1 | Medium | The tests do not match the code. `Record` has 5 fields, but the test expects 6 and a `poNumber` field. The CSV test expects raw keys, but the parser filters on `Order #` and returns no rows. Both tests will probably fail (not run). |
| T2 | Medium | No test covers the GraphQL calls, the rate limits or the failure paths. |

## 4. Target design

| Area | 2021 | Modernized |
|---|---|---|
| Upload | Express route that does all the work | TypeScript API stores the file in S3 (LocalStack) and returns a job ID at once |
| Work | Timers in one process | NATS: one message for each row, partitioned by order ID; TypeScript workers that scale out |
| API access | Hard-coded Shopify calls | One adapter. Mock GraphQL server by default; real Shopify Admin API by config |
| Rate limits | Fixed waits | Read `throttleStatus` and back off |
| State | MongoDB, cleared each run | DynamoDB Local for job status and idempotency keys; Postgres for results (decide in an ADR) |
| Failures | Recorded only | Retries with backoff, then a dead-letter subject and a report |
| Frontend | Handlebars | React and TypeScript upload page and job status page |
| Runtime | One DigitalOcean server | Containers on Kubernetes (kind or k3d locally, EKS at the end) |
| Delivery | Manual | GitHub Actions CI/CD and infrastructure as code |
| Tests | 2 stale unit tests | Test pyramid: unit, contract (mock vs Shopify schema), integration, end-to-end |

## 5. Before publishing

Start a new repository. Do not publish this history (see S1). Rotate the Shopify token and the MongoDB credentials if they are still active.
