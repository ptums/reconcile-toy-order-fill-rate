import { MAX_ATTEMPTS, type Delivery } from "../queue/queue.ts";
import { applyOrder, PermanentError, type OrderResult } from "./apply-order.ts";
import type { Gql } from "./throttle.ts";

// Backoff with jitter: 1 s, 2 s, 4 s, 8 s, plus up to 1 s at random,
// so failed orders don't all come back at the same moment.
export const backoffMs = (attempt: number, random = Math.random) =>
  1000 * 2 ** (attempt - 1) + Math.floor(random() * 1000);

// What the worker did with 1 delivery. The CLI uses it for the progress and the summary.
export type Outcome = { orderId: string } & (
  | { status: "done"; result: OrderResult }
  | { status: "retry"; reason: string }
  | { status: "dead"; reason: string }
);

export async function handleDelivery(gql: Gql, d: Delivery): Promise<Outcome> {
  const { orderId } = d.message;
  try {
    const result = await applyOrder(gql, d.message);
    await d.ack(); // after the commit: at-least-once
    return { orderId, status: "done", result };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Permanent, or out of attempts: keep it in the dead letter for later.
    if (err instanceof PermanentError || d.attempt >= MAX_ATTEMPTS) {
      await d.deadLetter(reason);
      return { orderId, status: "dead", reason };
    }
    await d.nak(backoffMs(d.attempt)); // transient: try again later
    return { orderId, status: "retry", reason };
  }
}
