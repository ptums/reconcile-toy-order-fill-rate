import { NatsQueue } from "./nats.ts";
const q = await NatsQueue.connect();
const row = {
  id: "report.csv:1",
  orderId: "gid://shopify/Order/1001",
  sku: "8876963",
  quantity: 0,
};
await q.publish(row);
await q.publish(row); // same id: NATS drops it
await q.close();
