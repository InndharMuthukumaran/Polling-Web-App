"""Tests for public join, claim lifecycle, member profile (/me), and claim approval/reset flows."""

import uuid


def test_claim_approval_flow_and_voting_guard(client):
    """
    4. Approval on:
    - the claim returns pending;
    - voting gives 403 claim_not_approved;
    - /me shows pending;
    - after /approve voting works.
    """
    # 1. Create group with approval required
    g_res = client.post("/api/v1/groups", json={"name": "Approval Flow Group"})
    g_data = g_res.json()
    gid = g_data["group_id"]
    admin_token = g_data["admin_token"]
    join_code = g_data["join_code"]

    client.patch(
        f"/api/v1/groups/{gid}",
        headers={"X-Admin-Token": admin_token},
        json={"require_claim_approval": True},
    )

    # 2. Add member Alice and create a poll
    m_res = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_token},
        json={"display_names": ["Alice"]},
    )
    alice_id = m_res.json()[0]["id"]

    poll_res = client.post(
        f"/api/v1/groups/{gid}/polls",
        headers={"X-Admin-Token": admin_token},
        json={
            "name": "Lunch Question",
            "allow_multiple": False,
            "options": [
                {"label": "Burger", "role": "target"},
                {"label": "Salad", "role": "not_yet"},
            ],
        },
    )
    poll_id = poll_res.json()["id"]
    opt_burger_id = poll_res.json()["options"][0]["id"]

    # 3. Alice claims her name -> claim returns pending
    claim_res = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": alice_id},
    )
    assert claim_res.status_code == 201
    claim_data = claim_res.json()
    assert claim_data["status"] == "pending"
    alice_token = claim_data["member_token"]

    # 4. /me shows pending
    me_res = client.get("/api/v1/me", headers={"X-Member-Token": alice_token})
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["claim_status"] == "pending"
    assert me_data["display_name"] == "Alice"
    assert me_data["group_name"] == "Approval Flow Group"

    # 5. Voting gives 403 claim_not_approved
    vote_blocked = client.post(
        f"/api/v1/polls/{poll_id}/vote",
        headers={"X-Member-Token": alice_token},
        json={"option_id": opt_burger_id},
    )
    assert vote_blocked.status_code == 403
    assert vote_blocked.json()["error"]["code"] == "claim_not_approved"

    # 6. Creator approves the claim
    approve_res = client.post(
        f"/api/v1/groups/{gid}/members/{alice_id}/approve",
        headers={"X-Admin-Token": admin_token},
    )
    assert approve_res.status_code == 200
    assert approve_res.json()["claim_status"] == "approved"

    # 7. /me now shows approved
    me_approved = client.get("/api/v1/me", headers={"X-Member-Token": alice_token})
    assert me_approved.status_code == 200
    assert me_approved.json()["claim_status"] == "approved"

    # 8. Now voting succeeds!
    vote_ok = client.post(
        f"/api/v1/polls/{poll_id}/vote",
        headers={"X-Member-Token": alice_token},
        json={"option_id": opt_burger_id},
    )
    assert vote_ok.status_code == 200
    assert opt_burger_id in vote_ok.json()["selected_option_ids"]


def test_claimed_name_conflict_and_taken_status(client):
    """
    5. A claimed name gives 409 name_already_claimed on a second claim;
    GET /join/{code} shows it as taken.
    """
    g_res = client.post("/api/v1/groups", json={"name": "Conflict Group"})
    g_data = g_res.json()
    gid = g_data["group_id"]
    admin_token = g_data["admin_token"]
    join_code = g_data["join_code"]

    m_res = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_token},
        json={"display_names": ["Bob"]},
    )
    bob_id = m_res.json()[0]["id"]

    # Before claim, Bob is not taken
    join_before = client.get(f"/api/v1/join/{join_code}")
    assert join_before.status_code == 200
    bob_entry = join_before.json()["members"][0]
    assert bob_entry["taken"] is False

    # First claim succeeds
    claim_1 = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": bob_id},
    )
    assert claim_1.status_code == 201

    # Now GET /join/{code} shows Bob as taken
    join_after = client.get(f"/api/v1/join/{join_code}")
    assert join_after.status_code == 200
    bob_entry_after = join_after.json()["members"][0]
    assert bob_entry_after["taken"] is True

    # Second claim on Bob gives 409 name_already_claimed
    claim_2 = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": bob_id},
    )
    assert claim_2.status_code == 409
    assert claim_2.json()["error"]["code"] == "name_already_claimed"


def test_reset_claim_lifecycle_and_history_inheritance(client):
    """
    6. Reset:
    - the old member token gives 401;
    - the name shows as not taken;
    - the member's earlier votes are still visible to the new claimant.
    """
    g_res = client.post("/api/v1/groups", json={"name": "Reset Test Group"})
    g_data = g_res.json()
    gid = g_data["group_id"]
    admin_token = g_data["admin_token"]
    join_code = g_data["join_code"]

    m_res = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_token},
        json={"display_names": ["Charlie"]},
    )
    charlie_id = m_res.json()[0]["id"]

    poll_res = client.post(
        f"/api/v1/groups/{gid}/polls",
        headers={"X-Admin-Token": admin_token},
        json={
            "name": "Trip Destination",
            "allow_multiple": False,
            "options": [
                {"label": "Mountains", "role": "target"},
                {"label": "Beach", "role": "not_yet"},
            ],
        },
    )
    poll_id = poll_res.json()["id"]
    opt_mountains_id = poll_res.json()["options"][0]["id"]

    # Charlie claims name on phone 1
    claim_1 = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": charlie_id},
    )
    token_1 = claim_1.json()["member_token"]

    # Charlie votes for Mountains
    v_res = client.post(
        f"/api/v1/polls/{poll_id}/vote",
        headers={"X-Member-Token": token_1},
        json={"option_id": opt_mountains_id},
    )
    assert v_res.status_code == 200

    # Admin resets Charlie's claim (e.g. phone was lost)
    reset_res = client.post(
        f"/api/v1/groups/{gid}/members/{charlie_id}/reset",
        headers={"X-Admin-Token": admin_token},
    )
    assert reset_res.status_code == 200
    assert reset_res.json()["claim_status"] == "unclaimed"

    # 1. Old member token gives 401 invalid_token
    old_token_check = client.get("/api/v1/me", headers={"X-Member-Token": token_1})
    assert old_token_check.status_code == 401
    assert old_token_check.json()["error"]["code"] == "invalid_token"

    # 2. Join endpoint shows Charlie as not taken
    join_info = client.get(f"/api/v1/join/{join_code}")
    charlie_entry = join_info.json()["members"][0]
    assert charlie_entry["taken"] is False

    # 3. Charlie claims name again on phone 2
    claim_2 = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": charlie_id},
    )
    assert claim_2.status_code == 201
    token_2 = claim_2.json()["member_token"]
    assert token_2 != token_1

    # 4. Earlier votes and history are visible to the new claimant
    my_poll = client.get(
        f"/api/v1/polls/{poll_id}/me",
        headers={"X-Member-Token": token_2},
    )
    assert my_poll.status_code == 200
    my_poll_data = my_poll.json()
    assert opt_mountains_id in my_poll_data["selected_option_ids"]
    assert len(my_poll_data["history"]) == 1
    assert my_poll_data["history"][0]["option_label"] == "Mountains"
    assert my_poll_data["history"][0]["is_selected"] is True
