"""Tests for Part R1b: Claim by identifier, name-list setting, rate limiting, and results identifiers."""

from pathlib import Path
import time
import uuid
import pytest
from alembic import command
from alembic.config import Config
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

from app.models import Group
from app.ratelimit import lookup_limiter


def test_migration_004_claim_settings_cycle(test_engine_and_url):
    """Test 2: Migration upgrade on empty database, downgrade one step and upgrade again."""
    engine, test_db_url = test_engine_and_url
    backend_dir = Path(__file__).resolve().parent.parent
    alembic_ini_path = backend_dir / "alembic.ini"

    alembic_cfg = Config(str(alembic_ini_path))
    alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", test_db_url)

    # 1. Downgrade one step to 003_group_fields
    with engine.begin() as connection:
        alembic_cfg.attributes["connection"] = connection
        command.downgrade(alembic_cfg, "003_group_fields")

    # 2. Upgrade again to head (004_claim_settings)
    with engine.begin() as connection:
        alembic_cfg.attributes["connection"] = connection
        command.upgrade(alembic_cfg, "head")

    # Verify allow_name_list column exists and has server default false
    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    gid = uuid.uuid4()
    with session_factory() as session:
        g = Group(id=gid, name="Migration Test Group", join_code="migr004_jc")
        session.add(g)
        session.commit()
        session.refresh(g)
        assert g.allow_name_list is False


def test_group_without_identifier_join_info(client):
    """Test 3: A group without an identifier: GET /join/{code} returns member list and claim_mode is 'list'."""
    g_res = client.post("/api/v1/groups", json={"name": "No Identifier Group"})
    assert g_res.status_code == 201
    g_data = g_res.json()
    gid = g_data["group_id"]
    token = g_data["admin_token"]
    join_code = g_data["join_code"]

    client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={"display_names": ["Asha", "Balaji"]},
    )

    join_res = client.get(f"/api/v1/join/{join_code}")
    assert join_res.status_code == 200
    join_data = join_res.json()

    assert join_data["claim_mode"] == "list"
    assert join_data["identifier_label"] is None
    assert join_data["allow_name_list"] is False
    assert len(join_data["members"]) == 2
    assert [m["display_name"] for m in join_data["members"]] == ["Asha", "Balaji"]
    assert all(m["identifier_hint"] is None for m in join_data["members"])
    assert all(m["taken"] is False for m in join_data["members"])


def test_group_with_identifier_join_info_and_masking(client):
    """Test 4: A group with an identifier: claim_mode is 'identifier', members is empty by default;

    after PATCH allow_name_list: true, list is returned and each item has masked identifier_hint
    (checking long value, 3-char value, and 2-char value).
    """
    g_res = client.post("/api/v1/groups", json={"name": "Identifier Mask Group"})
    g_data = g_res.json()
    gid = g_data["group_id"]
    token = g_data["admin_token"]
    join_code = g_data["join_code"]

    # Add identifier field "Register No"
    f_res = client.post(
        f"/api/v1/groups/{gid}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "Register No", "field_type": "text"},
    )
    assert f_res.status_code == 201
    fid = f_res.json()["id"]

    patch_f = client.patch(
        f"/api/v1/groups/{gid}/fields/{fid}",
        headers={"X-Admin-Token": token},
        json={"is_identifier": True},
    )
    assert patch_f.status_code == 200

    # Add members with long, 3-char, and 2-char identifiers
    client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={
            "members": [
                {"display_name": "LongVal Member", "values": {"register_no": "REG001"}},
                {"display_name": "ThreeChar Member", "values": {"register_no": "ABC"}},
                {"display_name": "TwoChar Member", "values": {"register_no": "42"}},
            ]
        },
    )

    # 1. Before allow_name_list: true -> claim_mode='identifier', members is empty
    join_res1 = client.get(f"/api/v1/join/{join_code}")
    assert join_res1.status_code == 200
    data1 = join_res1.json()
    assert data1["claim_mode"] == "identifier"
    assert data1["identifier_label"] == "Register No"
    assert data1["allow_name_list"] is False
    assert data1["members"] == []

    # 2. Patch allow_name_list: true
    patch_group = client.patch(
        f"/api/v1/groups/{gid}",
        headers={"X-Admin-Token": token},
        json={"allow_name_list": True},
    )
    assert patch_group.status_code == 200
    assert patch_group.json()["allow_name_list"] is True

    # 3. After allow_name_list: true -> members returned with masked hints
    join_res2 = client.get(f"/api/v1/join/{join_code}")
    assert join_res2.status_code == 200
    data2 = join_res2.json()
    assert data2["claim_mode"] == "identifier"
    assert data2["identifier_label"] == "Register No"
    assert data2["allow_name_list"] is True
    assert len(data2["members"]) == 3

    members_by_name = {m["display_name"]: m for m in data2["members"]}

    # Long value: "REG001" -> "•••001"
    assert members_by_name["LongVal Member"]["identifier_hint"] == "•••001"
    # 3-char value: "ABC" -> fully masked "•••"
    assert members_by_name["ThreeChar Member"]["identifier_hint"] == "•••"
    # 2-char value: "42" -> fully masked "••"
    assert members_by_name["TwoChar Member"]["identifier_hint"] == "••"


