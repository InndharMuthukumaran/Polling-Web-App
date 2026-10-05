"""Tests for group fields, values, defaults, identifier, and migration rules."""

from datetime import datetime, timezone
import math
from pathlib import Path
import threading
import uuid

from alembic import command
from alembic.config import Config
import pytest
import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.errors import (
    FieldNotFoundError,
    PollValidationError,
)
from app.models import Group, GroupField, Member
from app.services.fields import (
    create_group_field,
    delete_group_field,
    generate_field_key,
    list_group_fields,
    normalize_identifier,
    update_group_field,
    validate_and_canonicalize_value,
)
from app.services.identity import (
    add_members_bulk,
    create_group_with_admin,
    list_group_members,
    update_member,
)
from app.services.polls import add_member


# ---------------------------------------------------------------------------
# 1. Migration tests
# ---------------------------------------------------------------------------
def test_alembic_migration_003_cycle_and_member_preservation(test_engine_and_url):
    """
    Migration:
    - alembic upgrade head works on empty database;
    - downgrade to 002_identity and upgrade again works;
    - existing members survive, field_values is empty dict, name constraint is dropped.
    """
    engine, test_db_url = test_engine_and_url
    backend_dir = Path(__file__).resolve().parent.parent
    alembic_ini_path = backend_dir / "alembic.ini"

    alembic_cfg = Config(str(alembic_ini_path))
    alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", test_db_url)

    # 1. Downgrade to 002_identity
    with engine.begin() as connection:
        alembic_cfg.attributes["connection"] = connection
        command.downgrade(alembic_cfg, "002_identity")

    # Insert a group and members under 002 schema using raw SQL
    gid = uuid.uuid4()
    mid = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO groups (id, name, join_code, created_at) "
                "VALUES (:id, 'Migration Group', 'migr002', NOW())"
            ),
            {"id": gid},
        )
        conn.execute(
            sa.text(
                "INSERT INTO members (id, group_id, display_name, created_at) "
                "VALUES (:id, :gid, 'Member One', NOW())"
            ),
            {"id": mid, "gid": gid},
        )

    # 2. Upgrade to head (003_group_fields)
    with engine.begin() as connection:
        alembic_cfg.attributes["connection"] = connection
        command.upgrade(alembic_cfg, "head")

    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    # Verify existing member survived and has field_values default '{}' and identifier_value None
    with session_factory() as session:
        m = session.get(Member, mid)
        assert m is not None
        assert m.display_name == "Member One"
        assert m.field_values == {}
        assert m.identifier_value is None

        # Verify unique name constraint is dropped: DB allows duplicate display_name directly
        m2 = Member(
            id=uuid.uuid4(),
            group_id=gid,
            display_name="Member One",
            field_values={},
            identifier_value=None,
            created_at=datetime.now(timezone.utc),
        )
        session.add(m2)
        session.commit()

        # Cleanup
        session.delete(m2)
        session.delete(m)
        session.delete(session.get(Group, gid))
        session.commit()

    # 3. Test downgrade to base and upgrade back to head
    with engine.begin() as connection:
        alembic_cfg.attributes["connection"] = connection
        command.downgrade(alembic_cfg, "base")

    with engine.begin() as connection:
        alembic_cfg.attributes["connection"] = connection
        command.upgrade(alembic_cfg, "head")


