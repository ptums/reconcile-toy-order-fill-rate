import { describe, expect, it } from "vitest";
import type { GqlResult } from "./store-client.ts";
import { withThrottle, type Gql } from "./throttle.ts";

// A THROTTLED answer from the store, with the bucket numbers.
const throttled = (cost: number, available: number): GqlResult<never> => ({
  errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
  extensions: {
    cost: {
      requestedQueryCost: cost,
      actualQueryCost: null,
      throttleStatus: {
        maximumAvailable: 1000,
        currentlyAvailable: available,
        restoreRate: 50,
      },
    },
  },
});

// A fake store: it sends back the answers in order.
function fakeGql(answers: GqlResult<unknown>[]): Gql {
  return async <T>() => answers.shift() as GqlResult<T>;
}

describe("withThrottle", () => {
  it("waits (cost - available) / 50 seconds, then sends again", async () => {
    const waits: number[] = [];
    const gql = withThrottle(
      fakeGql([throttled(260, 10), { data: { ok: true } }]),
      async (ms) => {
        waits.push(ms);
      },
    );
    const res = await gql<{ ok: boolean }>("{ ok }");
    expect(waits).toEqual([5000]); // (260 - 10) / 50 = 5 seconds
    expect(res.data).toEqual({ ok: true });
  });

  it("does not wait for a query that never fits", async () => {
    const gql = withThrottle(fakeGql([throttled(2010, 1000)]), async () => {});
    await expect(gql("{ big }")).rejects.toThrow("more than the bucket holds");
  });
});
