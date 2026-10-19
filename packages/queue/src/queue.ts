/**
 * One queue interface for every environment. The worker codes against `Queue` only:
 *
 * - Local (k3d): `NatsQueue`, NATS JetStream.
 * - AWS: `SqsQueue`, SQS FIFO.
 * - Unit tests: `InMemoryQueue`, a fake with the same delivery rules.
 *
 * Delivery rules (all adapters):
 *
 * 1. At-least-once delivery. A message can arrive more than once, so handlers must be
 *    idempotent (check the row status before an edit).
 * 2. `groupKey` is the partition key: the order ID. Messages with the same group key are
 *    delivered in publish order, one at a time. Messages with different keys can run in
 *    parallel. (SQS: MessageGroupId. NATS: the last subject token, `orders.edit.1001`.)
 * 3. `ack()` after the work is done: the queue deletes the message.
 * 4. `nack(delayMs)` when the work failed and a retry can help (a transient error): the
 *    queue delivers the message again after the delay.
 * 5. If the handler throws, the adapter calls `nack()` for it.
 * 6. If the handler returns without `ack()` or `nack()`, the queue delivers the message
 *    again after its timeout (NATS `ack_wait`, SQS visibility timeout). The fake does this
 *    at once.
 * 7. After too many deliveries the message goes to the dead-letter queue.
 */

export interface QueueMessage<T = unknown> {
  readonly subject: string;
  readonly groupKey: string;
  readonly body: T;
  /** 1 on the first delivery, 2 on the first redelivery, and so on. */
  readonly deliveryCount: number;
  /** The work is done. Delete the message. */
  ack(): Promise<void>;
  /** The work failed. Deliver the message again after `delayMs` (default 0). */
  nack(delayMs?: number): Promise<void>;
}

export type MessageHandler<T = unknown> = (message: QueueMessage<T>) => Promise<void>;

export interface PublishOptions {
  /**
   * The queue drops a second message with the same ID inside its dedup window
   * (NATS `Nats-Msg-Id`, SQS `MessageDeduplicationId`). For example `<job>:<row>`.
   */
  readonly dedupId?: string;
}

export interface Subscription {
  /** Stop taking new messages. Messages in flight are not acked. */
  stop(): Promise<void>;
}

export interface Queue {
  /** Publish one message. `groupKey` is the partition key (the order ID). */
  publish<T>(subject: string, groupKey: string, body: T, options?: PublishOptions): Promise<void>;

  /** Call `handler` for each message published to `subject`, for every group key. */
  consume<T>(subject: string, handler: MessageHandler<T>): Promise<Subscription>;

  close(): Promise<void>;
}