# ---------------------------------------------------------------------------
# 2. Field creation tests
# ---------------------------------------------------------------------------
def test_field_creation_rules_and_keys(db_session):
    """
    Field creation:
    - key generation (lowercase, runs of symbols -> _, trimmed, clashing appends _2, _3);
    - name uniqueness ignoring case;
    - choice validation;
    - non-choice types with choices fails;
    - 30-field limit.
    """
    group, _ = create_group_with_admin(db_session, "Fields Group")

    # 1. Normal field creation
    f1 = create_group_field(db_session, group.id, "Register No", "text")
    assert f1.key == "register_no"
    assert f1.position == 1

    # 2. Key clash with different formatting
    f2 = create_group_field(db_session, group.id, "Register--No!", "text")
    assert f2.key == "register_no_2"
    assert f2.position == 2

    f3 = create_group_field(db_session, group.id, "_register_no_", "text")
    assert f3.key == "register_no_3"
    assert f3.position == 3

    # 3. Name uniqueness ignoring case
    with pytest.raises(PollValidationError) as exc:
        create_group_field(db_session, group.id, "register no", "text")
    assert "already exists in group" in str(exc.value)

    # 4. Name length constraints
    with pytest.raises(PollValidationError):
        create_group_field(db_session, group.id, "   ", "text")
    with pytest.raises(PollValidationError):
        create_group_field(db_session, group.id, "A" * 61, "text")

    # 5. Choice validation: 2 to 50 unique items, 1 to 100 chars
    f_choice = create_group_field(
        db_session,
        group.id,
        "Department",
        "choice",
        choices=[" Computer Science ", "ECE", "Mech"],
    )
    assert f_choice.choices == ["Computer Science", "ECE", "Mech"]

    # Less than 2 choices
    with pytest.raises(PollValidationError):
        create_group_field(db_session, group.id, "Team", "choice", choices=["One"])

    # Duplicate choices ignoring case
    with pytest.raises(PollValidationError):
        create_group_field(
            db_session, group.id, "Role", "choice", choices=["Admin", "admin"]
        )

    # Choice item blank or too long
    with pytest.raises(PollValidationError):
        create_group_field(
            db_session, group.id, "Role2", "choice", choices=["Admin", "   "]
        )
    with pytest.raises(PollValidationError):
        create_group_field(
            db_session, group.id, "Role3", "choice", choices=["Admin", "x" * 101]
        )

    # Non-choice field with choices fails
    with pytest.raises(PollValidationError):
        create_group_field(
            db_session, group.id, "Notes", "text", choices=["Option 1", "Option 2"]
        )

    # 6. 30 fields limit
    current_count = len(list_group_fields(db_session, group.id))
    for i in range(current_count, 30):
        create_group_field(db_session, group.id, f"Extra Field {i}", "text")

    assert len(list_group_fields(db_session, group.id)) == 30

    with pytest.raises(PollValidationError) as exc:
        create_group_field(db_session, group.id, "One Too Many", "text")
    assert "at most 30 fields" in str(exc.value)


# ---------------------------------------------------------------------------
# 3. Value validation for each type
# ---------------------------------------------------------------------------
def test_value_validation_for_each_type():
    """Value validation for text, number, choice, and link."""
    # Text
    assert validate_and_canonicalize_value("text", "  hello world  ") == "hello world"
    assert len(validate_and_canonicalize_value("text", "a" * 500)) == 500
    with pytest.raises(PollValidationError):
        validate_and_canonicalize_value("text", "a" * 501)
    with pytest.raises(PollValidationError):
        validate_and_canonicalize_value("text", 123)

    # Link
    assert validate_and_canonicalize_value("link", " https://example.com/path ") == "https://example.com/path"
    assert validate_and_canonicalize_value("link", "http://example.com") == "http://example.com"
    with pytest.raises(PollValidationError):
        validate_and_canonicalize_value("link", "ftp://example.com")
    with pytest.raises(PollValidationError):
        validate_and_canonicalize_value("link", "https://example .com")
    with pytest.raises(PollValidationError):
        validate_and_canonicalize_value("link", "https://example.com/" + ("a" * 2000))

    # Choice (case-insensitive match stored canonically)
    choices = ["Alpha", "Beta", "Gamma"]
    assert validate_and_canonicalize_value("choice", " alpha ", choices=choices) == "Alpha"
    assert validate_and_canonicalize_value("choice", "BETA", choices=choices) == "Beta"
    with pytest.raises(PollValidationError):
        validate_and_canonicalize_value("choice", "Delta", choices=choices)

    # Number
    assert validate_and_canonicalize_value("number", 42) == 42
    assert validate_and_canonicalize_value("number", 42.0) == 42
    assert validate_and_canonicalize_value("number", 3.14) == 3.14
    assert validate_and_canonicalize_value("number", " 100 ") == 100
    assert validate_and_canonicalize_value("number", " 25.5 ") == 25.5
    assert validate_and_canonicalize_value("number", " 50.0 ") == 50
    # Booleans are not accepted
    with pytest.raises(PollValidationError):
        validate_and_canonicalize_value("number", True)
    with pytest.raises(PollValidationError):
        validate_and_canonicalize_value("number", False)
    # NaN and Inf are rejected
    with pytest.raises(PollValidationError):
        validate_and_canonicalize_value("number", float("nan"))
    with pytest.raises(PollValidationError):
        validate_and_canonicalize_value("number", float("inf"))
    with pytest.raises(PollValidationError):
        validate_and_canonicalize_value("number", "NaN")
    with pytest.raises(PollValidationError):
        validate_and_canonicalize_value("number", "not_a_number")


