"""Worker (consumer). Lesson 3 adds: take a row message, check the row status, diff, edit, record, ack."""

import asyncio

from store_client import GraphQLStoreClient, StoreConfig


async def main() -> None:
    store = GraphQLStoreClient(StoreConfig.from_env())
    print(f"worker ready, store={store.config.graphql_url}")


if __name__ == "__main__":
    asyncio.run(main())
