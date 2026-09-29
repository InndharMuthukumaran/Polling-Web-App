"""Tests for poll public views, voting rules, lateness, status categorization, and closing."""

from datetime import datetime, timezone, timedelta
import uuid


def dt_past() -> str:
    """Return an ISO 8601 string in the past."""
    return (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()


def dt_future() -> str:
    """Return an ISO 8601 string in the future."""
    return (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()


def test_full_happy_path(client):
    """
    3. Full happy path:
    create group, add members, create poll,
    member claims a name (approval off),
    votes, admin sees the member in at_target via /status.
    """
    # 1. Create group
    g_res = client.post("/api/v1/groups", json={"name": "Happy Path Group"})
    g_data = g_res.json()
    gid = g_data["group_id"]
    admin_token = g_data["admin_token"]
    join_code = g_data["join_code"]

    # 2. Add member Alice
    m_res = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_token},
        json={"display_names": ["Alice"]},
    )
    alice_id = m_res.json()[0]["id"]

    # 3. Create poll
    p_res = client.post(
        f"/api/v1/groups/{gid}/polls",
        headers={"X-Admin-Token": admin_token},
        json={
            "name": "Homework Submitted",
            "allow_multiple": False,
            "options": [
                {"label": "Yes", "role": "target"},
                {"label": "No", "role": "not_yet"},
            ],
        },
    )
    poll_id = p_res.json()["id"]
    opt_yes_id = p_res.json()["options"][0]["id"]

    # 4. Alice claims name (approval is off by default)
    claim_res = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": alice_id},
    )
    alice_token = claim_res.json()["member_token"]

    # 5. Alice votes for 'Yes' (target role)
    v_res = client.post(
        f"/api/v1/polls/{poll_id}/vote",
        headers={"X-Member-Token": alice_token},
        json={"option_id": opt_yes_id},
    )
    assert v_res.status_code == 200
    assert opt_yes_id in v_res.json()["selected_option_ids"]

    # 6. Admin checks status
    status_res = client.get(
        f"/api/v1/polls/{poll_id}/status",
        headers={"X-Admin-Token": admin_token},
    )
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["counts"]["at_target"] == 1
    assert status_data["all_reached"] is True
    assert len(status_data["at_target"]) == 1
    assert status_data["at_target"][0]["member_id"] == alice_id
    assert status_data["at_target"][0]["display_name"] == "Alice"
    assert status_data["at_target"][0]["late"] is False


def test_member_from_group_a_cannot_vote_in_group_b(client):
    """
    8. A member from group A cannot vote in a poll of group B (403).
    """
    # Group A
    g_a = client.post("/api/v1/groups", json={"name": "Group A"}).json()
    m_a = client.post(
        f"/api/v1/groups/{g_a['group_id']}/members",
        headers={"X-Admin-Token": g_a["admin_token"]},
        json={"display_names": ["Alice"]},
    ).json()[0]
    alice_token = client.post(
        f"/api/v1/join/{g_a['join_code']}/claim",
        json={"member_id": m_a["id"]},
    ).json()["member_token"]

    # Group B
    g_b = client.post("/api/v1/groups", json={"name": "Group B"}).json()
    poll_b = client.post(
        f"/api/v1/groups/{g_b['group_id']}/polls",
        headers={"X-Admin-Token": g_b["admin_token"]},
        json={
            "name": "Poll B",
            "allow_multiple": False,
            "options": [
                {"label": "Opt1", "role": "target"},
                {"label": "Opt2", "role": "not_yet"},
            ],
        },
    ).json()

    # Alice tries to vote in Group B's poll
    v_res = client.post(
        f"/api/v1/polls/{poll_b['id']}/vote",
        headers={"X-Member-Token": alice_token},
        json={"option_id": poll_b["options"][0]["id"]},
    )
    assert v_res.status_code == 403
    assert v_res.json()["error"]["code"] == "forbidden"


