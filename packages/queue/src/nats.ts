import { jetstream, type JetStreamClient, type JsMsg } from "@nats-io/jetstream";
import { connect, type NatsConnection } from "@nats-io/transport-node";

import type { MessageHandler, PublishOptions, Queue, QueueMessage, Subscription } from "./queue.js";

export interface NatsQueueOptions {
  /** The JetStream stream that holds the subjects, for example "ORDERS". */
  readonly stream: string;
  /** The durable pull consumer that workers share, for example "worker". */
  readonly consumer: string;
}

/**
 * Queue adapter for NATS JetStream (local, k3d).
 *
 * The group key becomes the last subject token: publish("orders.edit", "1001") goes to
 * `orders.edit.1001`. Workers share one durable pull consumer, so each message goes to
 * one worker.
 *
 * TODO (Lesson 3): create the stream and the consumer (jetstreamManager) with
 * `ack_wait`, `max_deliver` and a dead-letter subject. TODO: real per-order ordering.
 * One shared consumer does not stop two workers from taking two messages of the same
 * order at the same time. Options: a consumer per partition with `max_ack_pending: 1`,
 * or NATS subject-mapping partitions. TODO: encode group keys that contain ".", "*" or ">".
 */
export class NatsQueue implements Queue {
  private readonly js: JetStreamClient;

  constructor(
    private readonly nc: NatsConnection,
    private readonly options: NatsQueueOptions,
  ) {
    this.js = jetstream(nc);
  }

  static async connect(url: string, options: NatsQueueOptions): Promise<NatsQueue> {
    return new NatsQueue(await connect({ servers: url }), options);
  }

  async publish<T>(subject: string, groupKey: string, body: T, options: PublishOptions = {}): Promise<void> {
    await this.js.publish(`${subject}.${groupKey}`, JSON.stringify(body), {
      ...(options.dedupId !== undefined ? { msgID: options.dedupId } : {}),
    });
  }

  async consume<T>(subject: string, handler: MessageHandler<T>): Promise<Subscription> {
    // TODO (Lesson 3): check that the consumer's filter subject is `${subject}.>`.
    const consumer = await this.js.consumers.get(this.options.stream, this.options.consumer);
    const messages = await consumer.consume();
    const loop = (async () => {
      for await (const msg of messages) {
        const message = toQueueMessage<T>(subject, msg);
        try {
          await handler(message);
        } catch {
          await message.nack();
        }
      }
    })();
    return {
      stop: async () => {
        await messages.close();
        await loop;
      },
    };
  }

  async close(): Promise<void> {
    await this.nc.drain();
  }
}

function toQueueMessage<T>(subject: string, msg: JsMsg): QueueMessage<T> {
  return {
    subject,
    groupKey: msg.subject.slice(subject.length + 1),
    body: msg.json<T>(),
    deliveryCount: msg.info.deliveryCount,
    ack: async () => msg.ack(),
    nack: async (delayMs?: number) => msg.nak(delayMs),
  };
}
