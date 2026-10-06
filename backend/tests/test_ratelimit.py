"""Tests for rate limiting, proxy resolution, bounded memory, and capped upload reads."""

import io
import time
from unittest.mock import MagicMock
import pytest
from starlette.datastructures import Headers

from app.config import settings
from app.errors import RateLimitError
from app.ratelimit import RateLimiter, get_client_ip, lookup_limiter
from app.services.importer import MAX_FILE_SIZE


# ---------------------------------------------------------------------------
# 1. Helper Unit Tests: get_client_ip
# ---------------------------------------------------------------------------

def test_get_client_ip_trusted_proxy_count_zero():
    """When TRUSTED_PROXY_COUNT is 0, ignore X-Forwarded-For completely and use client.host."""
    req = MagicMock()
    req.client.host = "192.168.1.100"
    req.headers = {"x-forwarded-for": "1.2.3.4, 5.6.7.8"}

    ip = get_client_ip(req, trusted_proxy_count=0)
    assert ip == "192.168.1.100"


def test_get_client_ip_trusted_proxy_count_n():
    """When TRUSTED_PROXY_COUNT is N > 0, pick entry N positions from the right."""
    req = MagicMock()
    req.client.host = "127.0.0.1"

    # N = 1 (single reverse proxy) -> rightmost entry
    req.headers = {"x-forwarded-for": "client.ip, proxy.internal"}
    assert get_client_ip(req, trusted_proxy_count=1) == "proxy.internal"

    # N = 2 (e.g. Cloudflare + load balancer) -> 2nd from right
    req.headers = {"x-forwarded-for": "client.ip, cloudflare.ip, lb.ip"}
    assert get_client_ip(req, trusted_proxy_count=2) == "cloudflare.ip"


def test_get_client_ip_fallback_when_missing_or_too_short():
    """Falls back to request.client.host when header is missing or has fewer than N entries."""
    req = MagicMock()
    req.client.host = "10.0.0.1"

    # Missing header
    req.headers = {}
    assert get_client_ip(req, trusted_proxy_count=1) == "10.0.0.1"

    # Header has 1 entry, but N = 2
    req.headers = {"x-forwarded-for": "only_one"}
    assert get_client_ip(req, trusted_proxy_count=2) == "10.0.0.1"


# ---------------------------------------------------------------------------
# 2. RateLimiter Unit Tests: Bounded Memory & Expired Key Cleanup
# ---------------------------------------------------------------------------

def test_ratelimiter_expired_keys_removed_on_check():
    """Expired keys are deleted from memory when checked."""
    clock_time = 1000.0
    limiter = RateLimiter(default_limit=2, window_seconds=60.0, clock=lambda: clock_time)

    limiter.record("key1")
    assert "key1" in limiter._entries

    # Advance clock past window
    clock_time += 61.0

    # check() cleans up expired timestamps and removes the key
    limiter.check("key1")
    assert "key1" not in limiter._entries


def test_ratelimiter_periodic_cleanup_pass():
    """A full cleanup pass removes all expired keys after cleanup_interval."""
    clock_time = 1000.0
    limiter = RateLimiter(
        default_limit=5,
        window_seconds=60.0,
        clock=lambda: clock_time,
        cleanup_interval=60.0,
    )

    limiter.record("k1")
    limiter.record("k2")
    assert len(limiter._entries) == 2

    # Advance clock by 65 seconds
    clock_time += 65.0

    # Any operation triggers _maybe_cleanup
    limiter.record("k3")
    assert "k1" not in limiter._entries
    assert "k2" not in limiter._entries
    assert "k3" in limiter._entries


def test_ratelimiter_key_cap_evicts_oldest_latest_timestamp():
    """When max_keys is reached, drop the key with the oldest latest timestamp."""
    clock_time = 100.0
    limiter = RateLimiter(
        default_limit=10,
        window_seconds=60.0,
        clock=lambda: clock_time,
        max_keys=3,
        cleanup_interval=9999.0,  # disable periodic cleanup for this test
    )

    # Insert 3 keys at t=100, 110, 120
    clock_time = 100.0
    limiter.record("key_a")
    clock_time = 110.0
    limiter.record("key_b")
    clock_time = 120.0
    limiter.record("key_c")

    assert len(limiter._entries) == 3

    # Insert 4th key at t=130: key_a has oldest latest timestamp (100.0), so key_a is evicted
    clock_time = 130.0
    limiter.record("key_d")
    assert len(limiter._entries) == 3
    assert "key_a" not in limiter._entries
    assert set(limiter._entries.keys()) == {"key_b", "key_c", "key_d"}

    # Record new attempt on key_b at t=140 (key_b's latest is now 140)
    clock_time = 140.0
    limiter.record("key_b")

    # Insert 5th key at t=150: latest timestamps: key_c=120, key_d=130, key_b=140
    # Oldest is key_c (120), so key_c is evicted
    clock_time = 150.0
    limiter.record("key_e")
    assert len(limiter._entries) == 3
    assert "key_c" not in limiter._entries
    assert set(limiter._entries.keys()) == {"key_b", "key_d", "key_e"}


