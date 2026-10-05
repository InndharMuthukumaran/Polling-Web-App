"""Tests for member self-release endpoint (POST /api/v1/me/release)."""


def test_release_own_claim_flow(client):
    """
    Test self-release endpoint:
    - releasing frees the name (GET /join/{code} shows it not taken);
    - old token then gives 401;
    - name can be claimed again;
    - a member's earlier votes are still there for the next claimant;
    - pending member can release;
    - no token gives 401 missing_token;
    - wrong token gives 401 invalid_token.
    """
    # 1. Create a group and add a member
    g_res = client.post("/api/v1/groups", json={"name": "Release Test Group"})
    assert g_res.status_code == 201
    g_data = g_res.json()
    gid = g_data["group_id"]
    admin_token = g_data["admin_token"]
    join_code = g_data["join_code"]

    m_res = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_token},
        json={"display_names": ["Eve"]},
    )
    assert m_res.status_code == 201
    eve_id = m_res.json()[0]["id"]

    # Create a poll
    p_res = client.post(
        f"/api/v1/groups/{gid}/polls",
        headers={"X-Admin-Token": admin_token},
        json={
            "name": "Feature Vote",
            "allow_multiple": False,
            "options": [
                {"label": "Dark Mode", "role": "target"},
                {"label": "Light Mode", "role": "not_yet"},
            ],
        },
    )
    assert p_res.status_code == 201
    poll_id = p_res.json()["id"]
    opt_dark_id = p_res.json()["options"][0]["id"]

    # 2. Eve claims her name
    claim_res = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": eve_id},
    )
    assert claim_res.status_code == 201
    eve_token = claim_res.json()["member_token"]

    # Eve casts a vote
    vote_res = client.post(
        f"/api/v1/polls/{poll_id}/vote",
        headers={"X-Member-Token": eve_token},
        json={"option_id": opt_dark_id},
    )
    assert vote_res.status_code == 200

    # 3. Eve releases her own claim
    rel_res = client.post(
        "/api/v1/me/release",
        headers={"X-Member-Token": eve_token},
    )
    assert rel_res.status_code == 200
    assert rel_res.json() == {"status": "unclaimed"}

    # 4. Old token gives 401 invalid_token
    check_res = client.get("/api/v1/me", headers={"X-Member-Token": eve_token})
    assert check_res.status_code == 401
    assert check_res.json()["error"]["code"] == "invalid_token"

    # 5. Join endpoint shows Eve not taken
    join_info = client.get(f"/api/v1/join/{join_code}")
    assert join_info.status_code == 200
    eve_entry = join_info.json()["members"][0]
    assert eve_entry["taken"] is False

    # 6. Name can be claimed again
    reclaim_res = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": eve_id},
    )
    assert reclaim_res.status_code == 201
    new_token = reclaim_res.json()["member_token"]
    assert new_token != eve_token

    # 7. Member's earlier votes are still there for the next claimant
    my_poll = client.get(
        f"/api/v1/polls/{poll_id}/me",
        headers={"X-Member-Token": new_token},
    )
    assert my_poll.status_code == 200
    my_poll_data = my_poll.json()
    assert opt_dark_id in my_poll_data["selected_option_ids"]
    assert len(my_poll_data["history"]) == 1
    assert my_poll_data["history"][0]["option_label"] == "Dark Mode"
    assert my_poll_data["history"][0]["is_selected"] is True


def test_release_pending_member(client):
    """A pending member can release their claim."""
    g_res = client.post("/api/v1/groups", json={"name": "Pending Release Group"})
    gid = g_res.json()["group_id"]
    admin_token = g_res.json()["admin_token"]
    join_code = g_res.json()["join_code"]

    client.patch(
        f"/api/v1/groups/{gid}",
        headers={"X-Admin-Token": admin_token},
        json={"require_claim_approval": True},
    )

    m_res = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_token},
        json={"display_names": ["Frank"]},
    )
    frank_id = m_res.json()[0]["id"]

    claim_res = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": frank_id},
    )
    assert claim_res.status_code == 201
    assert claim_res.json()["status"] == "pending"
    frank_token = claim_res.json()["member_token"]

    # Pending member calls release
    rel_res = client.post(
        "/api/v1/me/release",
        headers={"X-Member-Token": frank_token},
    )
    assert rel_res.status_code == 200
    assert rel_res.json() == {"status": "unclaimed"}

    # Join endpoint shows Frank as not taken
    join_info = client.get(f"/api/v1/join/{join_code}")
    assert join_info.json()["members"][0]["taken"] is False


def test_release_auth_guards(client):
    """
    - No token gives 401 missing_token
    - Wrong token gives 401 invalid_token
    """
    no_token_res = client.post("/api/v1/me/release")
    assert no_token_res.status_code == 401
    assert no_token_res.json()["error"]["code"] == "missing_token"

    wrong_token_res = client.post(
        "/api/v1/me/release",
        headers={"X-Member-Token": "completely_bogus_token"},
    )
    assert wrong_token_res.status_code == 401
    assert wrong_token_res.json()["error"]["code"] == "invalid_token"
