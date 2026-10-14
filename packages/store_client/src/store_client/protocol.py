from typing import Any, Protocol


class StoreClient(Protocol):
    """What the worker needs from a store. Tests can pass a fake that has this shape."""

    asyn c def execute(self, query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        """Run one GraphQL operation and return its `data`."""
        ...

    # Lesson 2, part 2 adds the order operations here:
    # find_order, begin_edit, set_quantity, commit_edit.