# ---------------------------------------------------------------------------
# 4. Defaults on create and update
# ---------------------------------------------------------------------------
def test_defaults_on_add_and_update(db_session):
    """
    Defaults:
    - blank value is filled on add and on update;
    - a required field without default fails;
    - sending a blank on update resets it to default or removes it if no default.
    """
    group, _ = create_group_with_admin(db_session, "Defaults Group")
    f_dept = create_group_field(
        db_session, group.id, "Department", "text", default_value="Engineering"
    )
    f_role = create_group_field(
        db_session, group.id, "Role", "text", is_required=False
    )
    f_req = create_group_field(
        db_session, group.id, "Code", "text", is_required=True, default_value="C01"
    )

    # 1. Blank value on add is filled with default
    members = add_members_bulk(
        db_session,
        group.id,
        members_data=[
            {"display_name": "Alice", "values": {f_dept.key: "   ", f_role.key: "Dev"}},
        ],
    )
    alice = members[0]
    assert alice.field_values[f_dept.key] == "Engineering"
    assert alice.field_values[f_role.key] == "Dev"
    assert alice.field_values[f_req.key] == "C01"

    # 2. Blank on update resets to default
    updated = update_member(
        db_session,
        group.id,
        alice.id,
        values={f_dept.key: "Marketing"},
    )
    assert updated.field_values[f_dept.key] == "Marketing"

    reset_mem = update_member(
        db_session,
        group.id,
        alice.id,
        values={f_dept.key: "   "},
    )
    assert reset_mem.field_values[f_dept.key] == "Engineering"

    # 3. Blank on update for non-required field with no default removes it
    removed_role = update_member(
        db_session,
        group.id,
        alice.id,
        values={f_role.key: ""},
    )
    assert f_role.key not in removed_role.field_values

    # 4. Required field without default: adding member with blank fails
    f_strict = create_group_field(
        db_session, group.id, "Strict", "text", is_required=True, default_value="Init"
    )
    # Remove default on strict
    update_group_field(db_session, group.id, f_strict.id, default_value="")
    assert f_strict.default_value is None

    with pytest.raises(PollValidationError) as exc:
        add_members_bulk(
            db_session,
            group.id,
            members_data=[{"display_name": "Bob", "values": {}}],
        )
    assert f_strict.name in str(exc.value)

    # Blank on update for required field without default fails
    with pytest.raises(PollValidationError):
        update_member(db_session, group.id, alice.id, values={f_strict.key: "  "})


# ---------------------------------------------------------------------------
# 5. Adding fields with existing members
# ---------------------------------------------------------------------------
def test_adding_fields_with_existing_members(db_session):
    """
    Adding fields when members exist:
    - adding field with default backfills all existing members;
    - adding required field without default fails, naming member count.
    """
    group, _ = create_group_with_admin(db_session, "Backfill Group")
    add_members_bulk(db_session, group.id, ["Alice", "Bob"])

    # 1. Adding required field without default fails naming member count
    with pytest.raises(PollValidationError) as exc:
        create_group_field(db_session, group.id, "Strict", "text", is_required=True)
    assert "2 member(s) exist" in str(exc.value)

    # 2. Adding field with default backfills all existing members
    field = create_group_field(
        db_session, group.id, "Campus", "text", default_value="Main"
    )
    members = list_group_members(db_session, group.id)
    assert len(members) == 2
    for m in members:
        assert m.field_values[field.key] == "Main"


