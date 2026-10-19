import { ReceiveMessageCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import { expect, test } from "vitest";

import { SqsQueue, type SqsSender } from "../src/index.js";

const URL = "https://sqs.us-east-1.amazonaws.com/000000000000/orders-edit.fifo";

/** A fake SQS client that records each command and answers receives from a list. */
function fakeSqs(receives: unknown[][] = []) {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const sender = {
    send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input });
      if (command instanceof ReceiveMessageCommand) return { Messages: receives.shift() ?? [] };
      return {};
    },
  } as unknown as SqsSender;
  return { sender, sent };
}

test("publish uses the group key as the MessageGroupId", async () => {
  const { sender, sent } = fakeSqs();
  const queue = new SqsQueue(sender, { queueUrls: { "orders.edit": URL } });
  await queue.publish("orders.edit", "1001", { row: 7 }, { dedupId: "job-1:row-7" });
  expect(sent).toEqual([
    {
      name: SendMessageCommand.name,
      input: {
        QueueUrl: URL,
        MessageBody: JSON.stringify({ row: 7 }),
        MessageGroupId: "1001",
        MessageDeduplicationId: "job-1:row-7",
      },
    },
  ]);
});

test("ack deletes the message; a thrown handler changes its visibility instead", async () => {
  const messages = [
    { Body: '{"row":1}', ReceiptHandle: "r1", Attributes: { MessageGroupId: "1001", ApproximateReceiveCount: "1" } },
    { Body: '{"row":2}', ReceiptHandle: "r2", Attributes: { MessageGroupId: "1001", ApproximateReceiveCount: "2" } },
  ];
  const { sender, sent } = fakeSqs([messages]);
  const queue = new SqsQueue(sender, { queueUrls: { "orders.edit": URL }, waitTimeSeconds: 0 });

  let secondHandled!: () => void;
  const handled = new Promise<void>((resolve) => (secondHandled = resolve));
  const subscription = await queue.consume<{ row: number }>("orders.edit", async (msg) => {
    if (msg.body.row === 1) {
      expect(msg.deliveryCount).toBe(1);
      await msg.ack();
      return;
    }
    secondHandled();
    throw new Error("transient");
  });
  await handled;
  await subscription.stop(); // waits for the loop, so the nack has been sent

  const names = sent.map((s) => s.name);
  expect(names).toContain("DeleteMessageCommand");
  expect(names).toContain("ChangeMessageVisibilityCommand");
  expect(sent.find((s) => s.name === "DeleteMessageCommand")?.input).toEqual({ QueueUrl: URL, ReceiptHandle: "r1" });
});
