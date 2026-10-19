import { expect, test } from "vitest";

import { createApp } from "../src/app.js";

const yoga = createApp();

test("health", async () => {
  const response = await yoga.fetch("http://mock-store.test/health");
  expect(await response.json()).toEqual({ status: "ok" });
});

test("graphql shop query", async () => {
  const response = await yoga.fetch("http://mock-store.test/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ shop { name } }" }),
  });
  expect(await response.json()).toEqual({ data: { shop: { name: "Mock Store" } } });
});
