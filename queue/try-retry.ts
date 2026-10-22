import { NatsQueue } from "./nats.ts";
const q = await NatsQueue.connect();
await q.publish({
  id: `retry:${Date.now()}`,
  orderId: "gid://shopify/Order/1001",
  sku: "8876963",
  quantity: 0,
});
const start = Date.now();
setTimeout(() => q.close(), 3000); // stop after 3 seconds
await q.consume(async (d) => {
  console.log(`attempt ${d.attempt} at ${Date.now() - start} ms`);
  if (d.attempt === 1)
    await d.nak(1000); // pretend THROTTLED: try again in 1 s
  else await d.ack();
});
