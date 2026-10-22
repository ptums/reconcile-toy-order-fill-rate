import { NatsQueue } from "./nats.ts";
import { MAX_ATTEMPTS } from "./queue.ts";

const q = await NatsQueue.connect();
const run = Date.now();

// A and B: the same order (1001). C: another order (1002).
await q.publish({
  id: `A:${run}`,
  orderId: "gid://shopify/Order/1001",
  sku: "THROTTLED",
  quantity: 0,
});
await q.publish({
  id: `B:${run}`,
  orderId: "gid://shopify/Order/1001",
  sku: "NOT-ON-ORDER",
  quantity: 0,
});
await q.publish({
  id: `C:${run}`,
  orderId: "gid://shopify/Order/1002",
  sku: "OK",
  quantity: 0,
});

setTimeout(() => q.close(), 3000); // stop after 3 seconds

await q.consume(async (d) => {
  const order = d.message.orderId.split("/").pop();
  console.log(
    `${Date.now() - run} ms  order ${order}  ${d.message.sku} attempt ${d.attempt}`,
  );
  if (d.message.sku === "OK") await d.ack();
  else if (d.message.sku === "NOT-ON-ORDER")
    await d.deadLetter("Line item does not exist on this order");
  else if (d.attempt >= MAX_ATTEMPTS)
    await d.deadLetter(`THROTTLED ${MAX_ATTEMPTS} times`);
  else await d.nak(100); // try again in 100 ms
});
