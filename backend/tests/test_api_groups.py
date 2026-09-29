"""Tests for group management and admin authorization endpoints."""

import uuid


def test_create_group_and_admin_authentication(client):
    """
    1. Create a group: 201, returns tokens;
    GET /groups/{id} with admin token works;
    with no token gives 401 missing_token;
    with a wrong token gives 401 invalid_token;
    with another group's admin token gives 403.
    """
    # Create Group A
    res_a = client.post("/api/v1/groups", json={"name": "Alpha Group"})
    assert res_a.status_code == 201
    data_a = res_a.json()
    assert "group_id" in data_a
    assert "admin_token" in data_a
    assert "join_code" in data_a
    assert data_a["name"] == "Alpha Group"

    group_a_id = data_a["group_id"]
    admin_token_a = data_a["admin_token"]

    # Create Group B
    res_b = client.post("/api/v1/groups", json={"name": "Beta Group"})
    assert res_b.status_code == 201
    data_b = res_b.json()
    group_b_id = data_b["group_id"]
    admin_token_b = data_b["admin_token"]

    # 1. With valid admin token for Group A -> 200 OK
    res_valid = client.get(
        f"/api/v1/groups/{group_a_id}",
        headers={"X-Admin-Token": admin_token_a},
    )
    assert res_valid.status_code == 200
    group_info = res_valid.json()
    assert group_info["id"] == group_a_id
    assert group_info["name"] == "Alpha Group"
    assert group_info["require_claim_approval"] is False
    assert group_info["members"] == []

    # 2. With no token -> 401 missing_token
    res_no_tok = client.get(f"/api/v1/groups/{group_a_id}")
    assert res_no_tok.status_code == 401
    err = res_no_tok.json()["error"]
    assert err["code"] == "missing_token"

    # 3. With wrong token -> 401 invalid_token
    res_wrong_tok = client.get(
        f"/api/v1/groups/{group_a_id}",
        headers={"X-Admin-Token": "some-random-unknown-token-xyz"},
    )
    assert res_wrong_tok.status_code == 401
    err = res_wrong_tok.json()["error"]
    assert err["code"] == "invalid_token"

    # 4. With another group's admin token -> 403 forbidden
    res_other_tok = client.get(
        f"/api/v1/groups/{group_a_id}",
        headers={"X-Admin-Token": admin_token_b},
    )
    assert res_other_tok.status_code == 403
    err = res_other_tok.json()["error"]
    assert err["code"] == "forbidden"


def test_add_members_bulk_validation(client):
    """
    2. Add members in bulk; a blank or duplicate name gives 422 and adds nobody.
    """
    res_group = client.post("/api/v1/groups", json={"name": "Bulk Test Group"})
    g_data = res_group.json()
    gid = g_data["group_id"]
    admin_tok = g_data["admin_token"]

    # 1. Success adds members
    res_add = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_tok},
        json={"display_names": ["Alice", "Bob", "Charlie"]},
    )
    assert res_add.status_code == 201
    members = res_add.json()
    assert len(members) == 3
    assert [m["display_name"] for m in members] == ["Alice", "Bob", "Charlie"]

    # 2. Blank name gives 422 and adds nobody
    res_blank = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_tok},
        json={"display_names": ["David", "   "]},
    )
    assert res_blank.status_code == 422
    assert res_blank.json()["error"]["code"] == "validation_error"

    # Check members list still only has Alice, Bob, Charlie
    res_list = client.get(
        f"/api/v1/groups/{gid}",
        headers={"X-Admin-Token": admin_tok},
    )
    names = [m["display_name"] for m in res_list.json()["members"]]
    assert "David" not in names
    assert len(names) == 3

    # 3. Duplicate within the list gives 422 and adds nobody
    res_dup_list = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_tok},
        json={"display_names": ["Eve", "Eve"]},
    )
    assert res_dup_list.status_code == 422
    assert res_dup_list.json()["error"]["code"] == "validation_error"

    # 4. Duplicate of existing member gives 422 and adds nobody
    res_dup_existing = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_tok},
        json={"display_names": ["Frank", "Alice"]},
    )
    assert res_dup_existing.status_code == 422
    assert res_dup_existing.json()["error"]["code"] == "validation_error"

    res_list_after = client.get(
        f"/api/v1/groups/{gid}",
        headers={"X-Admin-Token": admin_tok},
    )
    names_after = [m["display_name"] for m in res_list_after.json()["members"]]
    assert "Frank" not in names_after
    assert len(names_after) == 3


