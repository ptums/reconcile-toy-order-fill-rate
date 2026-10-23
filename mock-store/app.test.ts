import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

// Sends one GraphQL request to the app in memory. No server, no port.
async function gql(app: ReturnType<typeof createApp>, query: string) {
  const res = await app.fetch("http://test/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

const ORDER = "gid://toy-shop/Order/1001";
const LINE = "gid://toy-shop/LineItem/10011";

describe("edit sessions", () => {
  it("test 1: a commit changes line 10011 to 5", async () => {
    const app = createApp();
    const begin = await gql(
      app,
      `mutation { orderEditBegin(id: "${ORDER}") {
  calculatedOrder { id } } }`,
    );
    const session = begin.data.orderEditBegin.calculatedOrder.id;
    await gql(
      app,
      `mutation { orderEditSetQuantity(id: "${session}", lineItemId: "${LINE}",
  quantity: 5) { userErrors { message } } }`,
    );
    const commit = await gql(
      app,
      `mutation { orderEditCommit(id: "${session}") { order {
  lineItems { edges { node { id quantity } } } } } }`,
    );
    const line = commit.data.orderEditCommit.order.lineItems.edges[0].node;
    expect(line.quantity).toBe(5);
  });

  it("test 2: a new app still has 15 on line 10011", async () => {
    const app = createApp();
    const read = await gql(
      app,
      `{ orders(query: "name:#1001") { edges { node {
  lineItems(first: 1) { edges { node { quantity } } } } } } }`,
    );
    const line = read.data.orders.edges[0].node.lineItems.edges[0].node;
    expect(line.quantity).toBe(15);
  });
});

describe("rules", () => {
  it("a negative quantity returns a userError", async () => {
    const app = createApp();
    const begin = await gql(
      app,
      `mutation { orderEditBegin(id: "${ORDER}") {
  calculatedOrder { id } } }`,
    );
    const session = begin.data.orderEditBegin.calculatedOrder.id;
    const set = await gql(
      app,
      `mutation { orderEditSetQuantity(id: "${session}",
  lineItemId: "${LINE}", quantity: -1) { userErrors { field message } } }`,
    );
    expect(set.data.orderEditSetQuantity.userErrors).toEqual([
      { field: ["quantity"], message: "Quantity must be 0 or more" },
    ]);
  });

  it("a query that costs more than 1,000 gets THROTTLED", async () => {
    const app = createApp();
    const res = await gql(
      app,
      `{ orders(first: 2000) { edges { node { id } } } }`,
    );
    expect(res.errors[0].extensions.code).toBe("THROTTLED");
    expect(res.extensions.cost.actualQueryCost).toBeNull();
  });
});

describe("bad input", () => {
  // One row per case: the mutation to send and the userError we expect back.
  it.each([
    {
      name: "unknown order",
      mutation: `mutation { orderEditBegin(id: "gid://toy-shop/Order/9999") { userErrors {
  field message } } }`,
      field: "orderEditBegin",
      error: { field: ["id"], message: "Order does not exist" },
    },
    {
      name: "unknown session",
      mutation: `mutation { orderEditSetQuantity(id: "gid://toy-shop/CalculatedOrder/9999",
  lineItemId: "${LINE}", quantity: 5) { userErrors { field message } } }`,
      field: "orderEditSetQuantity",
      error: { field: ["id"], message: "Calculated order does not exist" },
    },
    {
      name: "unknown session on commit",
      mutation: `mutation { orderEditCommit(id: "gid://toy-shop/CalculatedOrder/9999") {
  userErrors { field message } } }`,
      field: "orderEditCommit",
      error: { field: ["id"], message: "Calculated order does not exist" },
    },
  ])("$name returns a userError", async ({ mutation, field, error }) => {
    const app = createApp();
    const res = await gql(app, mutation);
    expect(res.data[field].userErrors).toEqual([error]);
  });

  it("a line from another order returns a userError", async () => {
    const app = createApp();
    const begin = await gql(
      app,
      `mutation { orderEditBegin(id: "${ORDER}") {
  calculatedOrder { id } } }`,
    );
    const session = begin.data.orderEditBegin.calculatedOrder.id;
    const set = await gql(
      app,
      `mutation { orderEditSetQuantity(id: "${session}",
  lineItemId: "gid://toy-shop/LineItem/99991", quantity: 5) { userErrors { field message } }
  }`,
    );
    expect(set.data.orderEditSetQuantity.userErrors).toEqual([
      {
        field: ["lineItemId"],
        message: "Line item does not exist on this order",
      },
    ]);
  });

  it("a second commit of the same session returns a userError", async () => {
    const app = createApp();
    const begin = await gql(
      app,
      `mutation { orderEditBegin(id: "${ORDER}") {
  calculatedOrder { id } } }`,
    );
    const session = begin.data.orderEditBegin.calculatedOrder.id;
    const commit = `mutation { orderEditCommit(id: "${session}") { userErrors { message } }
  }`;
    await gql(app, commit);
    const again = await gql(app, commit);
    expect(again.data.orderEditCommit.userErrors[0].message).toBe(
      "Calculated order does not exist",
    );
  });
});
