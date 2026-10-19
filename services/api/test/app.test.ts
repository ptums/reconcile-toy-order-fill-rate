import { expect, test } from "vitest";

import { app } from "../src/app.js";

test("health", async () => {
  const response = await app.request("/health");
  expect(await response.json()).toEqual({ status: "ok" });
});
