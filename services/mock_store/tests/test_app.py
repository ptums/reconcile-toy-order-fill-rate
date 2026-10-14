from fastapi.testclient import TestClient

from mock_store.app import app

client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_graphql_shop_query():
    response = client.post("/graphql", json={"query": "{ shop { name } }"})
    assert response.json() == {"data": {"shop": {"name": "Mock Store"}}}
