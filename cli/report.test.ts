import { describe, expect, it } from "vitest";
import { readReport } from "./report.ts";

const REPORT = new URL("../fixtures/sample-orders.anon.csv", import.meta.url)
  .pathname;

describe("readReport", () => {
  const orders = readReport(REPORT);

  it("finds 2 orders and skips the total rows", () => {
    expect(orders.map((o) => [o.orderId, o.lines.length])).toEqual([
      ["gid://shopify/Order/1001", 242],
      ["gid://shopify/Order/1002", 97],
    ]);
  });

  it("uses Pieces Shipped as the quantity", () => {
    expect(orders[0]!.lines[0]).toEqual({ sku: "8876963", quantity: 0 });
    expect(orders[0]!.lines[1]).toEqual({ sku: "8423840", quantity: 70 });
  });
});