def test_single_choice_and_multiple_choice_voting_modes(client):
    """
    9. Single-choice: voting for a second option replaces the first;
    multiple-choice: two selections coexist and DELETE with option_id removes just one.
    """
    g = client.post("/api/v1/groups", json={"name": "Voting Modes Group"}).json()
    gid = g["group_id"]
    admin_tok = g["admin_token"]
    join_code = g["join_code"]

    m = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_tok},
        json={"display_names": ["Member1"]},
    ).json()[0]
    token = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": m["id"]},
    ).json()["member_token"]

    # 1. Single-choice poll
    p_single = client.post(
        f"/api/v1/groups/{gid}/polls",
        headers={"X-Admin-Token": admin_tok},
        json={
            "name": "Single Poll",
            "allow_multiple": False,
            "options": [
                {"label": "Opt1", "role": "target"},
                {"label": "Opt2", "role": "not_yet"},
            ],
        },
    ).json()
    opt1_s = p_single["options"][0]["id"]
    opt2_s = p_single["options"][1]["id"]

    # Vote for Opt1
    v1 = client.post(
        f"/api/v1/polls/{p_single['id']}/vote",
        headers={"X-Member-Token": token},
        json={"option_id": opt1_s},
    )
    assert v1.status_code == 200
    assert v1.json()["selected_option_ids"] == [opt1_s]

    # Vote for Opt2 replaces Opt1
    v2 = client.post(
        f"/api/v1/polls/{p_single['id']}/vote",
        headers={"X-Member-Token": token},
        json={"option_id": opt2_s},
    )
    assert v2.status_code == 200
    assert v2.json()["selected_option_ids"] == [opt2_s]

    # 2. Multiple-choice poll
    p_multi = client.post(
        f"/api/v1/groups/{gid}/polls",
        headers={"X-Admin-Token": admin_tok},
        json={
            "name": "Multi Poll",
            "allow_multiple": True,
            "options": [
                {"label": "Topic A", "role": "target"},
                {"label": "Topic B", "role": "target"},
                {"label": "Topic C", "role": "not_yet"},
            ],
        },
    ).json()
    opt_a = p_multi["options"][0]["id"]
    opt_b = p_multi["options"][1]["id"]

    # Vote for Topic A
    client.post(
        f"/api/v1/polls/{p_multi['id']}/vote",
        headers={"X-Member-Token": token},
        json={"option_id": opt_a},
    )
    # Vote for Topic B
    vm2 = client.post(
        f"/api/v1/polls/{p_multi['id']}/vote",
        headers={"X-Member-Token": token},
        json={"option_id": opt_b},
    )
    assert vm2.status_code == 200
    assert set(vm2.json()["selected_option_ids"]) == {opt_a, opt_b}

    # DELETE with option_id removes just opt_a
    del_res = client.delete(
        f"/api/v1/polls/{p_multi['id']}/vote?option_id={opt_a}",
        headers={"X-Member-Token": token},
    )
    assert del_res.status_code == 200
    assert del_res.json()["selected_option_ids"] == [opt_b]


def test_closed_poll_behavior(client):
    """
    10. A closed poll gives 409 poll_closed on vote and delete;
    /status still works;
    closing twice returns 200 both times.
    """
    g = client.post("/api/v1/groups", json={"name": "Closing Group"}).json()
    gid = g["group_id"]
    admin_tok = g["admin_token"]
    join_code = g["join_code"]

    m = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_tok},
        json={"display_names": ["Dave"]},
    ).json()[0]
    token = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": m["id"]},
    ).json()["member_token"]

    p = client.post(
        f"/api/v1/groups/{gid}/polls",
        headers={"X-Admin-Token": admin_tok},
        json={
            "name": "Poll to Close",
            "allow_multiple": False,
            "options": [
                {"label": "Yes", "role": "target"},
                {"label": "No", "role": "not_yet"},
            ],
        },
    ).json()
    pid = p["id"]
    opt_yes = p["options"][0]["id"]

    # Close poll first time -> 200
    close_1 = client.post(
        f"/api/v1/polls/{pid}/close",
        headers={"X-Admin-Token": admin_tok},
    )
    assert close_1.status_code == 200
    assert close_1.json()["status"] == "closed"

    # Close poll second time -> 200 (idempotent)
    close_2 = client.post(
        f"/api/v1/polls/{pid}/close",
        headers={"X-Admin-Token": admin_tok},
    )
    assert close_2.status_code == 200
    assert close_2.json()["status"] == "closed"

    # Voting gives 409 poll_closed
    vote_res = client.post(
        f"/api/v1/polls/{pid}/vote",
        headers={"X-Member-Token": token},
        json={"option_id": opt_yes},
    )
    assert vote_res.status_code == 409
    assert vote_res.json()["error"]["code"] == "poll_closed"

    # Deleting vote gives 409 poll_closed
    del_res = client.delete(
        f"/api/v1/polls/{pid}/vote",
        headers={"X-Member-Token": token},
    )
    assert del_res.status_code == 409
    assert del_res.json()["error"]["code"] == "poll_closed"

    # /status still works on closed poll
    status_res = client.get(
        f"/api/v1/polls/{pid}/status",
        headers={"X-Admin-Token": admin_tok},
    )
    assert status_res.status_code == 200
    assert status_res.json()["poll"]["status"] == "closed"


