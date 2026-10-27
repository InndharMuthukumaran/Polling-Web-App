"""Tests for Part FA: Central limits, higher boundaries, GET /limits, and reopening closed polls."""

from datetime import datetime, timezone
import uuid
import pytest
from sqlalchemy import select

from app.errors import PollClosedError, PollValidationError
from app import limits
from app.models import Group, Member, Poll, PollAnswer, PollField, PollOption, Vote, VoteHistory
from app.services.fields import create_group_field, list_group_fields
from app.services.identity import claim_member, create_group_with_admin
from app.services.importer import parse_raw_spreadsheet
from app.services.polls import (
    PollOptionInput,
    all_reached,
    cast_vote,
    close_poll,
    create_poll,
    get_member_history,
    get_poll_status,
    reopen_poll,
    save_poll_answers,
)
from tests.test_importer import make_csv


# ---------------------------------------------------------------------------
# 1. Limits API & Boundaries
# ---------------------------------------------------------------------------

def test_limits_endpoint_no_auth(client):
    """GET /api/v1/limits returns all limit keys with expected values and requires no auth."""
    res = client.get("/api/v1/limits")
    assert res.status_code == 200
    data = res.json()
    assert data["max_group_fields"] == limits.MAX_GROUP_FIELDS == 100
    assert data["max_poll_fields"] == limits.MAX_POLL_FIELDS == 50
    assert data["max_choices"] == limits.MAX_CHOICES == 200
    assert data["min_choices"] == limits.MIN_CHOICES == 2
    assert data["max_text_length"] == limits.MAX_TEXT_LENGTH == 500
    assert data["max_import_rows"] == limits.MAX_IMPORT_ROWS == 5000
    assert data["max_import_columns"] == limits.MAX_IMPORT_COLUMNS == 120
    assert data["max_import_file_bytes"] == limits.MAX_IMPORT_FILE_BYTES == 5 * 1024 * 1024
    assert data["max_members_per_request"] == limits.MAX_MEMBERS_PER_REQUEST == 5000


def test_boundary_group_fields_limit(db_session):
    """100 group fields allowed, 101st refused."""
    group, _ = create_group_with_admin(db_session, "Fields Limit Group")

    for i in range(limits.MAX_GROUP_FIELDS):
        create_group_field(db_session, group.id, f"Field_{i}", "text")

    assert len(list_group_fields(db_session, group.id)) == limits.MAX_GROUP_FIELDS

    with pytest.raises(PollValidationError) as exc:
        create_group_field(db_session, group.id, "Field_101", "text")
    assert f"at most {limits.MAX_GROUP_FIELDS} fields" in str(exc.value)


def test_boundary_poll_fields_limit(db_session):
    """50 poll fields allowed, 51st refused."""
    group, _ = create_group_with_admin(db_session, "Poll Fields Limit Group")
    base_opts = [("Yes", "target"), ("No", "not_yet")]

    # 50 poll fields allowed
    fifty_fields = [{"name": f"Question {i}", "field_type": "text"} for i in range(limits.MAX_POLL_FIELDS)]
    poll = create_poll(
        db_session,
        group_id=group.id,
        name="Poll with 50 fields",
        allow_multiple=False,
        options=base_opts,
        poll_fields=fifty_fields,
    )
    assert poll is not None
    assert len(poll.poll_fields) == limits.MAX_POLL_FIELDS

    # 51 poll fields refused
    fifty_one_fields = [{"name": f"Question {i}", "field_type": "text"} for i in range(limits.MAX_POLL_FIELDS + 1)]
    with pytest.raises(PollValidationError) as exc:
        create_poll(
            db_session,
            group_id=group.id,
            name="Poll with 51 fields",
            allow_multiple=False,
            options=base_opts,
            poll_fields=fifty_one_fields,
        )
    assert f"at most {limits.MAX_POLL_FIELDS} poll-only fields" in str(exc.value)


