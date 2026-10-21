import { expect, it } from "vitest";
import { createBuckets } from "./bucket.ts";

// The tests pass "now" as a fixed number (ms), so no test reads the real clock.
it("refills 50 points in 1 second", () => {
  const { take, refill } = createBuckets();
  expect(take("t", 1000, 0)).toBe(true); // empty at time 0
  expect(refill("t", 1000).available).toBe(50); // 1 second later
});

it("rejects a cost bigger than the points left", () => {
  const { take } = createBuckets();
  expect(take("t", 1000, 0)).toBe(true);
  expect(take("t", 1, 0)).toBe(false); // same moment, nothing left
});

it("never fills above 1,000", () => {
  const { take, refill } = createBuckets();
  take("t", 10, 0);
  expect(refill("t", 60_000).available).toBe(1000); // 1 minute later
});