def test_public_poll_details_leak_no_roles_or_votes(client):
    """
    11. The public GET /polls/{id} does not contain roles or any votes;
    it does contain the join code.
    """
    g = client.post("/api/v1/groups", json={"name": "Public Info Group"}).json()
    p = client.post(
        f"/api/v1/groups/{g['group_id']}/polls",
        headers={"X-Admin-Token": g["admin_token"]},
        json={
            "name": "Secret Roles Poll",
            "description_raw": "Description for everyone",
            "allow_multiple": False,
            "options": [
                {"label": "Target Opt", "role": "target"},
                {"label": "Excuse Opt", "role": "excused"},
            ],
        },
    ).json()

    pub_res = client.get(f"/api/v1/polls/{p['id']}")
    assert pub_res.status_code == 200
    pub_data = pub_res.json()

    assert pub_data["name"] == "Secret Roles Poll"
    assert pub_data["description_raw"] == "Description for everyone"
    assert pub_data["join_code"] == g["join_code"]
    assert pub_data["group_name"] == "Public Info Group"

    # Check options: must NOT have 'role'
    assert len(pub_data["options"]) == 2
    for opt in pub_data["options"]:
        assert "id" in opt
        assert "label" in opt
        assert "position" in opt
        assert "role" not in opt

    # Check that no votes or member data exist in public response
    assert "votes" not in pub_data
    assert "members" not in pub_data


def test_poll_status_lateness(client):
    """
    12. /status returns late: true for a member who reached the target
    after the deadline (create the poll with a past deadline).
    """
    g = client.post("/api/v1/groups", json={"name": "Deadline Group"}).json()
    gid = g["group_id"]
    admin_tok = g["admin_token"]
    join_code = g["join_code"]

    m = client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": admin_tok},
        json={"display_names": ["LateMember"]},
    ).json()[0]
    token = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": m["id"]},
    ).json()["member_token"]

    # Create poll with past deadline
    past_dl = dt_past()
    p = client.post(
        f"/api/v1/groups/{gid}/polls",
        headers={"X-Admin-Token": admin_tok},
        json={
            "name": "Past Deadline Poll",
            "allow_multiple": False,
            "deadline": past_dl,
            "options": [
                {"label": "Done", "role": "target"},
                {"label": "Later", "role": "not_yet"},
            ],
        },
    ).json()
    pid = p["id"]
    opt_done = p["options"][0]["id"]

    # Member votes now (which is after deadline)
    client.post(
        f"/api/v1/polls/{pid}/vote",
        headers={"X-Member-Token": token},
        json={"option_id": opt_done},
    )

    # Status check
    st = client.get(
        f"/api/v1/polls/{pid}/status",
        headers={"X-Admin-Token": admin_tok},
    ).json()

    assert len(st["at_target"]) == 1
    assert st["at_target"][0]["late"] is True


def test_poll_completion_time_mode_defaults_and_validation(client):
    """
    Assert that PollCreate defaults completion_time_mode to 'last',
    respects explicit 'first', and rejects invalid values like 'whenever' with 422.
    """
    g = client.post("/api/v1/groups", json={"name": "Completion Time Mode Group"}).json()
    gid = g["group_id"]
    admin_tok = g["admin_token"]

    base_options = [
        {"label": "Target", "role": "target"},
        {"label": "Not Yet", "role": "not_yet"},
    ]

    # 1. Create a poll without sending completion_time_mode -> asserts response says 'last'
    res_default = client.post(
        f"/api/v1/groups/{gid}/polls",
        headers={"X-Admin-Token": admin_tok},
        json={
            "name": "Default Mode Poll",
            "allow_multiple": False,
            "options": base_options,
        },
    )
    assert res_default.status_code == 201
    assert res_default.json()["completion_time_mode"] == "last"

    # 2. Create a poll with 'first' -> asserts response says 'first'
    res_first = client.post(
        f"/api/v1/groups/{gid}/polls",
        headers={"X-Admin-Token": admin_tok},
        json={
            "name": "First Mode Poll",
            "allow_multiple": False,
            "options": base_options,
            "completion_time_mode": "first",
        },
    )
    assert res_first.status_code == 201
    assert res_first.json()["completion_time_mode"] == "first"

    # 3. Create a poll with invalid 'whenever' -> returns 422
    res_invalid = client.post(
        f"/api/v1/groups/{gid}/polls",
        headers={"X-Admin-Token": admin_tok},
        json={
            "name": "Invalid Mode Poll",
            "allow_multiple": False,
            "options": base_options,
            "completion_time_mode": "whenever",
        },
    )
    assert res_invalid.status_code == 422