def test_lookup_normalization_and_generic_404(client):
    """Test 5: Lookup ignores case and extra whitespace;

    Unknown identifier, inactive member, wrong join code, and group with no identifier
    all give the same generic 404 body;
    Claimed member returns taken: true with null name; unclaimed returns display name.
    """
    g_res = client.post("/api/v1/groups", json={"name": "Lookup Test Group"})
    g_data = g_res.json()
    gid = g_data["group_id"]
    token = g_data["admin_token"]
    join_code = g_data["join_code"]

    f_res = client.post(
        f"/api/v1/groups/{gid}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "Roll No", "field_type": "text"},
    )
    fid = f_res.json()["id"]
    client.patch(
        f"/api/v1/groups/{gid}/fields/{fid}",
        headers={"X-Admin-Token": token},
        json={"is_identifier": True},
    )

    client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={
            "members": [
                {"display_name": "Asha", "values": {"roll_no": "CS 101"}},
                {"display_name": "Inactive Bob", "values": {"roll_no": "CS 102"}},
            ]
        },
    )

    # Deactivate Inactive Bob
    m_list = client.get(f"/api/v1/groups/{gid}", headers={"X-Admin-Token": token}).json()["members"]
    bob_id = next(m["id"] for m in m_list if m["display_name"] == "Inactive Bob")
    client.patch(
        f"/api/v1/groups/{gid}/members/{bob_id}",
        headers={"X-Admin-Token": token},
        json={"is_active": False},
    )

    expected_404 = {"error": {"code": "not_found", "message": "No member matches that identifier."}}

    # 1. Normalization: "  cs   101 " finds Asha
    lookup_norm = client.post(
        f"/api/v1/join/{join_code}/lookup",
        json={"identifier": "  cs   101 "},
    )
    assert lookup_norm.status_code == 200
    norm_data = lookup_norm.json()
    assert norm_data["display_name"] == "Asha"
    assert norm_data["taken"] is False
    asha_id = norm_data["member_id"]

    # 2. Unknown identifier -> 404 generic
    res_unk = client.post(
        f"/api/v1/join/{join_code}/lookup",
        json={"identifier": "NONEXISTENT"},
    )
    assert res_unk.status_code == 404
    assert res_unk.json() == expected_404

    # 3. Inactive member -> 404 generic
    res_inact = client.post(
        f"/api/v1/join/{join_code}/lookup",
        json={"identifier": "CS 102"},
    )
    assert res_inact.status_code == 404
    assert res_inact.json() == expected_404

    # 4. Wrong join code -> 404 generic
    res_bad_jc = client.post(
        "/api/v1/join/wrong_join_code/lookup",
        json={"identifier": "CS 101"},
    )
    assert res_bad_jc.status_code == 404
    assert res_bad_jc.json() == expected_404

    # 5. Group with no identifier -> 404 generic
    g_no_id = client.post("/api/v1/groups", json={"name": "No Id Group"}).json()
    res_no_id = client.post(
        f"/api/v1/join/{g_no_id['join_code']}/lookup",
        json={"identifier": "ANY_ID"},
    )
    assert res_no_id.status_code == 404
    assert res_no_id.json() == expected_404

    # 6. Claim Asha, then verify claimed member returns taken: true with null name
    client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": asha_id},
    )
    lookup_claimed = client.post(
        f"/api/v1/join/{join_code}/lookup",
        json={"identifier": "CS 101"},
    )
    assert lookup_claimed.status_code == 200
    claimed_data = lookup_claimed.json()
    assert claimed_data["taken"] is True
    assert claimed_data["display_name"] is None
    assert claimed_data["member_id"] == asha_id


