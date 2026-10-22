import { NatsQueue } from "./nats.ts";
const q = await NatsQueue.connect();
setTimeout(() => q.close(), 2000); // stop after 2 seconds
await q.consume(async (d) => {
  console.log(`attempt ${d.attempt}:`, d.message);
  await d.ack();
});
console.log("closed");