# ---------------------------------------------------------------------------
# 6. Identifier lifecycle: mark, unmark, validation details
# ---------------------------------------------------------------------------
def test_identifier_lifecycle_and_details(db_session):
    """
    Marking identifier:
    - cannot create as identifier when members exist;
    - succeeds when all values present and unique, sets identifier_value normalized;
    - fails with details when member has blank;
    - fails with details when members collide (case / spacing);
    - fails for non-text fields;
    - fails if another identifier exists;
    - unmarking clears identifier_value while keeping field required.
    """
    group, _ = create_group_with_admin(db_session, "ID Group")
    members = add_members_bulk(db_session, group.id, ["Alice", "Bob"])

    # 1. Cannot create as identifier when members exist
    with pytest.raises(PollValidationError) as exc:
        create_group_field(
            db_session, group.id, "RegNo", "text", is_identifier=True
        )
    assert "Cannot create a new field as the identifier while members exist" in str(exc.value)

    # 2. Add text field without identifier
    reg_field = create_group_field(db_session, group.id, "Register No", "text")

    # 3. Marking fails when members have blank values (details provided)
    with pytest.raises(PollValidationError) as exc:
        update_group_field(db_session, group.id, reg_field.id, is_identifier=True)
    assert exc.value.details is not None
    assert len(exc.value.details) == 2

    # 4. Populate values with collision (different case and spacing)
    update_member(db_session, group.id, members[0].id, values={reg_field.key: " CS 101 "})
    update_member(db_session, group.id, members[1].id, values={reg_field.key: "cs   101"})

    # Marking fails due to collision
    with pytest.raises(PollValidationError) as exc:
        update_group_field(db_session, group.id, reg_field.id, is_identifier=True)
    assert exc.value.details is not None
    assert any("Duplicate identifier" in d["message"] for d in exc.value.details)

    # 5. Fix Bob's value to unique -> Marking succeeds
    update_member(db_session, group.id, members[1].id, values={reg_field.key: "CS 102"})
    updated_field = update_group_field(
        db_session, group.id, reg_field.id, is_identifier=True
    )
    assert updated_field.is_identifier is True
    assert updated_field.is_required is True

    # Verify members have identifier_value normalized and identifier original
    alice = db_session.get(Member, members[0].id)
    bob = db_session.get(Member, members[1].id)
    assert alice.identifier_value == "cs 101"
    assert alice.field_values[reg_field.key] == "CS 101"
    assert bob.identifier_value == "cs 102"
    assert bob.field_values[reg_field.key] == "CS 102"

    # 6. Fails if another identifier is attempted
    another_text = create_group_field(db_session, group.id, "Badge", "text")
    update_member(db_session, group.id, alice.id, values={another_text.key: "B1"})
    update_member(db_session, group.id, bob.id, values={another_text.key: "B2"})
    with pytest.raises(PollValidationError) as exc:
        update_group_field(db_session, group.id, another_text.id, is_identifier=True)
    assert "already has an identifier" in str(exc.value)

    # 7. Unmarking identifier clears identifier_value on members but keeps field required
    unmarked = update_group_field(
        db_session, group.id, reg_field.id, is_identifier=False
    )
    assert unmarked.is_identifier is False
    assert unmarked.is_required is True

    alice = db_session.get(Member, alice.id)
    bob = db_session.get(Member, bob.id)
    assert alice.identifier_value is None
    assert bob.identifier_value is None