def test_lookup_then_claim_end_to_end(client):
    """Test 6: Lookup then claim with returned member_id works end to end, second lookup shows taken: true."""
    g_res = client.post("/api/v1/groups", json={"name": "E2E Claim Group"})
    g_data = g_res.json()
    gid = g_data["group_id"]
    token = g_data["admin_token"]
    join_code = g_data["join_code"]

    f_res = client.post(
        f"/api/v1/groups/{gid}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "Student ID", "field_type": "text"},
    )
    fid = f_res.json()["id"]
    client.patch(
        f"/api/v1/groups/{gid}/fields/{fid}",
        headers={"X-Admin-Token": token},
        json={"is_identifier": True},
    )

    client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={"members": [{"display_name": "Devi", "values": {"student_id": "STU-999"}}]},
    )

    # Lookup unclaimed member
    lookup_1 = client.post(
        f"/api/v1/join/{join_code}/lookup",
        json={"identifier": "STU-999"},
    )
    assert lookup_1.status_code == 200
    d1 = lookup_1.json()
    assert d1["display_name"] == "Devi"
    assert d1["taken"] is False
    member_id = d1["member_id"]

    # Claim with member_id
    claim_res = client.post(
        f"/api/v1/join/{join_code}/claim",
        json={"member_id": member_id},
    )
    assert claim_res.status_code == 201
    claim_data = claim_res.json()
    assert claim_data["member_id"] == member_id
    assert "member_token" in claim_data

    # Second lookup shows taken: true and display_name is null
    lookup_2 = client.post(
        f"/api/v1/join/{join_code}/lookup",
        json={"identifier": "STU-999"},
    )
    assert lookup_2.status_code == 200
    d2 = lookup_2.json()
    assert d2["taken"] is True
    assert d2["display_name"] is None
    assert d2["member_id"] == member_id


def test_lookup_rate_limiting_with_injectable_clock(client):
    """Test 7: Rate limit: 11th lookup within a minute for same IP and join code returns 429;

    different join code is not affected; after clock moves forward 1 minute, lookups work again.
    """
    g1 = client.post("/api/v1/groups", json={"name": "Rate Limit Group 1"}).json()
    g2 = client.post("/api/v1/groups", json={"name": "Rate Limit Group 2"}).json()

    jc1 = g1["join_code"]
    jc2 = g2["join_code"]

    # Reset limiter and inject mock clock
    lookup_limiter.reset()
    simulated_time = 5000.0
    lookup_limiter.set_clock(lambda: simulated_time)

    try:
        # First 10 lookups for jc1 pass (returning 404 because no member matches, but not 429)
        for i in range(10):
            res = client.post(f"/api/v1/join/{jc1}/lookup", json={"identifier": f"test_{i}"})
            assert res.status_code == 404, f"Attempt {i+1} failed with status {res.status_code}"

        # 11th lookup for jc1 within the same minute returns 429
        res_11 = client.post(f"/api/v1/join/{jc1}/lookup", json={"identifier": "test_11"})
        assert res_11.status_code == 429
        err_content = res_11.json()["error"]
        assert err_content["code"] == "rate_limited"
        assert err_content["message"] == "Too many attempts. Please wait a minute and try again."

        # A different join code is NOT affected
        res_diff = client.post(f"/api/v1/join/{jc2}/lookup", json={"identifier": "test_diff"})
        assert res_diff.status_code == 404  # not 429!

        # Move clock forward by 61 seconds
        simulated_time += 61.0

        # Lookups on jc1 work again
        res_after = client.post(f"/api/v1/join/{jc1}/lookup", json={"identifier": "test_after"})
        assert res_after.status_code == 404  # not 429!

    finally:
        # Restore real clock and reset limiter
        lookup_limiter.set_clock(time.time)
        lookup_limiter.reset()