def test_boundary_choices_limit(db_session):
    """200 choices allowed, 201 refused."""
    group, _ = create_group_with_admin(db_session, "Choices Limit Group")

    # 200 choices allowed on choice field
    valid_choices = [f"Choice {i}" for i in range(limits.MAX_CHOICES)]
    f = create_group_field(db_session, group.id, "ChoiceField", "choice", choices=valid_choices)
    assert len(f.choices) == limits.MAX_CHOICES

    # 201 choices refused
    too_many_choices = [f"Choice {i}" for i in range(limits.MAX_CHOICES + 1)]
    with pytest.raises(PollValidationError) as exc:
        create_group_field(db_session, group.id, "ChoiceFieldOverflow", "choice", choices=too_many_choices)
    assert f"between {limits.MIN_CHOICES} and {limits.MAX_CHOICES} choices" in str(exc.value)


def test_boundary_import_rows_limit():
    """Import of 5000 rows allowed, 5001 refused with number taken from constants."""
    # 5000 data rows allowed
    valid_rows = [["Name"]] + [[f"Member {i}"] for i in range(limits.MAX_IMPORT_ROWS)]
    sheet_name, headers, data_rows = parse_raw_spreadsheet("roster.csv", make_csv(valid_rows))
    assert len(data_rows) == limits.MAX_IMPORT_ROWS

    # 5001 data rows refused
    overflow_rows = [["Name"]] + [[f"Member {i}"] for i in range(limits.MAX_IMPORT_ROWS + 1)]
    with pytest.raises(PollValidationError) as exc:
        parse_raw_spreadsheet("roster.csv", make_csv(overflow_rows))
    assert f"{limits.MAX_IMPORT_ROWS} data rows" in exc.value.message


# ---------------------------------------------------------------------------
# 2. Reopening Closed Polls
# ---------------------------------------------------------------------------

def test_reopen_poll_service_and_behavior(db_session):
    """Closed poll reopens, voting works again, history and answers are unchanged,

    reopening an open poll is harmless, reopening twice is harmless, and a vote
    made after reopening records timestamps correctly.
    """
    group, _ = create_group_with_admin(db_session, "Reopen Test Group")
    member = Member(group_id=group.id, display_name="Test Member", is_active=True, claim_status="approved")
    db_session.add(member)
    db_session.commit()

    poll = create_poll(
        db_session,
        group_id=group.id,
        name="Project Review",
        allow_multiple=False,
        options=[("Target Option", "target"), ("Not Yet", "not_yet")],
        poll_fields=[{"name": "Feedback", "field_type": "text"}],
    )
    opt_target = poll.options[0]
    opt_not_yet = poll.options[1]
    pf_feedback = poll.poll_fields[0]

    # Initial vote and answer before close
    t_vote1 = datetime(2026, 10, 15, 10, 0, 0, tzinfo=timezone.utc)
    cast_vote(db_session, poll.id, member.id, opt_not_yet.id, now=t_vote1)
    save_poll_answers(db_session, poll.id, member.id, {pf_feedback.key: "Looking good"})

    # Close poll
    t_close = datetime(2026, 10, 15, 12, 0, 0, tzinfo=timezone.utc)
    closed_poll = close_poll(db_session, poll.id, now=t_close)
    assert closed_poll.status == "closed"
    assert closed_poll.closed_at == t_close

    # Voting while closed is rejected
    with pytest.raises(PollClosedError):
        cast_vote(db_session, poll.id, member.id, opt_target.id)

    # Reopen poll
    reopened = reopen_poll(db_session, poll.id)
    assert reopened.status == "open"
    assert reopened.closed_at is None

    # Reopening an already open poll is harmless (idempotent)
    reopened_again = reopen_poll(db_session, poll.id)
    assert reopened_again.status == "open"
    assert reopened_again.closed_at is None

    # History and answers are intact
    hist = get_member_history(db_session, poll.id, member.id)
    assert len(hist) == 1
    assert hist[0].option_id == opt_not_yet.id
    assert hist[0].first_selected_at == t_vote1

    status_before_vote2 = get_poll_status(db_session, poll.id)
    assert len(status_before_vote2.behind_target) == 1
    assert status_before_vote2.behind_target[0].id == member.id

    ans = db_session.scalar(
        select(PollAnswer).where(PollAnswer.poll_id == poll.id, PollAnswer.member_id == member.id)
    )
    assert ans.values[pf_feedback.key] == "Looking good"

    # Voting works again after reopening and records timestamps correctly
    t_vote2 = datetime(2026, 10, 15, 14, 0, 0, tzinfo=timezone.utc)
    cast_vote(db_session, poll.id, member.id, opt_target.id, now=t_vote2)

    hist2 = get_member_history(db_session, poll.id, member.id)
    assert len(hist2) == 2
    target_hist = next(h for h in hist2 if h.option_id == opt_target.id)
    assert target_hist.first_selected_at == t_vote2
    assert target_hist.last_selected_at == t_vote2

    status_after_vote2 = get_poll_status(db_session, poll.id)
    assert len(status_after_vote2.at_target) == 1
    assert status_after_vote2.at_target[0].member.id == member.id
    assert all_reached(db_session, poll.id) is True