# ---------------------------------------------------------------------------
# 3. Endpoint Integration Tests: Lookup Rate Limiting
# ---------------------------------------------------------------------------

def test_lookup_spoofed_x_forwarded_for_blocked(client):
    """With default settings (TRUSTED_PROXY_COUNT=0), 40 failed lookups with different fake X-Forwarded-For get blocked at 31."""
    lookup_limiter.reset()

    # Create group with identifier
    g_res = client.post("/api/v1/groups", json={"name": "Spoof Test Group"}).json()
    group_id = g_res["group_id"]
    join_code = g_res["join_code"]
    token = g_res["admin_token"]

    f_res = client.post(
        f"/api/v1/groups/{group_id}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "Reg No", "field_type": "text"},
    ).json()
    client.patch(
        f"/api/v1/groups/{group_id}/fields/{f_res['id']}",
        headers={"X-Admin-Token": token},
        json={"is_identifier": True},
    )

    # 40 failed lookups each with different fake X-Forwarded-For
    for i in range(30):
        res = client.post(
            f"/api/v1/join/{join_code}/lookup",
            json={"identifier": f"fake_{i}"},
            headers={"X-Forwarded-For": f"10.0.0.{i}"},
        )
        assert res.status_code == 404, f"Attempt {i+1} got status {res.status_code}"

    # 31st attempt must be blocked with 429
    res_31 = client.post(
        f"/api/v1/join/{join_code}/lookup",
        json={"identifier": "fake_31"},
        headers={"X-Forwarded-For": "10.0.0.31"},
    )
    assert res_31.status_code == 429
    assert res_31.json()["error"]["code"] == "rate_limited"


def test_lookup_successful_lookups_not_counted(client):
    """100 successful lookups from one address never produce 429, and do not change failure count."""
    lookup_limiter.reset()

    g_res = client.post("/api/v1/groups", json={"name": "Success Group"}).json()
    group_id = g_res["group_id"]
    join_code = g_res["join_code"]
    token = g_res["admin_token"]

    f_res = client.post(
        f"/api/v1/groups/{group_id}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "ID", "field_type": "text"},
    ).json()
    client.patch(
        f"/api/v1/groups/{group_id}/fields/{f_res['id']}",
        headers={"X-Admin-Token": token},
        json={"is_identifier": True},
    )

    # Pre-add member
    client.post(
        f"/api/v1/groups/{group_id}/members",
        headers={"X-Admin-Token": token},
        json={"members": [{"display_name": "Valid Member", "values": {f_res["key"]: "VALID-123"}}]},
    )

    # 100 successful lookups
    for _ in range(100):
        res = client.post(
            f"/api/v1/join/{join_code}/lookup",
            json={"identifier": "VALID-123"},
        )
        assert res.status_code == 200

    # Successful lookups did not change failure count: exactly 30 failures are still allowed
    for i in range(30):
        res = client.post(
            f"/api/v1/join/{join_code}/lookup",
            json={"identifier": f"invalid_{i}"},
        )
        assert res.status_code == 404

    # 31st failure gets 429
    res_exceeded = client.post(
        f"/api/v1/join/{join_code}/lookup",
        json={"identifier": "invalid_31"},
    )
    assert res_exceeded.status_code == 429


