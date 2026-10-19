import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from "@aws-sdk/client-sqs";

import type { MessageHandler, PublishOptions, Queue, QueueMessage, Subscription } from "./queue.js";

/** The part of SQSClient this adapter uses. Tests pass a fake `send`. */
export type SqsSender = Pick<SQSClient, "send">;

export interface SqsQueueOptions {
  /** One FIFO queue URL (ends in `.fifo`) for each subject, for example { "orders.edit": "https://..." }. */
  readonly queueUrls: Readonly<Record<string, string>>;
  /** Long-poll wait for each receive call, 0 to 20 seconds. */
  readonly waitTimeSeconds?: number;
}

/**
 * Queue adapter for Amazon SQS FIFO (AWS).
 *
 * The group key is the MessageGroupId (the order ID). SQS FIFO delivers the messages of
 * one group in order and holds the group while a message is in flight, so one order has
 * one writer at a time.
 *
 * TODO (later lesson): the dead-letter queue is a redrive policy on the queue
 * (`maxReceiveCount`), set up by the AWS CLI scripts in infra/. TODO: run handlers for
 * different groups in parallel; this loop handles one message at a time.
 */
export class SqsQueue implements Queue {
  constructor(
    private readonly sqs: SqsSender,
    private readonly options: SqsQueueOptions,
  ) {}

  private urlFor(subject: string): string {
    const url = this.options.queueUrls[subject];
    if (!url) throw new Error(`No SQS queue URL for subject "${subject}"`);
    return url;
  }

  async publish<T>(subject: string, groupKey: string, body: T, options: PublishOptions = {}): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.urlFor(subject),
        MessageBody: JSON.stringify(body),
        MessageGroupId: groupKey,
        // Without an ID, the queue must have ContentBasedDeduplication turned on.
        ...(options.dedupId !== undefined ? { MessageDeduplicationId: options.dedupId } : {}),
      }),
    );
  }

  async consume<T>(subject: string, handler: MessageHandler<T>): Promise<Subscription> {
    const queueUrl = this.urlFor(subject);
    let running = true;
    const loop = (async () => {
      while (running) {
        const result = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: this.options.waitTimeSeconds ?? 20,
            MessageSystemAttributeNames: ["ApproximateReceiveCount", "MessageGroupId"],
          }),
        );
        for (const msg of result.Messages ?? []) {
          const message = this.toQueueMessage<T>(subject, queueUrl, msg);
          try {
            await handler(message);
          } catch {
            await message.nack();
          }
        }
      }
    })();
    return {
      stop: async () => {
        running = false;
        await loop;
      },
    };
  }

  private toQueueMessage<T>(subject: string, queueUrl: string, msg: Message): QueueMessage<T> {
    const receiptHandle = msg.ReceiptHandle ?? "";
    return {
      subject,
      groupKey: msg.Attributes?.MessageGroupId ?? "",
      body: JSON.parse(msg.Body ?? "null") as T,
      deliveryCount: Number(msg.Attributes?.ApproximateReceiveCount ?? 1),
      ack: async () => {
        await this.sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
      },
      nack: async (delayMs = 0) => {
        await this.sqs.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: receiptHandle,
            VisibilityTimeout: Math.ceil(delayMs / 1000),
          }),
        );
      },
    };
  }

  async close(): Promise<void> {}
}
