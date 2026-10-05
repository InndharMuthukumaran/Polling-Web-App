"""Tests for identity layer: admin tokens, member tokens, claims, and migrations."""

from datetime import datetime, timezone
from pathlib import Path
import threading
import uuid
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from alembic import command
from alembic.config import Config
from app.db import Base
from app.errors import (
    ClaimConflictError,
    ClaimNotApprovedError,
    ClaimStateError,
    GroupNotFoundError,
    InvalidTokenError,
    MemberInactiveError,
    MemberNotFoundError,
    PermissionDeniedError,
    PollValidationError,
)
from app.models import Group, Member
from app.security import hash_token
from app.services.identity import (
    add_members_bulk,
    approve_claim,
    authenticate_admin,
    authenticate_member,
    claim_member,
    create_group_with_admin,
    get_group_by_join_code,
    list_group_members,
    release_own_claim,
    require_approved,
    reset_claim,
    update_group_settings,
    update_member,
)
from app.services.polls import (
    PollOptionInput,
    cast_vote,
    create_group,
    create_poll,
    get_member_history,
)


def dt(hour: int, minute: int = 0) -> datetime:
    """Helper to generate timezone-aware UTC datetime."""
    return datetime(2026, 9, 29, hour, minute, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# 1. Group Creation with Admin Token & Plain Token Storage Assertion
# ---------------------------------------------------------------------------
def test_create_group_with_admin_plain_token_never_stored(db_session):
    """
    Creating a group with an admin returns a token; the database holds only
    its hash. Assert the plain token appears nowhere in any column of any table.
    """
    group, admin_token = create_group_with_admin(db_session, "Security Test Group")

    assert isinstance(admin_token, str)
    assert len(admin_token) >= 32
    assert group.admin_token_hash == hash_token(admin_token)
    assert group.join_code is not None
    assert len(group.join_code) >= 9

    # Add a member and claim member to test member token plain text as well
    members = add_members_bulk(db_session, group.id, ["Alice"])
    alice = members[0]
    alice_claimed, member_token = claim_member(db_session, group.join_code, alice.id)

    assert isinstance(member_token, str)
    assert len(member_token) >= 32
    assert alice_claimed.member_token_hash == hash_token(member_token)

    # Inspect all rows across all tables in the entire database
    # Assert that neither plain admin_token nor plain member_token appears in any column
    for table in Base.metadata.sorted_tables:
        rows = db_session.execute(table.select()).mappings().all()
        for row in rows:
            for col_name, val in row.items():
                if val is not None:
                    val_str = str(val)
                    assert admin_token not in val_str, (
                        f"Plain admin token leaked into table '{table.name}', column '{col_name}': {val_str}"
                    )
                    assert member_token not in val_str, (
                        f"Plain member token leaked into table '{table.name}', column '{col_name}': {val_str}"
                    )


# ---------------------------------------------------------------------------
# 2. Authenticate Admin Tests
# ---------------------------------------------------------------------------
def test_authenticate_admin_success_and_failures(db_session):
    """
    authenticate_admin:
    - right token passes;
    - wrong token, empty token, and a group made with plain create_group all raise InvalidTokenError;
    - an unknown group raises GroupNotFoundError.
    """
    group, admin_token = create_group_with_admin(db_session, "Admin Auth Group")

    # 1. Right token passes
    auth_group = authenticate_admin(db_session, group.id, admin_token)
    assert auth_group.id == group.id
    assert auth_group.name == "Admin Auth Group"

    # 2. Wrong token raises InvalidTokenError
    with pytest.raises(InvalidTokenError):
        authenticate_admin(db_session, group.id, "completely-wrong-token-value")

    # 3. Empty token raises InvalidTokenError
    with pytest.raises(InvalidTokenError):
        authenticate_admin(db_session, group.id, "")
    with pytest.raises(InvalidTokenError):
        authenticate_admin(db_session, group.id, "   ")

    # 4. Group made with plain create_group has no admin token -> raises InvalidTokenError
    plain_group = create_group(db_session, "Plain Creator Group")
    assert plain_group.admin_token_hash is None
    with pytest.raises(InvalidTokenError):
        authenticate_admin(db_session, plain_group.id, admin_token)
    with pytest.raises(InvalidTokenError):
        authenticate_admin(db_session, plain_group.id, "any-admin-token")

    # 5. Unknown group raises GroupNotFoundError
    random_gid = uuid.uuid4()
    with pytest.raises(GroupNotFoundError):
        authenticate_admin(db_session, random_gid, admin_token)


# ---------------------------------------------------------------------------
# 3. Add Members Bulk Tests
# ---------------------------------------------------------------------------
def test_add_members_bulk_success_and_failures(db_session):
    """
    add_members_bulk:
    - success adds all members trimmed and unclaimed;
    - blank name, duplicate in list, and duplicate of an existing member each fail and add nothing.
    """
    group, _ = create_group_with_admin(db_session, "Bulk Group")

    # 1. Successful bulk add
    members = add_members_bulk(db_session, group.id, [" Alice ", "Bob", " Charlie "])
    assert len(members) == 3
    assert [m.display_name for m in members] == ["Alice", "Bob", "Charlie"]
    for m in members:
        assert m.claim_status == "unclaimed"
        assert m.member_token_hash is None
        assert m.claimed_at is None
        assert m.is_active is True

    # 2. Blank name fails all-or-nothing
    with pytest.raises(PollValidationError):
        add_members_bulk(db_session, group.id, ["David", "   ", "Eve"])
    # Verify neither David nor Eve were added
    existing_names = [m.display_name for m in list_group_members(db_session, group.id)]
    assert "David" not in existing_names
    assert "Eve" not in existing_names
    assert len(existing_names) == 3

    # 3. Duplicate within list fails all-or-nothing
    with pytest.raises(PollValidationError):
        add_members_bulk(db_session, group.id, ["Frank", " Frank "])
    existing_names = [m.display_name for m in list_group_members(db_session, group.id)]
    assert "Frank" not in existing_names
    assert len(existing_names) == 3

    # 4. Duplicate of existing member fails all-or-nothing
    with pytest.raises(PollValidationError):
        add_members_bulk(db_session, group.id, ["Grace", "Alice"])
    existing_names = [m.display_name for m in list_group_members(db_session, group.id)]
    assert "Grace" not in existing_names
    assert len(existing_names) == 3


# ---------------------------------------------------------------------------
# 4. Update Member Tests
# ---------------------------------------------------------------------------
def test_update_member_rename_deactivate_and_permissions(db_session):
    """
    update_member:
    - rename works;
    - renaming to an existing name fails;
    - deactivating works;
    - a member from another group raises PermissionDeniedError;
    - changing nothing is allowed.
    """
    group1, _ = create_group_with_admin(db_session, "Group 1")
    group2, _ = create_group_with_admin(db_session, "Group 2")

    members = add_members_bulk(db_session, group1.id, ["Alice", "Bob"])
    alice, bob = members[0], members[1]

    g2_members = add_members_bulk(db_session, group2.id, ["Charlie"])
    charlie = g2_members[0]

    # 1. Rename works
    updated_alice = update_member(db_session, group1.id, alice.id, display_name=" Alicia ")
    assert updated_alice.display_name == "Alicia"

    # 2. Renaming to an existing name in the same group fails
    with pytest.raises(PollValidationError):
        update_member(db_session, group1.id, alice.id, display_name="Bob")

    # 3. Renaming to blank fails
    with pytest.raises(PollValidationError):
        update_member(db_session, group1.id, alice.id, display_name="   ")

    # 4. Deactivating works
    deactivated = update_member(db_session, group1.id, bob.id, is_active=False)
    assert deactivated.is_active is False

    # Reactivating works
    reactivated = update_member(db_session, group1.id, bob.id, is_active=True)
    assert reactivated.is_active is True

    # 5. Changing nothing is allowed
    unchanged = update_member(db_session, group1.id, alice.id)
    assert unchanged.display_name == "Alicia"
    assert unchanged.is_active is True

    # 6. Member from another group raises PermissionDeniedError
    with pytest.raises(PermissionDeniedError):
        update_member(db_session, group1.id, charlie.id, display_name="Charlie Hacked")

    # Unknown member raises MemberNotFoundError
    with pytest.raises(MemberNotFoundError):
        update_member(db_session, group1.id, uuid.uuid4(), display_name="Ghost")


# ---------------------------------------------------------------------------
# 5. Claim With Approval Off
# ---------------------------------------------------------------------------
def test_claim_member_approval_off(db_session):
    """
    Claim with approval off (default):
    - status becomes approved;
    - the returned token authenticates as that member.
    """
    group, _ = create_group_with_admin(db_session, "Immediate Claim Group")
    assert group.require_claim_approval is False

    members = add_members_bulk(db_session, group.id, ["Alice"])
    alice = members[0]

    claim_time = dt(12, 0)
    claimed_alice, member_token = claim_member(
        db_session, group.join_code, alice.id, now=claim_time
    )

    assert claimed_alice.claim_status == "approved"
    assert claimed_alice.claimed_at == claim_time
    assert claimed_alice.member_token_hash == hash_token(member_token)

    # Token authenticates as that member
    auth_member = authenticate_member(db_session, member_token)
    assert auth_member.id == alice.id
    assert auth_member.display_name == "Alice"

    # require_approved passes
    require_approved(auth_member)


# ---------------------------------------------------------------------------
# 6. Claim With Approval On
# ---------------------------------------------------------------------------
def test_claim_member_approval_on(db_session):
    """
    Claim with approval on:
    - status is pending;
    - approve_claim moves it to approved;
    - require_approved raises before approval and passes after.
    """
    group, _ = create_group_with_admin(db_session, "Approval Required Group")
    update_group_settings(db_session, group.id, require_claim_approval=True)

    members = add_members_bulk(db_session, group.id, ["Bob"])
    bob = members[0]

    claimed_bob, token = claim_member(db_session, group.join_code, bob.id)
    assert claimed_bob.claim_status == "pending"

    # authenticate_member returns the member without checking approval
    auth_bob = authenticate_member(db_session, token)
    assert auth_bob.id == bob.id

    # require_approved raises before approval
    with pytest.raises(ClaimNotApprovedError):
        require_approved(auth_bob)

    # approve_claim moves it to approved
    approved_bob = approve_claim(db_session, group.id, bob.id)
    assert approved_bob.claim_status == "approved"

    # require_approved passes after approval
    require_approved(approved_bob)

    # Calling approve_claim again on already approved member is a no-op
    reapproved = approve_claim(db_session, group.id, bob.id)
    assert reapproved.claim_status == "approved"


# ---------------------------------------------------------------------------
# 7. Claim Error Cases
# ---------------------------------------------------------------------------
def test_claim_error_cases(db_session):
    """
    Claiming an already claimed name raises ClaimConflictError;
    claiming with a wrong join code, a member from another group, or an inactive
    member raises the right errors.
    """
    group1, _ = create_group_with_admin(db_session, "Group 1")
    group2, _ = create_group_with_admin(db_session, "Group 2")

    members1 = add_members_bulk(db_session, group1.id, ["Alice", "InactiveGuy"])
    alice, inactive_guy = members1[0], members1[1]
    update_member(db_session, group1.id, inactive_guy.id, is_active=False)

    members2 = add_members_bulk(db_session, group2.id, ["Bob"])
    bob = members2[0]

    # 1. Claim Alice
    claim_member(db_session, group1.join_code, alice.id)

    # 2. Claiming an already claimed member raises ClaimConflictError
    with pytest.raises(ClaimConflictError):
        claim_member(db_session, group1.join_code, alice.id)

    # 3. Claiming with a wrong join code raises GroupNotFoundError
    with pytest.raises(GroupNotFoundError):
        claim_member(db_session, "nonexistent-join-code", alice.id)

    # 4. Member from another group raises PermissionDeniedError
    with pytest.raises(PermissionDeniedError):
        claim_member(db_session, group1.join_code, bob.id)

    # 5. Inactive member raises MemberInactiveError
    with pytest.raises(MemberInactiveError):
        claim_member(db_session, group1.join_code, inactive_guy.id)


# ---------------------------------------------------------------------------
# 8. Reset Claim and History Preservation
# ---------------------------------------------------------------------------
def test_reset_claim_revokes_token_allows_reclaim_and_preserves_history(db_session):
    """
    reset_claim:
    - the old token stops working (InvalidTokenError);
    - the name can be claimed again;
    - the member's earlier votes and history are still there
      (use Part 1 cast_vote before reset and get_member_history after).
    """
    group, _ = create_group_with_admin(db_session, "History Group")
    members = add_members_bulk(db_session, group.id, ["Alice"])
    alice = members[0]

    # Alice claims her name
    _, old_token = claim_member(db_session, group.join_code, alice.id)

    # Create a poll and cast a vote for Alice
    poll = create_poll(
        db_session,
        group_id=group.id,
        name="Team Lunch",
        allow_multiple=False,
        options=[
            PollOptionInput(label="Pizza", role="target"),
            PollOptionInput(label="Salad", role="not_yet"),
        ],
    )
    opt_pizza = [o for o in poll.options if o.label == "Pizza"][0]

    t_vote = dt(13, 0)
    cast_vote(db_session, poll.id, alice.id, opt_pizza.id, now=t_vote)

    # Verify history exists before reset
    hist_before = get_member_history(db_session, poll.id, alice.id)
    assert len(hist_before) == 1
    assert hist_before[0].option_id == opt_pizza.id
    assert hist_before[0].first_selected_at == t_vote

    # Reset claim
    reset_member = reset_claim(db_session, group.id, alice.id)
    assert reset_member.claim_status == "unclaimed"
    assert reset_member.member_token_hash is None
    assert reset_member.claimed_at is None

    # Old token fails authentication
    with pytest.raises(InvalidTokenError):
        authenticate_member(db_session, old_token)

    # Name can be claimed again
    reclaimed_member, new_token = claim_member(db_session, group.join_code, alice.id)
    assert reclaimed_member.claim_status == "approved"
    assert new_token != old_token

    # New token authenticates successfully
    auth_reclaimed = authenticate_member(db_session, new_token)
    assert auth_reclaimed.id == alice.id

    # Earlier votes and history are still intact!
    hist_after = get_member_history(db_session, poll.id, alice.id)
    assert len(hist_after) == 1
    assert hist_after[0].option_id == opt_pizza.id
    assert hist_after[0].first_selected_at == t_vote
    assert hist_after[0].last_selected_at == t_vote


# ---------------------------------------------------------------------------
# 9. Approve Claim on Unclaimed Member
# ---------------------------------------------------------------------------
def test_approve_claim_on_unclaimed_raises_claim_state_error(db_session):
    """approve_claim on an unclaimed member raises ClaimStateError."""
    group, _ = create_group_with_admin(db_session, "State Error Group")
    members = add_members_bulk(db_session, group.id, ["UnclaimedMember"])
    member = members[0]

    assert member.claim_status == "unclaimed"
    with pytest.raises(ClaimStateError):
        approve_claim(db_session, group.id, member.id)

    # Calling approve_claim with wrong group raises PermissionDeniedError
    other_group, _ = create_group_with_admin(db_session, "Other Group")
    with pytest.raises(PermissionDeniedError):
        approve_claim(db_session, other_group.id, member.id)


# ---------------------------------------------------------------------------
# 10. Concurrency: Two Threads Claiming the Same Member Simultaneously
# ---------------------------------------------------------------------------
def test_concurrent_claims_on_same_member(test_engine):
    """
    Two threads with separate sessions claiming the same member at once:
    exactly one succeeds and the other raises ClaimConflictError.
    """
    session_factory = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)
    setup_session = session_factory()

    try:
        group, _ = create_group_with_admin(setup_session, "Race Condition Group")
        members = add_members_bulk(setup_session, group.id, ["ContestedMember"])
        target_member_id = members[0].id
        join_code = group.join_code
    finally:
        setup_session.close()

    barrier = threading.Barrier(2)
    results = {"success": 0, "conflict": 0, "errors": []}
    results_lock = threading.Lock()

    def claim_worker():
        worker_session = session_factory()
        try:
            # Wait for both threads to be ready at the gate
            barrier.wait(timeout=5)
            claim_member(worker_session, join_code, target_member_id)
            with results_lock:
                results["success"] += 1
        except ClaimConflictError:
            with results_lock:
                results["conflict"] += 1
        except Exception as exc:
            with results_lock:
                results["errors"].append(exc)
        finally:
            worker_session.close()

    t1 = threading.Thread(target=claim_worker)
    t2 = threading.Thread(target=claim_worker)

    t1.start()
    t2.start()

    t1.join(timeout=10)
    t2.join(timeout=10)

    assert not results["errors"], f"Unexpected errors during concurrent claim: {results['errors']}"
    assert results["success"] == 1, f"Expected exactly 1 success, got {results['success']}"
    assert results["conflict"] == 1, f"Expected exactly 1 conflict, got {results['conflict']}"


