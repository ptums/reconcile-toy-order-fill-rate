/** The four order operations, against a fake fetch (no network, no mock store yet). */

import { expect, test } from "vitest";

import { GraphQLStoreClient, StoreError, type FetchFn } from "../src/index.js";

interface SentBody {
  query: string;
  variables: Record<string, unknown>;
}

/** A client whose store always answers with `data`. Records each request body in `seen`. */
function clientReturning(data: unknown, seen?: SentBody[]): GraphQLStoreClient {
  const fakeFetch: FetchFn = async (_input, init) => {
    seen?.push(JSON.parse(String(init.body)) as SentBody);
    return Response.json({ data });
  };
  return new GraphQLStoreClient({ graphqlUrl: "http://store.test/graphql", token: "t" }, fakeFetch);
}

test("findOrder returns the order and sends the name as a variable", async () => {
  const seen: SentBody[] = [];
  const client = clientReturning(
    { orders: { edges: [{ node: { id: "gid://shopify/Order/1", name: "#1001" } }] } },
    seen,
  );
  expect(await client.findOrder("#1001")).toEqual({ id: "gid://shopify/Order/1", name: "#1001" });
  expect(seen[0]?.variables).toEqual({ query: "name:#1001" }); // a variable, never pasted into the query
});

test("findOrder returns null when the store has no match", async () => {
  const client = clientReturning({ orders: { edges: [] } });
  expect(await client.findOrder("#9999")).toBeNull();
});

test("beginEdit returns a calculated order with its own ids", async () => {
  const client = clientReturning({
    orderEditBegin: {
      calculatedOrder: {
        id: "gid://shopify/CalculatedOrder/7",
        originalOrder: { name: "#1001" },
        lineItems: {
          edges: [{ node: { id: "gid://shopify/CalculatedLineItem/3", sku: "TOY-1", quantity: 12 } }],
        },
      },
      userErrors: [],
    },
  });
  const calc = await client.beginEdit("gid://shopify/Order/1");
  // Python checked isinstance(calc, CalculatedOrder). A TS interface is erased at runtime,
  // so this checks the shape instead.
  expect(calc).toEqual({
    id: "gid://shopify/CalculatedOrder/7",
    orderName: "#1001",
    lineItems: [{ id: "gid://shopify/CalculatedLineItem/3", sku: "TOY-1", quantity: 12 }],
  });
  expect(calc.id).toBe("gid://shopify/CalculatedOrder/7");
  expect(calc.lineItems[0]?.quantity).toBe(12);
});

test("setQuantity throws on userErrors that the 2021 code ignored", async () => {
  const client = clientReturning({
    orderEditSetQuantity: { calculatedOrder: null, userErrors: [{ field: ["quantity"], message: "bad" }] },
  });
  await expect(
    client.setQuantity("gid://shopify/CalculatedOrder/7", "gid://shopify/CalculatedLineItem/3", -1),
  ).rejects.toBeInstanceOf(StoreError);
});

test("commitEdit sends the calculated order id", async () => {
  const seen: SentBody[] = [];
  const client = clientReturning(
    { orderEditCommit: { order: { id: "gid://shopify/Order/1" }, userErrors: [] } },
    seen,
  );
  await client.commitEdit("gid://shopify/CalculatedOrder/7");
  expect(seen[0]?.variables).toEqual({ id: "gid://shopify/CalculatedOrder/7" });
});
