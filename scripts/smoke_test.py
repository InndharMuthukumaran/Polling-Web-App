#!/usr/bin/env python3
"""Smoke test script for deployed or local polling web app.

Uses only Python standard library.
Usage:
    python scripts/smoke_test.py --api https://your-api.onrender.com --web https://your-app.vercel.app [--timeout 90]
    python scripts/smoke_test.py --api http://localhost:8000 [--timeout 90]
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any


def http_request(
    url: str,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    timeout: float = 30.0,
) -> tuple[int, dict[str, str], bytes]:
    """Perform an HTTP request and return (status_code, headers, body)."""
    req = urllib.request.Request(
        url,
        data=data,
        headers=headers or {},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status = response.status
            resp_headers = {k.lower(): v for k, v in response.headers.items()}
            body = response.read()
            return status, resp_headers, body
    except urllib.error.HTTPError as exc:
        resp_headers = {k.lower(): v for k, v in exc.headers.items()}
        body = exc.read()
        return exc.code, resp_headers, body


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Smoke test for deployed or local polling web app.",
    )
    parser.add_argument(
        "--api",
        required=True,
        help="Base URL of backend API (e.g. https://your-api.onrender.com or http://localhost:8000)",
    )
    parser.add_argument(
        "--web",
        default=None,
        help="Base URL of frontend web app (e.g. https://your-app.vercel.app). If omitted, web checks are skipped.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=90.0,
        help="Timeout in seconds for HTTP requests (generous first request timeout, default: 90)",
    )

    args = parser.parse_args()

    api_base = args.api.rstrip("/")
    web_base = args.web.rstrip("/") if args.web else None
    timeout = args.timeout

    failed_checks = 0
    created_group_info: dict[str, Any] | None = None

    print(f"Starting smoke tests against API: {api_base}")
    if web_base:
        print(f"Target Frontend Web: {web_base}")
    else:
        print("Target Frontend Web: (none provided; skipping web & CORS checks)")

    # -------------------------------------------------------------
    # Check 1: GET {api}/health returns 200 with {"status": "ok"}
    # -------------------------------------------------------------
    try:
        status, _, body = http_request(
            f"{api_base}/health",
            method="GET",
            timeout=timeout,
        )
        if status != 200:
            print(f"FAIL: Check 1 (GET /health) returned status {status}, expected 200")
            failed_checks += 1
        else:
            data = json.loads(body.decode("utf-8"))
            if data.get("status") == "ok":
                print("OK: Check 1 - GET /health returned 200 with {'status': 'ok'}")
            else:
                print(f"FAIL: Check 1 - GET /health returned unexpected JSON: {data}")
                failed_checks += 1
    except Exception as exc:
        print(f"FAIL: Check 1 (GET /health) error: {exc}")
        failed_checks += 1

    # -------------------------------------------------------------
    # Check 2: GET {api}/health/db returns 200
    # -------------------------------------------------------------
    try:
        status, _, _ = http_request(
            f"{api_base}/health/db",
            method="GET",
            timeout=min(timeout, 30.0),
        )
        if status == 200:
            print("OK: Check 2 - GET /health/db returned 200")
        else:
            print(f"FAIL: Check 2 (GET /health/db) returned status {status}, expected 200")
            failed_checks += 1
    except Exception as exc:
        print(f"FAIL: Check 2 (GET /health/db) error: {exc}")
        failed_checks += 1

    # -------------------------------------------------------------
    # Check 3: CORS preflight
    # -------------------------------------------------------------
    if web_base:
        try:
            status, resp_headers, _ = http_request(
                f"{api_base}/api/v1/groups",
                method="OPTIONS",
                headers={
                    "Origin": web_base,
                    "Access-Control-Request-Method": "POST",
                },
                timeout=min(timeout, 30.0),
            )
            allow_origin = resp_headers.get("access-control-allow-origin")
            if allow_origin == web_base:
                print(
                    f"OK: Check 3 - CORS preflight returned Access-Control-Allow-Origin: {allow_origin}"
                )
            else:
                print(
                    f"FAIL: Check 3 - CORS preflight Access-Control-Allow-Origin was '{allow_origin}', expected '{web_base}'"
                )
                failed_checks += 1
        except Exception as exc:
            print(f"FAIL: Check 3 (CORS preflight) error: {exc}")
            failed_checks += 1
    else:
        print("SKIP: Check 3 - CORS preflight skipped (no --web URL provided)")

    # -------------------------------------------------------------
    # Check 4: Frontend HTML and SPA rewrite
    # -------------------------------------------------------------
    if web_base:
        try:
            status_root, _, body_root = http_request(
                f"{web_base}/",
                method="GET",
                timeout=min(timeout, 30.0),
            )
            status_poll, _, body_poll = http_request(
                f"{web_base}/p/00000000-0000-0000-0000-000000000000",
                method="GET",
                timeout=min(timeout, 30.0),
            )

            is_root_html = status_root == 200 and b"<html" in body_root.lower()
            is_poll_html = status_poll == 200 and b"<html" in body_poll.lower()

            if is_root_html and is_poll_html:
                print("OK: Check 4 - GET / and /p/<id> returned 200 HTML (SPA rewrite works)")
            else:
                print(
                    f"FAIL: Check 4 - Web checks failed (root: status={status_root}, html={is_root_html}; poll: status={status_poll}, html={is_poll_html})"
                )
                failed_checks += 1
        except Exception as exc:
            print(f"FAIL: Check 4 (Web frontend checks) error: {exc}")
            failed_checks += 1
    else:
        print("SKIP: Check 4 - Web frontend checks skipped (no --web URL provided)")

    # -------------------------------------------------------------
    # Check 5: POST groups -> add member -> join info -> lookup 404
    # -------------------------------------------------------------
    try:
        # Create group
        payload_create = json.dumps({"name": "SMOKE TEST (safe to delete)"}).encode("utf-8")
        status, _, body = http_request(
            f"{api_base}/api/v1/groups",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=payload_create,
            timeout=min(timeout, 30.0),
        )
        if status != 201:
            print(f"FAIL: Check 5 - POST /groups returned status {status}, expected 201")
            failed_checks += 1
        else:
            group_data = json.loads(body.decode("utf-8"))
            group_id = group_data.get("group_id") or group_data.get("id")
            admin_token = group_data["admin_token"]
            join_code = group_data["join_code"]
            created_group_info = {"id": group_id, "join_code": join_code}

            # Add member
            payload_member = json.dumps({"display_names": ["Smoke Tester"]}).encode("utf-8")
            status_m, _, _ = http_request(
                f"{api_base}/api/v1/groups/{group_id}/members",
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "X-Admin-Token": admin_token,
                },
                data=payload_member,
                timeout=min(timeout, 30.0),
            )
            if status_m != 201:
                print(f"FAIL: Check 5 - Adding member returned status {status_m}, expected 201")
                failed_checks += 1
            else:
                # Get join info
                status_j, _, body_j = http_request(
                    f"{api_base}/api/v1/join/{join_code}",
                    method="GET",
                    timeout=min(timeout, 30.0),
                )
                join_data = json.loads(body_j.decode("utf-8")) if status_j == 200 else {}
                group_title = join_data.get("group_name") or join_data.get("name")
                if status_j != 200 or group_title != "SMOKE TEST (safe to delete)":
                    print(f"FAIL: Check 5 - GET /join/{join_code} returned {status_j}, data: {join_data}")
                    failed_checks += 1
                else:
                    # Lookup unknown identifier -> expect 404
                    payload_lookup = json.dumps({"identifier": "unknown-smoke-tester-id"}).encode("utf-8")
                    status_l, _, _ = http_request(
                        f"{api_base}/api/v1/join/{join_code}/lookup",
                        method="POST",
                        headers={"Content-Type": "application/json"},
                        data=payload_lookup,
                        timeout=min(timeout, 30.0),
                    )
                    if status_l == 404:
                        print(
                            "OK: Check 5 - Group created (201), member added (201), join verified (200), unknown identifier lookup returned 404"
                        )
                    else:
                        print(
                            f"FAIL: Check 5 - Lookup for unknown identifier returned status {status_l}, expected 404"
                        )
                        failed_checks += 1
    except Exception as exc:
        print(f"FAIL: Check 5 (Group & member flow) error: {exc}")
        failed_checks += 1

    if created_group_info:
        print(
            f"Note: 1 test group was created in the database (ID: {created_group_info['id']}, join code: {created_group_info['join_code']}). No delete endpoint exists; this group is safe to leave."
        )

    if failed_checks > 0:
        print(f"\nSmoke tests finished with {failed_checks} failure(s).")
        return 1

    print("\nAll executed smoke checks PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
