"""Models: the data the store returns. Models describe data; the protocol describes behavior."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Order:
    """A real order in the store. Its id is a GID, for example gid://shopify/Order/1001."""

    id: str
    name: str  # what the CSV report uses, for example "#1001"


@dataclass(frozen=True)
class CalculatedLineItem:
    """A line item inside an edit session. Its id differs from the original line item's id."""

    id: str
    sku: str | None
    quantity: int


@dataclass(frozen=True)
class CalculatedOrder:
    """A draft copy of an order. Changes go here first; commit_edit saves them to the order."""

    id: str
    order_name: str
    line_items: list[CalculatedLineItem]
