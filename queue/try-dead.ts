import { NatsQueue } from "./nats.ts";
import { MAX_ATTEMPTS } from "./queue.ts";
const q = await NatsQueue.connect();
const run = Date.now();
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
setTimeout(() => q.close(), 3000); // stop after 3 seconds
await q.consume(async (d) => {
  console.log(`${d.message.sku} attempt ${d.attempt}`);
  if (d.message.sku === "NOT-ON-ORDER") {
    await d.deadLetter("Line item does not exist on this order");
  } else if (d.attempt >= MAX_ATTEMPTS) {
    await d.deadLetter(`THROTTLED ${MAX_ATTEMPTS} times`);
  } else {
    await d.nak(100); // try again in 100 ms
  }
});
