import type { GqlResult } from "./store-client.ts";

export type Gql = <T>(query: string) => Promise<GqlResult<T>>;
type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Wraps gql(). On THROTTLED, wait until the bucket has enough points, then send again.
// Tests pass a fake sleep, so they don't wait (the same idea as the fixed clock).
export function withThrottle(gql: Gql, sleep: Sleep = realSleep): Gql {
  return async <T>(query: string): Promise<GqlResult<T>> => {
    for (;;) {
      const res = await gql<T>(query);
      if (res.errors?.[0]?.extensions?.code !== "THROTTLED") return res;
      const { requestedQueryCost: cost, throttleStatus } = res.extensions!.cost;
      const { maximumAvailable, currentlyAvailable, restoreRate } =
        throttleStatus;
      // A query that costs more than a full bucket never fits. Waiting can't fix it.
      if (cost > maximumAvailable) {
        throw new Error(
          `Query costs ${cost}, more than the bucket holds (${maximumAvailable})`,
        );
      }
      await sleep(((cost - currentlyAvailable) / restoreRate) * 1000);
    }
  };
}