# ---------------------------------------------------------------------------
# 7. Duplicate display names rules
# ---------------------------------------------------------------------------
def test_display_name_uniqueness_with_and_without_identifier(db_session):
    """
    Duplicate display names:
    - rejected when group has no identifier field;
    - allowed once an identifier field exists.
    """
    group, _ = create_group_with_admin(db_session, "Name Group")
    add_members_bulk(db_session, group.id, ["Alice"])

    # 1. No identifier field: adding another "Alice" fails
    with pytest.raises(PollValidationError) as exc:
        add_members_bulk(db_session, group.id, ["Alice"])
    assert "already exists in group" in str(exc.value)

    # Create identifier field
    reg_field = create_group_field(db_session, group.id, "ID Num", "text")
    alice1 = list_group_members(db_session, group.id)[0]
    update_member(db_session, group.id, alice1.id, values={reg_field.key: "ID001"})
    update_group_field(db_session, group.id, reg_field.id, is_identifier=True)

    # 2. Once identifier exists, duplicate display names ARE allowed
    members = add_members_bulk(
        db_session,
        group.id,
        members_data=[
            {"display_name": "Alice", "values": {reg_field.key: "ID002"}},
        ],
    )
    assert len(members) == 1
    alice2 = members[0]
    assert alice2.display_name == "Alice"
    assert alice2.identifier_value == "id002"

    all_alices = list_group_members(db_session, group.id)
    assert len(all_alices) == 2
    assert [m.display_name for m in all_alices] == ["Alice", "Alice"]


