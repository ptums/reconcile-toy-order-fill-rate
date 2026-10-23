import { basename } from "node:path";
import { parseArgs } from "node:util";
import { NatsQueue } from "../queue/nats.ts";
import type { OrderResult } from "./apply-order.ts";
import { readReport } from "./report.ts";
import { storeClient } from "./store-client.ts";
import { withThrottle } from "./throttle.ts";
import { handleDelivery } from "./worker.ts";

const { values } = parseArgs({ options: { file: { type: "string" } } });
if (!values.file) {
  console.error("Usage: pnpm reconcile --file=<report>.csv");
  process.exit(1);
}
const file = basename(values.file);

// The store and the queue come from env vars, so the real Toy-Shop API can replace the mock.
const STORE_URL = process.env.STORE_URL ?? "http://localhost:8001/graphql";
const STORE_TOKEN = process.env.STORE_TOKEN ?? "local-dev";
const NATS_URL = process.env.NATS_URL ?? "localhost:4222";

const orders = readReport(values.file);
const run = Date.now(); // Peter's choice A: the run ID makes each run's messages new
const queue = await NatsQueue.connect(NATS_URL);
const gql = withThrottle(storeClient(STORE_URL, STORE_TOKEN));

// 1. Publish 1 message for each order.
for (const order of orders) {
  await queue.publish({ id: `${file}:${order.orderId}:${run}`, ...order });
}
console.log(`Queued ${orders.length} orders from ${file}`);

// 2. Work until each order of this run is done or in the dead letter.
const done = new Map<string, OrderResult>();
const dead = new Map<string, string>();
await queue.consume(async (d) => {
  const outcome = await handleDelivery(gql, d);
  const name = `#${outcome.orderId.split("/").pop()}`;
  if (!d.message.id.endsWith(`:${run}`)) return; // an old message from an earlier run
  if (outcome.status === "done") {
    done.set(name, outcome.result);
    console.log(`${name} done: ${outcome.result.changed} changed, ${outcome.result.rejected.length} rejected`);
  } else if (outcome.status === "dead") {
    dead.set(name, outcome.reason);
    console.log(`${name} dead letter: ${outcome.reason}`);
  } else {
    console.log(`${name} retry (attempt ${d.attempt}): ${outcome.reason}`);
  }
  if (done.size + dead.size === orders.length) void queue.close(); // stops the consume loop
});

// 3. Summary: the lines that changed, and the ones that need a person (like the legacy createFailure).
const changed = [...done.values()].reduce((sum, r) => sum + r.changed, 0);
console.log(`\n${changed} lines changed in ${done.size} orders. ${dead.size} orders in the dead letter.`);
for (const [name, result] of done) {
  for (const r of result.rejected) console.log(`  Rejected ${name} ${r.sku}: ${r.message}`);
}
for (const [name, reason] of dead) console.log(`  Dead letter ${name}: ${reason}`);
