import type { MessageHandler, PublishOptions, Queue, QueueMessage, Subscription } from "./queue.js";

interface Stored {
  subject: string;
  groupKey: string;
  body: unknown;
  deliveryCount: number;
}

/**
 * A fake queue for unit tests. It follows the rules in queue.ts, with no timers:
 * call `drain()` to deliver messages until no work is left.
 *
 * - Each group key is a FIFO lane. A nacked message stays at the head of its lane,
 *   so later messages of the same order wait (like SQS FIFO).
 * - Lanes take turns (round-robin), so one big order does not block the others.
 * - After `maxDeliveries` deliveries, a message moves to `deadLetters`.
 */
export class InMemoryQueue implements Queue {
  readonly deadLetters: Stored[] = [];
  private readonly lanes = new Map<string, Stored[]>();
  private readonly handlers = new Map<string, MessageHandler<unknown>>();
  private readonly seenDedupIds = new Set<string>();

  constructor(private readonly maxDeliveries = 5) {}

  async publish<T>(subject: string, groupKey: string, body: T, options: PublishOptions = {}): Promise<void> {
    if (options.dedupId !== undefined) {
      if (this.seenDedupIds.has(options.dedupId)) return;
      this.seenDedupIds.add(options.dedupId);
    }
    const key = `${subject}\u0000${groupKey}`;
    const lane = this.lanes.get(key) ?? [];
    lane.push({ subject, groupKey, body, deliveryCount: 0 });
    this.lanes.set(key, lane);
  }

  async consume<T>(subject: string, handler: MessageHandler<T>): Promise<Subscription> {
    this.handlers.set(subject, handler as MessageHandler<unknown>);
    return { stop: async () => void this.handlers.delete(subject) };
  }

  /** Messages that are not acked yet and not dead-lettered. */
  get pending(): number {
    let n = 0;
    for (const lane of this.lanes.values()) n += lane.length;
    return n;
  }

  /** Deliver messages, one lane head at a time, until every lane with a consumer is empty. */
  async drain(): Promise<void> {
    for (;;) {
      let delivered = false;
      for (const [key, lane] of [...this.lanes]) {
        const head = lane[0];
        if (!head) {
          this.lanes.delete(key);
          continue;
        }
        const handler = this.handlers.get(head.subject);
        if (!handler) continue;
        delivered = true;
        await this.deliver(lane, head, handler);
      }
      if (!delivered) return;
    }
  }

  private async deliver(lane: Stored[], stored: Stored, handler: MessageHandler<unknown>): Promise<void> {
    stored.deliveryCount += 1;
    // An object, so TypeScript does not narrow the value that the callbacks change.
    const state: { settled: "ack" | "nack" | null } = { settled: null };
    const message: QueueMessage<unknown> = {
      subject: stored.subject,
      groupKey: stored.groupKey,
      body: stored.body,
      deliveryCount: stored.deliveryCount,
      ack: async () => void (state.settled ??= "ack"),
      nack: async () => void (state.settled ??= "nack"), // the fake ignores the delay
    };
    try {
      await handler(message);
    } catch {
      state.settled ??= "nack";
    }
    if (state.settled === "ack") {
      lane.shift();
    } else if (stored.deliveryCount >= this.maxDeliveries) {
      // A nack, or no answer at all (rule 6), counts as a failed delivery.
      lane.shift();
      this.deadLetters.push(stored);
    }
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}
