# Baseline: the 2021 bulk order update tool (before the rebuild)

This page records the state of the 2021 tool in `legacy/` before the rebuild. The tool reads a CSV of new quantities and changes the matching lines on store orders through the Toy-Shop Admin GraphQL API.

Recorded: 2026-10-21. No client name, store or order data is on this page.

Each fact has a source:

- **Code:** I read it in the source. I did not run that path.
- **Run:** I ran it on 2026-10-21, on Node v22.22.3, in a copy of `legacy/`.

## How it works

| Check             | Result                                                                                                                     | Source |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| Shape             | An Express web app with an upload form (Handlebars views). The upload route does all the work inside 1 HTTP request        | Code   |
| Storage           | MongoDB (Mongoose), only for the success and failure records. Each upload deletes all earlier records first                | Code   |
| Input             | A CSV with the columns `Order #`, `Description`, `SKU`, `Final Qty`. Rows with an empty order, SKU or quantity are skipped | Code   |
| Batching          | Rows go in chunks of 20. Each chunk runs 4 steps in order: find the order ID, begin an edit, set the quantity, commit      | Code   |
| Edit sessions     | 1 edit session for each **row**, not for each order. So each row costs 4 API calls                                         | Code   |
| Diff before write | None. Every row is written, also when the quantity does not change                                                         | Code   |

## Rate limits and speed

| Check                       | Result                                                                                                                                    | Source            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Throttle handling           | No `throttleStatus` reads and no `THROTTLED` handling. Fixed sleeps only: in each step, row _n_ waits _n_ × 3 s, × 4 s, × 5 s and × 4.5 s | Code              |
| Time for 1 chunk of 20 rows | About 5 minutes in sleeps alone (19 × 16.5 s = 313.5 s)                                                                                   | Code (calculated) |
| Time for 339 rows           | About 89 minutes in sleeps alone (16 chunks of 20, then 1 of 19)                                                                          | Code (calculated) |
| API calls for 339 rows      | 1,356 (4 for each row)                                                                                                                    | Code (calculated) |

## Failures

| Check             | Result                                                                                                                                                                                                                                                                         | Source |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Retries           | None. Any error becomes a failure record that says "please update manually"                                                                                                                                                                                                    | Code   |
| Hang risk         | Each step resolves its promise only in the `finally` block of the last row. That block reads `results[index]`, but a failed row is not in `results`, so the indexes shift. After 1 failure, the `finally` block can throw, and the request never ends                          | Code   |
| Empty step        | If a step has 0 rows (for example, every order lookup failed), its promise never resolves, and the request never ends                                                                                                                                                          | Code   |
| Large files       | The upload is read with `createReadStream(...).on('data')`, and each chunk of the stream is parsed as its own CSV with a header row. A file larger than 1 stream chunk (64 KB) can lose or mix up rows. Each chunk can also call `res.redirect`, which sends a second response | Code   |
| Saving the upload | `promisify(fs.writeFile)` is called with an extra callback, so the `await` never resolves. The work runs inside that callback instead                                                                                                                                          | Code   |
| Rerun             | A rerun writes every row again, with 4 API calls each. Because the quantities are absolute, the result is the same, but nothing is skipped                                                                                                                                     | Code   |

## Health of the code

| Check          | Result                                                                                                                                                                       | Source |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `npm install`  | Works. 508 packages in the tree                                                                                                                                              | Run    |
| `npm audit`    | 41 vulnerabilities: 4 critical (handlebars, minimist, mongoose, proxy-addr), 24 high, 9 moderate, 4 low                                                                      | Run    |
| Tests          | `npm test`: 1 passing, 3 failing. The tests expect fields (`poNumber`) that `Record` no longer has. The second test path (`utils/__tests__`) does not exist                  | Run    |
| Start          | `npm start` with no `.env`: it prints "server running", then crashes because `MONGODB_URI` is missing. A full run needs MongoDB and a real store, so I did not run an upload | Run    |
| Dead code      | `src/draft-orders.js` (a draft-order path) is never called. `formatDate` in `utils/helpers.js` uses an undefined variable (`date`)                                           | Code   |
| Types and lint | Plain JavaScript (CommonJS), ESLint with the Airbnb config. No types                                                                                                         | Code   |

## What the rebuild must fix

1. Wait only as long as the rate limit needs, from `throttleStatus`, not with fixed sleeps.
2. Diff before writing, and use 1 edit session for each order.
3. Retry transient errors, and keep permanent errors in 1 place with the reason.
4. Never hang: every order must end as done or failed.
5. Make a rerun safe and cheap.

The results of the rebuild are in `RESULTS.md` (to do).
