import { describe, expect, it } from "vitest";
import { createApp } from "../mock-store/app.ts";
import { storeClient } from "./store-client.ts";
import { withThrottle } from "./throttle.ts";
import { applyOrder } from "./apply-order.ts";
import { readReport } from "./report.ts";

const ORDER = "gid://shopify/Order/1002";
const REPORT = new URL("../fixtures/sample-orders.anon.csv", import.meta.url)
  .pathname;

// A new mock store in memory, and a client for it.
function testGql() {
  const app = createApp();
  const client = storeClient("http://test/graphql", "test-token", (url, init) =>
    app.fetch(url, init),
  );
  return withThrottle(client);
}

describe("applyOrder", () => {
  it("changes only the 13 lines that differ, then nothing on a second run", async () => {
    const gql = testGql();
    // Order 1002 in the report: 97 lines, 13 differ
    const order = readReport(REPORT).find((o) => o.orderId === ORDER)!;
    const message = { id: "sample.csv:1002", ...order };

    expect(await applyOrder(gql, message)).toEqual({
      changed: 13,
      rejected: [],
    });
    expect(await applyOrder(gql, message)).toEqual({
      changed: 0,
      rejected: [],
    });
  });

  it("rejects a SKU that is not on the order", async () => {
    const gql = testGql();
    const message = {
      id: "test.csv:1002",
      orderId: ORDER,
      lines: [{ sku: "NOT-ON-ORDER", quantity: 1 }],
    };

    expect(await applyOrder(gql, message)).toEqual({
      changed: 0,
      rejected: [{ sku: "NOT-ON-ORDER", message: "SKU is not on this order" }],
    });
  });
});
