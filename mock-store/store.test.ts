import { expect, it } from "vitest";
import { loadOrders } from "./store.ts";

it("loads 2 orders with no total rows", () => {
  expect(loadOrders().map((o) => [o.name, o.lineItems.length])).toEqual([
    ["#1001", 242],
    ["#1002", 97],
  ]);
});
