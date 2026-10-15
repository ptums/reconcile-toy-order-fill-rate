"""The four order operations, against a fake HTTP transport (no network, no mock store yet)."""

import json

import httpx
import pytest

from store_client import CalculatedOrder, GraphQLStoreClient, Order, StoreConfig, StoreError


def client_returning(data: dict, seen: list | None = None) -> GraphQLStoreClient:
    """A client whose store always answers with `data`. Records each request body in `seen`."""

    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(json.loads(request.content))
        return httpx.Response(200, json={"data": data})

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return GraphQLStoreClient(StoreConfig(graphql_url="http://store.test/graphql", token="t"), http)


async def test_find_order_returns_the_order_and_sends_the_name_as_a_variable():
    seen: list = []
    client = client_returning(
        {"orders": {"edges": [{"node": {"id": "gid://shopify/Order/1", "name": "#1001"}}]}}, seen
    )
    assert await client.find_order("#1001") == Order(id="gid://shopify/Order/1", name="#1001")
    assert seen[0]["variables"] == {"query": "name:#1001"}  # a variable, never pasted into the query


async def test_find_order_returns_none_when_the_store_has_no_match():
    client = client_returning({"orders": {"edges": []}})
    assert await client.find_order("#9999") is None


async def test_begin_edit_returns_a_calculated_order_with_its_own_ids():
    client = client_returning(
        {
            "orderEditBegin": {
                "calculatedOrder": {
                    "id": "gid://shopify/CalculatedOrder/7",
                    "originalOrder": {"name": "#1001"},
                    "lineItems": {
                        "edges": [{"node": {"id": "gid://shopify/CalculatedLineItem/3", "sku": "TOY-1", "quantity": 12}}]
                    },
                },
                "userErrors": [],
            }
        }
    )
    calc = await client.begin_edit("gid://shopify/Order/1")
    assert isinstance(calc, CalculatedOrder)
    assert calc.id == "gid://shopify/CalculatedOrder/7"
    assert calc.line_items[0].quantity == 12


async def test_set_quantity_raises_on_user_errors_that_the_2021_code_ignored():
    client = client_returning(
        {"orderEditSetQuantity": {"calculatedOrder": None, "userErrors": [{"field": ["quantity"], "message": "bad"}]}}
    )
    with pytest.raises(StoreError):
        await client.set_quantity("gid://shopify/CalculatedOrder/7", "gid://shopify/CalculatedLineItem/3", -1)


async def test_commit_edit_sends_the_calculated_order_id():
    seen: list = []
    client = client_returning({"orderEditCommit": {"order": {"id": "gid://shopify/Order/1"}, "userErrors": []}}, seen)
    await client.commit_edit("gid://shopify/CalculatedOrder/7")
    assert seen[0]["variables"] == {"id": "gid://shopify/CalculatedOrder/7"}
