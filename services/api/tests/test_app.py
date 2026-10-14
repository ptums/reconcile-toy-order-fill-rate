from fastapi.testclient import TestClient

from reconciler_api.app import app


def test_health():
    assert TestClient(app).get("/health").json() == {"status": "ok"}
