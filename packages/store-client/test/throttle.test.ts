import { expect, test } from "vitest";

import { ThrottleStatus } from "../src/index.js";

test("wait is points needed divided by restore rate", () => {
  const status = new ThrottleStatus(1000, 4, 50);
  expect(status.waitSeconds(10)).toBe((10 - 4) / 50);
});

test("no wait when bucket has enough points", () => {
  const status = new ThrottleStatus(1000, 500, 50);
  expect(status.waitSeconds(10)).toBe(0);
});
