"""Mock of a subset of the Shopify Admin GraphQL API.

This is not Shopify. It copies the shape of the operations the tool needs, so the
real API can replace it by configuration. Lesson 2, part 3 adds orders, order edits,
userErrors and the cost-based leaky bucket.
"""

import strawberry
from fastapi import FastAPI
from strawberry.fastapi import GraphQLRouter


@strawberry.type
class Shop:
    name: str


@strawberry.type
class Query:
    @strawberry.field
    def shop(self) -> Shop:
        return Shop(name="Mock Store")


schema = strawberry.Schema(query=Query)
app = FastAPI(title="Mock store (Shopify Admin GraphQL subset)")
app.include_router(GraphQLRouter(schema), prefix="/graphql")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