def test_member_and_admin_token_separation(client):
    """
    7. A member cannot call any admin endpoint (401 or 403),
    and an admin token cannot be used as a member token.
    """
    # Create group with admin
    g_res = client.post("/api/v1/groups", json={"name": "Separation Group"})
    g_data = g_res.json()
    gid = g_data["group_id"]
    admin_token = g_data["admin_token"]
    join_code = g_data["join_code"]

    # Add member and claim
    m_add = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_token},
        json={"display_names": ["Alice"]},
    )
    alice_id = m_add.json()[0]["id"]

    claim_res = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": alice_id},
    )
    member_token = claim_res.json()["member_token"]

    # 1. Member token used against an admin endpoint -> 401 invalid_token
    # (because it does not match any admin token hash)
    admin_call_with_member_token = client.get(
        f"/api/v1/groups/{gid}",
        headers={"X-Admin-Token": member_token},
    )
    assert admin_call_with_member_token.status_code == 401
    assert admin_call_with_member_token.json()["error"]["code"] == "invalid_token"

    # 2. Admin token used against a member endpoint -> 401 invalid_token
    member_call_with_admin_token = client.get(
        "/api/v1/me",
        headers={"X-Member-Token": admin_token},
    )
    assert member_call_with_admin_token.status_code == 401
    assert member_call_with_admin_token.json()["error"]["code"] == "invalid_token"


def test_admin_forbidden_error_does_not_leak_group_names(client):
    """
    Assert 403 forbidden error message does not leak group names or IDs
    for group and poll admin endpoints called with another group's admin token.
    """
    name_a = "SecretGroupAlpha_SpecialKeyword123"
    name_b = "ConfidentialGroupBeta_SpecialKeyword456"

    # Create Group A
    res_a = client.post("/api/v1/groups", json={"name": name_a})
    data_a = res_a.json()
    group_a_id = data_a["group_id"]
    admin_token_a = data_a["admin_token"]

    # Create Group B
    res_b = client.post("/api/v1/groups", json={"name": name_b})
    data_b = res_b.json()
    admin_token_b = data_b["admin_token"]

    # 1. Call GET /api/v1/groups/{group_a_id} with Group B's admin token
    res_group = client.get(
        f"/api/v1/groups/{group_a_id}",
        headers={"X-Admin-Token": admin_token_b},
    )
    assert res_group.status_code == 403
    group_err = res_group.json()["error"]
    assert group_err["code"] == "forbidden"
    assert group_err["message"] == "This admin token is not valid for this group."
    # Assert neither group name appears anywhere in response
    assert name_a not in res_group.text
    assert name_b not in res_group.text

    # Create a poll in Group A
    poll_res = client.post(
        f"/api/v1/groups/{group_a_id}/polls",
        headers={"X-Admin-Token": admin_token_a},
        json={
            "name": "SecretPoll_Keyword789",
            "allow_multiple": False,
            "options": [
                {"label": "Opt 1", "role": "target"},
                {"label": "Opt 2", "role": "not_yet"},
            ],
        },
    )
    poll_id = poll_res.json()["id"]

    # 2. Call GET /api/v1/polls/{poll_id}/status with Group B's admin token
    res_poll = client.get(
        f"/api/v1/polls/{poll_id}/status",
        headers={"X-Admin-Token": admin_token_b},
    )
    assert res_poll.status_code == 403
    poll_err = res_poll.json()["error"]
    assert poll_err["code"] == "forbidden"
    assert poll_err["message"] == "This admin token is not valid for this group."
    assert name_a not in res_poll.text
    assert name_b not in res_poll.text
    assert "SecretPoll_Keyword789" not in res_poll.text

