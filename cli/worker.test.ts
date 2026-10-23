import { describe, expect, it } from "vitest";
import { createApp } from "../mock-store/app.ts";
import type { Delivery, OrderMessage } from "../queue/queue.ts";
import { storeClient } from "./store-client.ts";
import { withThrottle, type Gql } from "./throttle.ts";
import { backoffMs, handleDelivery } from "./worker.ts";

// A new mock store in memory, and a client for it.
function testGql() {
  const app = createApp();
  return withThrottle(storeClient("http://test/graphql", "t", (url, init) => app.fetch(url, init)));
}

// A store that is down: every request fails.
const downGql: Gql = async () => {
  throw new Error("fetch failed");
};

// A fake delivery that records what the worker called.
function fakeDelivery(orderId: string, attempt = 1) {
  const calls: string[] = [];
  const message: OrderMessage = { id: `test.csv:${orderId}`, orderId, lines: [] };
  const d: Delivery = {
    message,
    attempt,
    ack: async () => { calls.push("ack"); },
    nak: async (ms) => { calls.push(`nak ${ms}`); },
    deadLetter: async (reason) => { calls.push(`dead ${reason}`); },
  };
  return { d, calls };
}

describe("handleDelivery", () => {
  it("acks after the work is done", async () => {
    const { d, calls } = fakeDelivery("gid://toy-shop/Order/1002");
    const outcome = await handleDelivery(testGql(), d);
    expect(outcome.status).toBe("done");
    expect(calls).toEqual(["ack"]);
  });

  it("sends an unknown order to the dead letter at once", async () => {
    const { d, calls } = fakeDelivery("gid://toy-shop/Order/9999");
    await handleDelivery(testGql(), d);
    expect(calls).toEqual(["dead Order does not exist"]);
  });

  it("naks a transient error with a backoff", async () => {
    const { d, calls } = fakeDelivery("gid://toy-shop/Order/1002", 2);
    await handleDelivery(downGql, d);
    expect(calls[0]).toMatch(/^nak \d+$/);
  });

  it("sends a transient error to the dead letter on the last attempt", async () => {
    const { d, calls } = fakeDelivery("gid://toy-shop/Order/1002", 5);
    await handleDelivery(downGql, d);
    expect(calls).toEqual(["dead fetch failed"]);
  });
});

describe("backoffMs", () => {
  it.each([
    [1, 1000],
    [2, 2000],
    [3, 4000],
    [4, 8000],
  ])("attempt %i waits %i ms, plus up to 1 s of jitter", (attempt, base) => {
    expect(backoffMs(attempt, () => 0)).toBe(base);
    expect(backoffMs(attempt, () => 0.999)).toBe(base + 999);
  });
});