def test_lookup_trusted_proxy_count_behavior(client, monkeypatch):
    """With TRUSTED_PROXY_COUNT=1, requests with same rightmost entry share limit; different do not."""
    lookup_limiter.reset()
    monkeypatch.setattr(settings, "trusted_proxy_count", 1)

    g_res = client.post("/api/v1/groups", json={"name": "Proxy Group"}).json()
    join_code = g_res["join_code"]

    # 30 failed lookups with different spoofed left entries, but identical rightmost entry 203.0.113.1
    for i in range(30):
        res = client.post(
            f"/api/v1/join/{join_code}/lookup",
            json={"identifier": f"wrong_{i}"},
            headers={"X-Forwarded-For": f"192.168.0.{i}, 203.0.113.1"},
        )
        assert res.status_code == 404

    # 31st request from same rightmost proxy IP is blocked
    res_blocked = client.post(
        f"/api/v1/join/{join_code}/lookup",
        json={"identifier": "wrong_blocked"},
        headers={"X-Forwarded-For": "1.1.1.1, 203.0.113.1"},
    )
    assert res_blocked.status_code == 429

    # Request from different rightmost proxy IP (203.0.113.2) is NOT blocked
    res_allowed = client.post(
        f"/api/v1/join/{join_code}/lookup",
        json={"identifier": "wrong_diff"},
        headers={"X-Forwarded-For": "1.1.1.1, 203.0.113.2"},
    )
    assert res_allowed.status_code == 404


def test_lookup_per_code_limit_across_many_ips(client, monkeypatch):
    """Lookups from different IPs add up to hit LOOKUP_LIMIT_PER_CODE, while another code is unaffected."""
    lookup_limiter.reset()
    monkeypatch.setattr(settings, "trusted_proxy_count", 1)
    monkeypatch.setattr(settings, "lookup_limit_per_code", 15)  # Set low limit for testing

    g1 = client.post("/api/v1/groups", json={"name": "Code Limit G1"}).json()
    g2 = client.post("/api/v1/groups", json={"name": "Code Limit G2"}).json()
    jc1 = g1["join_code"]
    jc2 = g2["join_code"]

    # 15 failed lookups on jc1 from 15 different client IPs (each has only 1 attempt, so per-IP limit is not hit)
    for i in range(15):
        res = client.post(
            f"/api/v1/join/{jc1}/lookup",
            json={"identifier": f"wrong_{i}"},
            headers={"X-Forwarded-For": f"198.51.100.{i}"},
        )
        assert res.status_code == 404

    # 16th failed lookup on jc1 from yet another new IP is blocked by per-code limit!
    res_16 = client.post(
        f"/api/v1/join/{jc1}/lookup",
        json={"identifier": "wrong_16"},
        headers={"X-Forwarded-For": "198.51.100.99"},
    )
    assert res_16.status_code == 429
    assert res_16.json()["error"]["code"] == "rate_limited"

    # jc2 has had 0 attempts and is unaffected
    res_jc2 = client.post(
        f"/api/v1/join/{jc2}/lookup",
        json={"identifier": "wrong_jc2"},
        headers={"X-Forwarded-For": "198.51.100.99"},
    )
    assert res_jc2.status_code == 404


# ---------------------------------------------------------------------------
# 4. Upload Size Cap Test (Fix 2)
# ---------------------------------------------------------------------------

def test_upload_capped_read_on_large_file(client):
    """Upload of 6 MB gets 5 MB error on both preview and import, and read() never exceeds MAX_FILE_SIZE + 1 bytes."""
    g_res = client.post("/api/v1/groups", json={"name": "Upload Cap Group"}).json()
    group_id = g_res["group_id"]
    token = g_res["admin_token"]

    large_size = 6 * 1024 * 1024  # 6 MB
    large_payload = b"A" * large_size

    # Test 1: Preview endpoint
    res_prev = client.post(
        f"/api/v1/groups/{group_id}/members/import/preview",
        headers={"X-Admin-Token": token},
        files={"file": ("large.csv", large_payload, "text/csv")},
    )
    assert res_prev.status_code == 422
    assert "5 MB" in res_prev.json()["error"]["message"]

    # Test 2: Import endpoint
    res_imp = client.post(
        f"/api/v1/groups/{group_id}/members/import",
        headers={"X-Admin-Token": token},
        files={"file": ("large.csv", large_payload, "text/csv")},
        data={"mapping": '{"0": "name"}'},
    )
    assert res_imp.status_code == 422
    assert "5 MB" in res_imp.json()["error"]["message"]


def test_upload_capped_read_spy_verification():
    """Verify directly that read_upload_capped asks for MAX_FILE_SIZE + 1 bytes only."""
    from app.services.importer import read_upload_capped
    from app.errors import PollValidationError

    mock_file = MagicMock()
    # Return 5 MB + 1 bytes
    mock_file.file.read.return_value = b"x" * (MAX_FILE_SIZE + 1)

    with pytest.raises(PollValidationError) as exc:
        read_upload_capped(mock_file)

    assert "5 MB" in exc.value.message
    # Assert read was called with exactly MAX_FILE_SIZE + 1
    mock_file.file.read.assert_called_once_with(MAX_FILE_SIZE + 1)
