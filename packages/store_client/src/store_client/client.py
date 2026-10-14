import os
from dataclasses import dataclass
from typing import Any

import httpx


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
