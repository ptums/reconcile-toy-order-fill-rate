import { describe, expect, test } from "vitest";

import { InMemoryQueue, type Queue, type QueueMessage } from "../src/index.js";

interface Row {
  row: number;
}

/** Worker code sees only the Queue interface, so it runs the same on NATS, SQS and the fake. */
async function publishRows(queue: Queue, rows: [order: string, row: number][]): Promise<void> {
  for (const [order, row] of rows) await queue.publish<Row>("orders.edit", order, { row });
}

describe("InMemoryQueue", () => {
  test("an acked message is delivered once and then removed", async () => {
    const queue = new InMemoryQueue();
    const seen: QueueMessage<Row>[] = [];
    await queue.consume<Row>("orders.edit", async (msg) => {
      seen.push(msg);
      await msg.ack();
    });
    await publishRows(queue, [["1001", 1]]);
    await queue.drain();
    expect(seen.map((m) => [m.groupKey, m.body, m.deliveryCount])).toEqual([["1001", { row: 1 }, 1]]);
    expect(queue.pending).toBe(0);
  });

  test("a nacked message comes back with a higher delivery count", async () => {
    const queue = new InMemoryQueue();
    const counts: number[] = [];
    await queue.consume<Row>("orders.edit", async (msg) => {
      counts.push(msg.deliveryCount);
      if (msg.deliveryCount < 3) await msg.nack();
      else await msg.ack();
    });
    await publishRows(queue, [["1001", 1]]);
    await queue.drain();
    expect(counts).toEqual([1, 2, 3]);
  });

  test("a handler that throws is nacked; after max deliveries the message is dead-lettered", async () => {
    const queue = new InMemoryQueue(3);
    let calls = 0;
    await queue.consume("orders.edit", async () => {
      calls += 1;
      throw new Error("order not found");
    });
    await publishRows(queue, [["1001", 1]]);
    await queue.drain();
    expect(calls).toBe(3);
    expect(queue.deadLetters).toHaveLength(1);
    expect(queue.pending).toBe(0);
  });

  test("messages of one group key keep their order, even across a retry", async () => {
    const queue = new InMemoryQueue();
    const done: string[] = [];
    let failedOnce = false;
    await queue.consume<Row>("orders.edit", async (msg) => {
      if (msg.groupKey === "1001" && msg.body.row === 1 && !failedOnce) {
        failedOnce = true;
        await msg.nack();
        return;
      }
      done.push(`${msg.groupKey}:${msg.body.row}`);
      await msg.ack();
    });
    await publishRows(queue, [["1001", 1], ["1001", 2], ["1002", 1]]);
    await queue.drain();
    const order1001 = done.filter((d) => d.startsWith("1001"));
    expect(order1001).toEqual(["1001:1", "1001:2"]);
    expect(done).toContain("1002:1");
    // Order 1002 did not wait for the retry of order 1001.
    expect(done.indexOf("1002:1")).toBeLessThan(done.indexOf("1001:1"));
  });

  test("a second publish with the same dedup ID is dropped", async () => {
    const queue = new InMemoryQueue();
    await queue.publish("orders.edit", "1001", { row: 1 }, { dedupId: "job-1:row-1" });
    await queue.publish("orders.edit", "1001", { row: 1 }, { dedupId: "job-1:row-1" });
    expect(queue.pending).toBe(1);
  });
});