def test_reopen_poll_api_and_permissions(client):
    """POST /api/v1/polls/{id}/reopen authorization guards and response."""
    # Create Group A with admin
    res_a = client.post("/api/v1/groups", json={"name": "Reopen Group A"})
    assert res_a.status_code == 201
    group_a_id = res_a.json()["group_id"]
    admin_token_a = res_a.json()["admin_token"]
    headers_a = {"X-Admin-Token": admin_token_a}

    # Create Group B with admin
    res_b = client.post("/api/v1/groups", json={"name": "Reopen Group B"})
    assert res_b.status_code == 201
    admin_token_b = res_b.json()["admin_token"]
    headers_b = {"X-Admin-Token": admin_token_b}

    # Add member to Group A
    add_m_res = client.post(
        f"/api/v1/groups/{group_a_id}/members",
        headers=headers_a,
        json={"display_names": ["Asha"]},
    )
    member_id = add_m_res.json()[0]["id"]

    # Claim member to obtain member token
    claim_res = client.post(f"/api/v1/join/{res_a.json()['join_code']}/claim", json={"member_id": member_id})
    member_token = claim_res.json()["member_token"]
    member_headers = {"X-Member-Token": member_token}

    # Create poll in Group A
    poll_res = client.post(
        f"/api/v1/groups/{group_a_id}/polls",
        headers=headers_a,
        json={
            "name": "Poll to Reopen",
            "allow_multiple": False,
            "options": [{"label": "Opt 1", "role": "target"}, {"label": "Opt 2", "role": "not_yet"}],
        },
    )
    poll_id = poll_res.json()["id"]

    # Close poll
    close_res = client.post(f"/api/v1/polls/{poll_id}/close", headers=headers_a)
    assert close_res.status_code == 200
    assert close_res.json()["status"] == "closed"

    # 1. No token -> 401
    res_no_token = client.post(f"/api/v1/polls/{poll_id}/reopen")
    assert res_no_token.status_code == 401

    # 2. Member token cannot reopen -> 401 (admin token required)
    res_member = client.post(f"/api/v1/polls/{poll_id}/reopen", headers=member_headers)
    assert res_member.status_code == 401

    # 3. Wrong group's admin token -> 403
    res_wrong_admin = client.post(f"/api/v1/polls/{poll_id}/reopen", headers=headers_b)
    assert res_wrong_admin.status_code == 403

    # 4. Valid admin token -> 200 with open status
    res_reopen = client.post(f"/api/v1/polls/{poll_id}/reopen", headers=headers_a)
    assert res_reopen.status_code == 200
    assert res_reopen.json()["status"] == "open"
    assert res_reopen.json()["id"] == poll_id

    # 5. Reopening an already open poll returns 200 (harmless / idempotent)
    res_reopen_again = client.post(f"/api/v1/polls/{poll_id}/reopen", headers=headers_a)
    assert res_reopen_again.status_code == 200
    assert res_reopen_again.json()["status"] == "open"