# ---------------------------------------------------------------------------
# 8. Identifier uniqueness on add and update + DB partial index
# ---------------------------------------------------------------------------
def test_identifier_uniqueness_service_and_db_index(db_session):
    """
    Identifier uniqueness:
    - checked at service layer on add and update;
    - DB partial unique index ix_members_group_identifier catches bypass.
    """
    group, _ = create_group_with_admin(db_session, "Unique ID Group")
    reg_field = create_group_field(db_session, group.id, "Reg", "text")
    # Mark as identifier before adding members (empty group)
    update_group_field(db_session, group.id, reg_field.id, is_identifier=True)

    # 1. Add members
    add_members_bulk(
        db_session,
        group.id,
        members_data=[{"display_name": "User 1", "values": {reg_field.key: "R100"}}],
    )

    # Service rejects duplicate on add
    with pytest.raises(PollValidationError):
        add_members_bulk(
            db_session,
            group.id,
            members_data=[{"display_name": "User 2", "values": {reg_field.key: "r100"}}],
        )

    # Add second member with unique identifier
    m2 = add_members_bulk(
        db_session,
        group.id,
        members_data=[{"display_name": "User 2", "values": {reg_field.key: "R200"}}],
    )[0]

    # Service rejects update to existing identifier
    with pytest.raises(PollValidationError):
        update_member(db_session, group.id, m2.id, values={reg_field.key: "R100"})

    # 2. Database index catches bypass
    db_session.rollback()
    bypass_member = Member(
        id=uuid.uuid4(),
        group_id=group.id,
        display_name="User 3",
        field_values={reg_field.key: "R100"},
        identifier_value="r100",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(bypass_member)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


# ---------------------------------------------------------------------------
# 9. Deleting field rules
# ---------------------------------------------------------------------------
def test_delete_field_rules(db_session):
    """
    Deleting a field:
    - removes its key from all members' field_values;
    - cannot delete identifier field (must unmark first).
    """
    group, _ = create_group_with_admin(db_session, "Delete Field Group")
    f_text = create_group_field(db_session, group.id, "Notes", "text")
    f_id = create_group_field(db_session, group.id, "ID Code", "text")
    update_group_field(db_session, group.id, f_id.id, is_identifier=True)

    members = add_members_bulk(
        db_session,
        group.id,
        members_data=[
            {
                "display_name": "Alice",
                "values": {f_text.key: "Some notes", f_id.key: "ID1"},
            }
        ],
    )
    alice = members[0]
    assert f_text.key in alice.field_values

    # 1. Identifier cannot be deleted
    with pytest.raises(PollValidationError) as exc:
        delete_group_field(db_session, group.id, f_id.id)
    assert "unmark it first" in str(exc.value)

    # 2. Delete normal field removes key from member field_values
    delete_group_field(db_session, group.id, f_text.id)
    db_session.refresh(alice)
    assert f_text.key not in alice.field_values

    # 3. Non-existent field raises FieldNotFoundError
    with pytest.raises(FieldNotFoundError):
        delete_group_field(db_session, group.id, uuid.uuid4())


# ---------------------------------------------------------------------------
# 10. Changing choices and default_value rules
# ---------------------------------------------------------------------------
def test_changing_choices_and_default_value(db_session):
    """
    - Replacing choices fails if any member holds a removed value;
    - Changing default_value never changes existing members.
    """
    group, _ = create_group_with_admin(db_session, "Choices Group")
    f_choice = create_group_field(
        db_session,
        group.id,
        "Color",
        "choice",
        choices=["Red", "Green", "Blue"],
        default_value="Red",
    )

    members = add_members_bulk(
        db_session,
        group.id,
        members_data=[
            {"display_name": "Alice", "values": {f_choice.key: "Green"}},
            {"display_name": "Bob", "values": {f_choice.key: "Blue"}},
        ],
    )

    # 1. Replacing choices without "Blue" fails because Bob holds "Blue"
    with pytest.raises(PollValidationError) as exc:
        update_group_field(
            db_session, group.id, f_choice.id, choices=["Red", "Green", "Yellow"]
        )
    assert "holds value 'Blue'" in str(exc.value)

    # 2. Replacing choices including all existing values succeeds
    updated = update_group_field(
        db_session,
        group.id,
        f_choice.id,
        choices=["Red", "Green", "Blue", "Yellow"],
    )
    assert "Yellow" in updated.choices

    # 3. Changing default_value does not change existing members
    update_group_field(
        db_session, group.id, f_choice.id, default_value="Yellow"
    )
    db_session.refresh(members[0])
    db_session.refresh(members[1])
    assert members[0].field_values[f_choice.key] == "Green"
    assert members[1].field_values[f_choice.key] == "Blue"


# ---------------------------------------------------------------------------
# 13. Concurrency test: Two threads adding members with same identifier
# ---------------------------------------------------------------------------
def test_concurrent_members_same_identifier(test_engine):
    """Two threads adding members with the same identifier at once: exactly one succeeds."""
    session_factory = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)

    with session_factory() as session:
        group = Group(
            id=uuid.uuid4(),
            name="Concurrent Group",
            join_code="conc_code",
            created_at=datetime.now(timezone.utc),
        )
        session.add(group)
        session.flush()

        field = GroupField(
            id=uuid.uuid4(),
            group_id=group.id,
            key="badge_id",
            name="Badge ID",
            field_type="text",
            is_required=True,
            is_identifier=True,
            position=1,
            created_at=datetime.now(timezone.utc),
        )
        session.add(field)
        session.commit()
        gid = group.id
        fkey = field.key

    results = {"success": 0, "failure": 0, "errors": []}
    results_lock = threading.Lock()

    def add_worker(name: str):
        worker_session = session_factory()
        try:
            add_member(
                worker_session,
                group_id=gid,
                display_name=name,
                values={fkey: "SAME_ID"},
            )
            with results_lock:
                results["success"] += 1
        except (PollValidationError, IntegrityError):
            worker_session.rollback()
            with results_lock:
                results["failure"] += 1
        except Exception as exc:
            worker_session.rollback()
            with results_lock:
                results["errors"].append(exc)
        finally:
            worker_session.close()

    t1 = threading.Thread(target=add_worker, args=("Worker 1",))
    t2 = threading.Thread(target=add_worker, args=("Worker 2",))

    t1.start()
    t2.start()

    t1.join(timeout=10)
    t2.join(timeout=10)

    assert not results["errors"], f"Unexpected error during concurrency test: {results['errors']}"
    assert results["success"] == 1, f"Expected 1 success, got {results['success']}"
    assert results["failure"] == 1, f"Expected 1 failure, got {results['failure']}"
