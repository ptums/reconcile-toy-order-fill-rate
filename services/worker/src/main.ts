/** Worker (consumer). Lesson 3 adds: take a row message, check the row status, diff, edit, record, ack. */

import { GraphQLStoreClient, storeConfigFromEnv } from "@reconcile/store-client";

async function main(): Promise<void> {
  const store = new GraphQLStoreClient(storeConfigFromEnv());
  console.log(`worker ready, store=${store.config.graphqlUrl}`);
}

await main();
