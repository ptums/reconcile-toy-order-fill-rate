import { connect, type NatsConnection } from "@nats-io/transport-node";
import {
  jetstream,
  jetstreamManager,
  AckPolicy,
  RetentionPolicy,
  type JetStreamClient,
} from "@nats-io/jetstream";
import type { Delivery, Queue, RowMessage } from "./queue.ts";

const STREAM = "ROWS";
const CONSUMER = "workers";
// Each partition has its own consumer that takes 1 message at a time.
const PARTITIONS = 3;
const DEAD = "DEAD";

// "rows.<partition>.<order>": the same order always goes to the same partition.
const subjectFor = (orderId: string) => {
  const order = Number(orderId.split("/").pop());
  return `rows.${order % PARTITIONS}.${order}`;
};

export class NatsQueue implements Queue {
  private constructor(
    private nc: NatsConnection,
    private js: JetStreamClient,
  ) {}

  static async connect(servers = "localhost:4222"): Promise<NatsQueue> {
    const nc = await connect({ servers });
    const jsm = await jetstreamManager(nc);
    // Work queue: an ack deletes the message (Peter's choice B).
    await jsm.streams.add({
      name: STREAM,
      subjects: ["rows.>"],
      retention: RetentionPolicy.Workqueue,
    });
    // Dead letters: kept, not deleted, so you can read them later (choice A, a log).
    await jsm.streams.add({ name: DEAD, subjects: ["dead.>"] });
    // One consumer per partition. max_ack_pending 1: 1 message in flight per partition,
    // so 2 rows for the same order never run at the same time (like SQS MessageGroupId).
    for (let p = 0; p < PARTITIONS; p++) {
      await jsm.consumers.add(STREAM, {
        durable_name: `${CONSUMER}-${p}`,
        filter_subject: `rows.${p}.>`,
        ack_policy: AckPolicy.Explicit,
        ack_wait: 30_000_000_000, // nanoseconds (30 s)
        max_ack_pending: 1,
      });
    }
    return new NatsQueue(nc, jetstream(nc));
  }

  async publish(message: RowMessage): Promise<void> {
    // msgID: NATS drops a second publish with the same ID (2-minute window).
    await this.js.publish(
      subjectFor(message.orderId),
      JSON.stringify(message),
      {
        msgID: message.id,
      },
    );
  }

  async consume(handler: (delivery: Delivery) => Promise<void>): Promise<void> {
    // The partitions run in parallel. Inside 1 partition, messages run 1 at a time.
    const partitions = [];
    for (let p = 0; p < PARTITIONS; p++) {
      partitions.push(this.consumePartition(p, handler));
    }
    await Promise.all(partitions);
  }

  private async consumePartition(
    p: number,
    handler: (delivery: Delivery) => Promise<void>,
  ): Promise<void> {
    const consumer = await this.js.consumers.get(STREAM, `${CONSUMER}-${p}`);
    const messages = await consumer.consume();
    // The loop ends when close() drains the connection.
    for await (const m of messages) {
      await handler({
        message: m.json<RowMessage>(),
        attempt: m.info.deliveryCount,
        ack: async () => m.ack(),
        nak: async (delayMs) => m.nak(delayMs),
        deadLetter: async (reason) => {
          const message = m.json<RowMessage>();
          await this.js.publish(
            "dead.rows",
            JSON.stringify({ ...message, reason }),
          );
          m.ack(); // remove it from the work queue
        },
      });
    }
  }

  async close(): Promise<void> {
    await this.nc.drain();
  }
}
