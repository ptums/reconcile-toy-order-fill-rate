from typing import Any, Protocol

from store_client.models import CalculatedOrder, Order

class StoreClient(Protocol):
    """What the worker needs from a store. Tests can pass a fake that has this shape."""

    async def execute(self, query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        """Run one GraphQL operation and return its `data`."""
        ...

    async def find_order(self, order_name: str) -> Order | None:
        """Find one order by its name. None if the store has no such order."""
        ...

    async def begin_edit(self, order_id: str) -> CalculatedOrder:
        """Find the order to begin to edit"""
        ...

    async def set_quantity(self, calculated_order_id: str, line_item_id: str, quantity: int) -> None:
        """Set the order quantity to be updated"""
        ...
       
    async def commit_edit(self, calculated_order_id: str) -> None:
        """Commit recent order edits"""
        ...