def test_patch_group_settings_validation(client):
    """Test 8: PATCH /groups/{id} with only allow_name_list, with only require_claim_approval, and with neither (422)."""
    g_res = client.post("/api/v1/groups", json={"name": "Settings Patch Group"})
    g_data = g_res.json()
    gid = g_data["group_id"]
    token = g_data["admin_token"]

    # 1. With only allow_name_list
    p1 = client.patch(
        f"/api/v1/groups/{gid}",
        headers={"X-Admin-Token": token},
        json={"allow_name_list": True},
    )
    assert p1.status_code == 200
    assert p1.json()["allow_name_list"] is True
    assert p1.json()["require_claim_approval"] is False

    # GET /groups/{id} returns allow_name_list too
    g_detail1 = client.get(f"/api/v1/groups/{gid}", headers={"X-Admin-Token": token}).json()
    assert g_detail1["allow_name_list"] is True

    # 2. With only require_claim_approval
    p2 = client.patch(
        f"/api/v1/groups/{gid}",
        headers={"X-Admin-Token": token},
        json={"require_claim_approval": True},
    )
    assert p2.status_code == 200
    assert p2.json()["require_claim_approval"] is True
    assert p2.json()["allow_name_list"] is True

    g_detail2 = client.get(f"/api/v1/groups/{gid}", headers={"X-Admin-Token": token}).json()
    assert g_detail2["require_claim_approval"] is True
    assert g_detail2["allow_name_list"] is True

    # 3. With neither -> 422
    p3 = client.patch(
        f"/api/v1/groups/{gid}",
        headers={"X-Admin-Token": token},
        json={},
    )
    assert p3.status_code == 422
    assert p3.json()["error"]["code"] == "validation_error"