# ---------------------------------------------------------------------------
# 11. Alembic Migration Upgrade and Downgrade Cycle
# ---------------------------------------------------------------------------
def test_alembic_migration_upgrade_and_downgrade_cycle(test_engine_and_url):
    """
    Migration: alembic upgrade head works on an empty database,
    and downgrade to 001_initial_schema followed by upgrade head also works.
    """
    engine, test_db_url = test_engine_and_url
    backend_dir = Path(__file__).resolve().parent.parent
    alembic_ini_path = backend_dir / "alembic.ini"

    alembic_cfg = Config(str(alembic_ini_path))
    alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", test_db_url)

    # 1. Downgrade to 001_initial_schema
    with engine.begin() as connection:
        alembic_cfg.attributes["connection"] = connection
        command.downgrade(alembic_cfg, "001_initial_schema")

    # 2. Upgrade back to head
    with engine.begin() as connection:
        alembic_cfg.attributes["connection"] = connection
        command.upgrade(alembic_cfg, "head")

    # 3. Downgrade to base (empty database test)
    with engine.begin() as connection:
        alembic_cfg.attributes["connection"] = connection
        command.downgrade(alembic_cfg, "base")

    # 4. Upgrade head on empty database
    with engine.begin() as connection:
        alembic_cfg.attributes["connection"] = connection
        command.upgrade(alembic_cfg, "head")


def test_release_own_claim(db_session):
    """release_own_claim frees the name, clears token hash and claimed_at."""
    group, _ = create_group_with_admin(db_session, "Self Release Group")
    members = add_members_bulk(db_session, group.id, ["Daniel"])
    dave = members[0]

    claimed, token = claim_member(db_session, group.join_code, dave.id)
    assert claimed.claim_status == "approved"
    assert claimed.member_token_hash is not None
    assert claimed.claimed_at is not None

    released = release_own_claim(db_session, claimed)
    assert released.claim_status == "unclaimed"
    assert released.member_token_hash is None
    assert released.claimed_at is None

    # Old token fails authentication
    with pytest.raises(InvalidTokenError):
        authenticate_member(db_session, token)

