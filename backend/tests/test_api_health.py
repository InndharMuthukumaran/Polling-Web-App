"""Tests for health check endpoints and error payload formats."""

import pytest
from app.api.deps import get_db
from app.main import app


def test_health_endpoint_without_database(client):
    """GET /health returns 200 ok even when the database is unreachable."""
    def broken_db():
        raise RuntimeError("Database connection unreachable")

    # Override get_db to simulate complete database outage
    app.dependency_overrides[get_db] = broken_db
    try:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_health_db_endpoint(client):
    """GET /health/db verifies database connectivity."""
    response = client.get("/health/db")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_error_response_envelope_format(client):
    """Every custom error response must have the shape {'error': {'code': '...', 'message': '...'}}."""
    # 1. Missing token (401)
    res_missing = client.get("/api/v1/me")
    assert res_missing.status_code == 401
    data_missing = res_missing.json()
    assert "error" in data_missing
    assert data_missing["error"]["code"] == "missing_token"
    assert "message" in data_missing["error"]

    # 2. Invalid token (401)
    res_invalid = client.get("/api/v1/me", headers={"X-Member-Token": "bad-token"})
    assert res_invalid.status_code == 401
    data_invalid = res_invalid.json()
    assert "error" in data_invalid
    assert data_invalid["error"]["code"] == "invalid_token"

    # 3. Not found (404)
    res_not_found = client.get("/api/v1/join/non-existent-join-code-999")
    assert res_not_found.status_code == 404
    data_not_found = res_not_found.json()
    assert "error" in data_not_found
    assert data_not_found["error"]["code"] == "not_found"

    # 4. Validation error (422)
    group_res = client.post("/api/v1/groups", json={"name": "Envelope Group"})
    group_data = group_res.json()
    admin_token = group_data["admin_token"]
    gid = group_data["group_id"]

    res_val = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_token},
        json={"display_names": ["Alice", ""]},
    )
    assert res_val.status_code == 422
    data_val = res_val.json()
    assert "error" in data_val
    assert data_val["error"]["code"] == "validation_error"
