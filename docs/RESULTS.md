# Results: the rebuild against the 2021 tool

This page compares the rebuild with the 2021 tool in `legacy/`. The "before" facts are in `BASELINE.md`.

Recorded: 2026-10-21. No client name, store or order data is on this page.

## How the numbers were made

- **After (run):** the rebuild on Node v22.22.3, against the mock store and local NATS JetStream 2.11, with the sample report: 339 lines in 2 orders, 108 of them with a new quantity.
- **Before (calculated):** the 2021 tool reads a different CSV format, and a real run needs MongoDB and a real store. So the "before" numbers come from its code, for the same 339 rows. They are not from a run.
- The mock store copies Toy-Shop's cost rules: a bucket of 1,000 points that refills at 50 points per second, 10 points for a mutation, and `first` points for each connection.

## Before and after

| Measure                         | Before (2021, calculated)                         | After (rebuild, run)                                                                                                 |
| ------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Time for 339 rows               | About 89 minutes in fixed sleeps                  | 12.5 s in-process, about 13 s through the CLI and NATS                                                               |
| API calls                       | 1,356 (4 for each row)                            | 114 that do work, plus 38 `THROTTLED` answers that cost nothing                                                      |
| Lines written                   | 339 (every row)                                   | 108 (only the lines that change)                                                                                     |
| Edit sessions                   | 339 (1 for each row)                              | 2 (1 for each order)                                                                                                 |
| Waits on the rate limit         | Fixed sleeps, the same for every row              | Calculated from `throttleStatus`: (cost − available) ÷ 50 s                                                          |
| A second run of the same report | Writes all 339 rows again                         | Writes 0 lines (2 reads only)                                                                                        |
| A failed row or order           | A record that says "please update manually"       | Transient: retry with backoff and jitter (1, 2, 4, 8 s), 5 attempts. Permanent: dead letter at once, with the reason |
| A rejected line                 | Can shift the result indexes and hang the request | Reported in the summary. The good lines of the order still commit                                                    |
| Hangs                           | Possible (see `BASELINE.md`)                      | Every order ends as done or in the dead letter                                                                       |
| 2 writers on 1 order            | Not handled                                       | Not possible: 1 writer per order (3 partitions, 1 message at a time each)                                            |
| Tests                           | 1 passing, 3 failing                              | 29 passing (Vitest), no server needed                                                                                |

## Why 12.5 s is the floor

The full run costs 1,622 points: 2 reads of 251 points, 2 begins, 108 quantity changes and 2 commits at 10 points each. The bucket starts with 1,000 points, so the run must wait for 622 more. At 50 points per second, that is 12.4 s. The rebuild finished in 12.5 s, so it runs at the speed the rate limit allows. The rate limit is the limit, not the code.

## Failure tests (run)

| Test                                           | Result                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| The same report 2 times                        | Run 1: 108 lines changed (95 and 13). Run 2: 0 lines changed                                                              |
| The store stopped                              | Each order retried 4 times with backoff, then went to the dead letter on attempt 5. The CLI printed the summary and ended |
| An order that does not exist                   | Dead letter at once, with the reason. No retries (Vitest)                                                                 |
| A SKU that is not on the order                 | Rejected, with the reason, in the summary. The other lines commit (Vitest)                                                |
| 2 messages for 1 order, the first one retrying | The second message waited until the first one was done. Another order ran at the same time (queue test with NATS)         |

## What I would do next

- **Wait before the bucket is empty.** Each answer has `throttleStatus`. The client could wait before a call that will not fit, instead of getting a `THROTTLED` answer first. That would remove the 38 `THROTTLED` answers, but the run would not be faster, because the bucket is the limit.
- **Change many lines in 1 call.** Toy-Shop lets 1 request hold several mutations. This would cut the number of requests, but not the points.
- **Orders with more than 250 lines.** The read uses `lineItems(first: 250)`. A larger order needs pagination.
- **A separate worker.** The worker runs inside the CLI process. A separate worker needs a job status store, so the CLI can show progress.
