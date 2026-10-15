import os
from dataclasses import dataclass
from typing import Any

import httpx

from store_client.models import CalculatedLineItem, CalculatedOrder, Order


class StoreError(Exception):
    """The store returned GraphQL errors."""


class ThrottledError(StoreError):
    """The store's rate-limit bucket is empty. A transient error: retry after a wait."""


@dataclass(frozen=True)
class ThrottleStatus:
    """The rate-limit data from `extensions.cost.throttleStatus` in each response."""

    maximum_available: float
    currently_available: float
    restore_rate: float

    def wait_seconds(self, cost: float) -> float:
        """Seconds to wait before a query with this cost can run (Lesson 1, part 3)."""
        return max(0.0, (cost - self.currently_available) / self.restore_rate)


@dataclass(frozen=True)
class StoreConfig:
    graphql_url: str
    token: str

    @classmethod
    def from_env(cls) -> "StoreConfig":
        return cls(
            graphql_url=os.environ.get("STORE_GRAPHQL_URL", "http://localhost:8001/graphql"),
            token=os.environ.get("STORE_TOKEN", "mock-token"),
        )


class GraphQLStoreClient:
    """One GraphQL client for the mock and for real Shopify. Queries always use variables."""

    def __init__(self, config: StoreConfig, http: httpx.AsyncClient | None = None):
        self.config = config
        self.http = http or httpx.AsyncClient(timeout=30)
        self.last_throttle: ThrottleStatus | None = None

    async def execute(self, query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        response = await self.http.post(
            self.config.graphql_url,
            json={"query": query, "variables": variables or {}},
            headers={"X-Shopify-Access-Token": self.config.token},
        )
        response.raise_for_status()
        body = response.json()

        throttle = body.get("extensions", {}).get("cost", {}).get("throttleStatus")
        if throttle:
            self.last_throttle = ThrottleStatus(
                maximum_available=throttle["maximumAvailable"],
                currently_available=throttle["currentlyAvailable"],
                restore_rate=throttle["restoreRate"],
            )

        errors = body.get("errors") or []
        if any(e.get("extensions", {}).get("code") == "THROTTLED" for e in errors):
            raise ThrottledError(errors)
        if errors:
            raise StoreError(errors)
        return body["data"]

    # Order operations. Same GraphQL operations as legacy/utils/regular-queries.js, but with
    # variables instead of string building, and userErrors raised instead of ignored.

    async def find_order(self, order_name: str) -> Order | None:
        data = await self.execute(FIND_ORDER, {"query": f"name:{order_name}"})
        edges = data["orders"]["edges"]
        if not edges:
            return None
        node = edges[0]["node"]
        return Order(id=node["id"], name=node["name"])

    async def begin_edit(self, order_id: str) -> CalculatedOrder:
        data = await self.execute(BEGIN_EDIT, {"id": order_id})
        result = data["orderEditBegin"]
        raise_user_errors(result)
        calc = result["calculatedOrder"]
        return CalculatedOrder(
            id=calc["id"],
            order_name=calc["originalOrder"]["name"],
            line_items=[
                CalculatedLineItem(id=e["node"]["id"], sku=e["node"]["sku"], quantity=e["node"]["quantity"])
                for e in calc["lineItems"]["edges"]
            ],
        )

    async def set_quantity(self, calculated_order_id: str, line_item_id: str, quantity: int) -> None:
        data = await self.execute(
            SET_QUANTITY, {"id": calculated_order_id, "lineItemId": line_item_id, "quantity": quantity}
        )
        raise_user_errors(data["orderEditSetQuantity"])

    async def commit_edit(self, calculated_order_id: str) -> None:
        data = await self.execute(COMMIT_EDIT, {"id": calculated_order_id})
        raise_user_errors(data["orderEditCommit"])


def raise_user_errors(result: dict[str, Any]) -> None:
    """Mutations report business errors in userErrors with HTTP 200. The 2021 code ignored them."""
    if result.get("userErrors"):
        raise StoreError(result["userErrors"])


FIND_ORDER = """
query FindOrder($query: String!) {
  orders(first: 1, query: $query) { edges { node { id name } } }
}
"""

BEGIN_EDIT = """
mutation BeginEdit($id: ID!) {
  orderEditBegin(id: $id) {
    calculatedOrder {
      id
      originalOrder { name }
      lineItems(first: 250) { edges { node { id sku quantity } } }
    }
    userErrors { field message }
  }
}
"""

SET_QUANTITY = """
mutation SetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!) {
  orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity) {
    calculatedOrder { id }
    userErrors { field message }
  }
}
"""

COMMIT_EDIT = """
mutation CommitEdit($id: ID!) {
  orderEditCommit(id: $id) {
    order { id }
    userErrors { field message }
  }
}
"""
