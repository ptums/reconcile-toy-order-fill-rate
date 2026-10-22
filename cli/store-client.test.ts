import { describe, expect, it } from "vitest";
import { createApp } from "../mock-store/app.ts";
import { storeClient } from "./store-client.ts";

const STORE_URL = "http://test/graphql";

// A client for a new mock store in memory. No server, no port.
function testClient() {
  const app = createApp();
  return storeClient(STORE_URL, "test-token", (url, init) =>
    app.fetch(url, init),
  );
}

describe("storeClient", () => {
  it("reads an order and the cost", async () => {
    const gql = testClient();
    const res = await gql<{ orders: { edges: { node: { name: string } }[] } }>(
      `{ orders(first: 1, query: "name:1001") { edges { node { name } } } }`,
    );
    expect(res.data?.orders.edges[0]?.node.name).toBe("#1001");
    expect(res.extensions?.cost.throttleStatus.currentlyAvailable).toBeLessThan(
      1000,
    );
  });

  it("returns THROTTLED when the query costs too much", async () => {
    const gql = testClient();
    const res = await gql(`{ orders(first: 2000) { edges { node { id } } } }`);
    expect(res.errors?.[0]?.extensions?.code).toBe("THROTTLED");
  });
});