def test_admin_status_and_history_include_member_identifiers(client):
    """Test 9: Admin status and history responses include original identifier for members,

    null when there is no identifier field; duplicate display names are distinguishable by it.
    """
    # 1. Group with identifier field and duplicate display names "Bob"
    g_res = client.post("/api/v1/groups", json={"name": "Duplicate Names Group"})
    g_data = g_res.json()
    gid = g_data["group_id"]
    token = g_data["admin_token"]
    join_code = g_data["join_code"]

    f_res = client.post(
        f"/api/v1/groups/{gid}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "Reg No", "field_type": "text"},
    )
    fid = f_res.json()["id"]
    client.patch(
        f"/api/v1/groups/{gid}/fields/{fid}",
        headers={"X-Admin-Token": token},
        json={"is_identifier": True},
    )

    client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={
            "members": [
                {"display_name": "Bob", "values": {"reg_no": "ID-100"}},
                {"display_name": "Bob", "values": {"reg_no": "ID-200"}},
            ]
        },
    )

    # Claim Bob ID-100
    lookup_bob1 = client.post(f"/api/v1/join/{join_code}/lookup", json={"identifier": "ID-100"}).json()
    bob1_id = lookup_bob1["member_id"]
    bob1_token = client.post(f"/api/v1/join/{join_code}/claim", json={"member_id": bob1_id}).json()["member_token"]

    # Create poll
    poll_res = client.post(
        f"/api/v1/groups/{gid}/polls",
        headers={"X-Admin-Token": token},
        json={
            "name": "Check-in Poll",
            "allow_multiple": False,
            "options": [
                {"label": "Done", "role": "target"},
                {"label": "Working", "role": "not_yet"},
            ],
        },
    )
    assert poll_res.status_code == 201
    poll_data = poll_res.json()
    pid = poll_data["id"]
    done_opt_id = next(o["id"] for o in poll_data["options"] if o["role"] == "target")

    # Bob 1 votes Done
    v_res = client.post(
        f"/api/v1/polls/{pid}/vote",
        headers={"X-Member-Token": bob1_token},
        json={"option_id": done_opt_id},
    )
    assert v_res.status_code == 200

    # Check admin status
    status_res = client.get(f"/api/v1/polls/{pid}/status", headers={"X-Admin-Token": token})
    assert status_res.status_code == 200
    s_data = status_res.json()

    assert len(s_data["at_target"]) == 1
    assert s_data["at_target"][0]["display_name"] == "Bob"
    assert s_data["at_target"][0]["identifier"] == "ID-100"

    assert len(s_data["not_voted"]) == 1
    assert s_data["not_voted"][0]["display_name"] == "Bob"
    assert s_data["not_voted"][0]["identifier"] == "ID-200"

    # Check admin history
    hist_res = client.get(f"/api/v1/polls/{pid}/history", headers={"X-Admin-Token": token})
    assert hist_res.status_code == 200
    h_data = hist_res.json()
    assert len(h_data) == 1
    assert h_data[0]["display_name"] == "Bob"
    assert h_data[0]["identifier"] == "ID-100"

    # 2. Group WITHOUT identifier field -> status and history have identifier: null
    g2 = client.post("/api/v1/groups", json={"name": "Plain Group"}).json()
    client.post(
        f"/api/v1/groups/{g2['group_id']}/members",
        headers={"X-Admin-Token": g2["admin_token"]},
        json={"display_names": ["Charlie"]},
    )
    p2 = client.post(
        f"/api/v1/groups/{g2['group_id']}/polls",
        headers={"X-Admin-Token": g2["admin_token"]},
        json={
            "name": "Plain Poll",
            "allow_multiple": False,
            "options": [
                {"label": "Option A", "role": "target"},
                {"label": "Option B", "role": "not_yet"},
            ],
        },
    ).json()

    s2 = client.get(f"/api/v1/polls/{p2['id']}/status", headers={"X-Admin-Token": g2["admin_token"]}).json()
    assert s2["not_voted"][0]["identifier"] is None


def test_nothing_public_ever_returns_full_identifier(client):
    """Test 10: Nothing public ever returns a full identifier (check join and lookup responses)."""
    g_res = client.post("/api/v1/groups", json={"name": "Secret Identifier Group"})
    g_data = g_res.json()
    gid = g_data["group_id"]
    token = g_data["admin_token"]
    join_code = g_data["join_code"]

    f_res = client.post(
        f"/api/v1/groups/{gid}/fields",
        headers={"X-Admin-Token": token},
        json={"name": "Secret Code", "field_type": "text"},
    )
    fid = f_res.json()["id"]
    client.patch(
        f"/api/v1/groups/{gid}/fields/{fid}",
        headers={"X-Admin-Token": token},
        json={"is_identifier": True},
    )

    full_secret = "SECRET_REG_9999"
    client.post(
        f"/api/v1/groups/{gid}/members",
        headers={"X-Admin-Token": token},
        json={"members": [{"display_name": "Eve", "values": {"secret_code": full_secret}}]},
    )

    # Enable allow_name_list to return members
    client.patch(
        f"/api/v1/groups/{gid}",
        headers={"X-Admin-Token": token},
        json={"allow_name_list": True},
    )

    # 1. Join response: full identifier string must not appear anywhere
    join_res = client.get(f"/api/v1/join/{join_code}")
    assert join_res.status_code == 200
    assert full_secret not in join_res.text
    # But hint should be present
    assert "•••999" in join_res.text

    # 2. Lookup response: full identifier string must not appear anywhere
    lookup_res = client.post(
        f"/api/v1/join/{join_code}/lookup",
        json={"identifier": full_secret},
    )
    assert lookup_res.status_code == 200
    assert full_secret not in lookup_res.text
    assert "Eve" in lookup_res.text
