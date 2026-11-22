"""Tests for Part C1: Built-in Name field, computed display name format, and recomputation."""

from datetime import datetime, timezone
import io
import math
from pathlib import Path
import threading
import uuid

from alembic import command
from alembic.config import Config
import openpyxl
import pytest
import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.errors import PollValidationError
from app.limits import MAX_GROUP_FIELDS
from app.models import Group, GroupField, Member, Poll, PollOption, Vote, VoteHistory, PollAnswer
from app.services.fields import (
    compute_display_name,
    compute_public_display_name,
    create_group_field,
    delete_group_field,
    format_field_value_for_display,
    list_group_fields,
    update_group_field,
    validate_display_format,
)
from app.services.identity import (
    add_members_bulk,
    create_group_with_admin,
    export_roster_csv,
    export_roster_xlsx,
    list_group_members,
    update_group_settings,
    update_member,
)
from app.services.polls import (
    PollOptionInput,
    add_member,
    create_group,
    create_poll,
    export_poll_results_csv,
    export_poll_results_xlsx,
    get_poll_results,
    save_poll_answers,
)


# ---------------------------------------------------------------------------
# 1. Migration tests
# ---------------------------------------------------------------------------
def test_migration_006_display_format_cycle(test_engine_and_url):
    """
    Migration:
    - Upgrade on empty database;
    - Downgrade one step to 005_poll_fields and upgrade again;
    - Upgrade on database with existing groups, members, polls, votes, answers,
      and a custom field literally named 'Name':
      * members keep old display names in field_values['_name'],
      * built-in field created with name 'Member name' (since 'Name' was taken),
      * existing field positions shifted correctly,
      * nothing else is lost.
    """
    engine, test_db_url = test_engine_and_url
    backend_dir = Path(__file__).resolve().parent.parent
    alembic_ini_path = backend_dir / "alembic.ini"

    alembic_cfg = Config(str(alembic_ini_path))
    alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", test_db_url)

    try:
        # 1. Downgrade one step to 005_poll_fields
        with engine.begin() as connection:
            alembic_cfg.attributes["connection"] = connection
            command.downgrade(alembic_cfg, "005_poll_fields")

        # Insert a group, a custom field named 'Name', members, a poll, votes, answers under 005
        gid = uuid.uuid4()
        fid = uuid.uuid4()
        mid = uuid.uuid4()
        pid = uuid.uuid4()
        oid = uuid.uuid4()
        vid = uuid.uuid4()
        vhid = uuid.uuid4()
        aid = uuid.uuid4()

        now = datetime.now(timezone.utc)
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    "INSERT INTO groups (id, name, join_code, allow_name_list, require_claim_approval, created_at) "
                    "VALUES (:id, 'Pre-006 Group', 'migr006_code', false, false, :now)"
                ),
                {"id": gid, "now": now},
            )
            # Custom field literally named "Name" at position 1
            conn.execute(
                sa.text(
                    "INSERT INTO group_fields (id, group_id, key, name, field_type, is_required, position, created_at) "
                    "VALUES (:id, :gid, 'name', 'Name', 'text', true, 1, :now)"
                ),
                {"id": fid, "gid": gid, "now": now},
            )
            # Member with display_name and empty field_values
            conn.execute(
                sa.text(
                    "INSERT INTO members (id, group_id, display_name, claim_status, is_active, field_values, created_at) "
                    "VALUES (:id, :gid, 'Asha K', 'unclaimed', true, '{}', :now)"
                ),
                {"id": mid, "gid": gid, "now": now},
            )
            # Poll
            conn.execute(
                sa.text(
                    "INSERT INTO polls (id, group_id, name, allow_multiple, status, completion_time_mode, created_at) "
                    "VALUES (:id, :gid, 'Pre-006 Poll', false, 'open', 'last', :now)"
                ),
                {"id": pid, "gid": gid, "now": now},
            )
            # Poll Option
            conn.execute(
                sa.text(
                    "INSERT INTO poll_options (id, poll_id, label, role, position, created_at) "
                    "VALUES (:id, :pid, 'Option 1', 'target', 1, :now)"
                ),
                {"id": oid, "pid": pid, "now": now},
            )
            # Current Vote
            conn.execute(
                sa.text(
                    "INSERT INTO votes (id, poll_id, member_id, option_id, created_at) "
                    "VALUES (:id, :pid, :mid, :oid, :now)"
                ),
                {"id": vid, "pid": pid, "mid": mid, "oid": oid, "now": now},
            )
            # Vote History
            conn.execute(
                sa.text(
                    "INSERT INTO vote_history (id, poll_id, member_id, option_id, first_selected_at, last_selected_at, created_at) "
                    "VALUES (:id, :pid, :mid, :oid, :now, :now, :now)"
                ),
                {"id": vhid, "pid": pid, "mid": mid, "oid": oid, "now": now},
            )
            # Poll Answer
            conn.execute(
                sa.text(
                    "INSERT INTO poll_answers (id, poll_id, member_id, values, updated_at) "
                    "VALUES (:id, :pid, :mid, '{}', :now)"
                ),
                {"id": aid, "pid": pid, "mid": mid, "now": now},
            )

        # 2. Upgrade to head (006_display_format)
        with engine.begin() as connection:
            alembic_cfg.attributes["connection"] = connection
            command.upgrade(alembic_cfg, "head")

        session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
        with session_factory() as session:
            group = session.get(Group, gid)
            assert group is not None
            assert group.display_format == {"parts": ["_name"], "separator": " - "}

            fields = list(
                session.scalars(
                    select(GroupField)
                    .where(GroupField.group_id == gid)
                    .order_by(GroupField.position)
                ).all()
            )
            # There should be 2 fields now: built-in field at pos 1, custom field shifted to pos 2
            assert len(fields) == 2
            builtin = fields[0]
            custom = fields[1]

            assert builtin.key == "_name"
            assert builtin.is_builtin is True
            assert builtin.position == 1
            # Custom field was literally named "Name", so built-in field must be named "Member name"
            assert builtin.name == "Member name"

            assert custom.id == fid
            assert custom.key == "name"
            assert custom.name == "Name"
            assert custom.is_builtin is False
            assert custom.position == 2

            # Member check
            member = session.get(Member, mid)
            assert member is not None
            assert member.display_name == "Asha K"
            assert member.field_values.get("_name") == "Asha K"

            # Votes and answers survived
            assert session.get(Vote, vid) is not None
            assert session.get(VoteHistory, vhid) is not None
            assert session.get(PollAnswer, aid) is not None

            # Clean up
            session.delete(session.get(PollAnswer, aid))
            session.delete(session.get(Vote, vid))
            session.delete(session.get(VoteHistory, vhid))
            session.delete(session.get(PollOption, oid))
            session.delete(session.get(Poll, pid))
            session.delete(member)
            session.delete(custom)
            session.delete(builtin)
            session.delete(group)
            session.commit()

        # 3. Test downgrade one step and upgrade back
        with engine.begin() as connection:
            alembic_cfg.attributes["connection"] = connection
            command.downgrade(alembic_cfg, "005_poll_fields")
            command.upgrade(alembic_cfg, "head")
    finally:
        # Guarantee test database is left at head
        with engine.begin() as connection:
            alembic_cfg.attributes["connection"] = connection
            command.upgrade(alembic_cfg, "head")


# ---------------------------------------------------------------------------
# 2. Built-in Name field and default format
# ---------------------------------------------------------------------------
def test_new_group_built_in_field_and_default_format(db_session):
    """
    New group has built-in Name field (position 1, key _name, is_builtin True)
    and default display_format {"parts": ["_name"], "separator": " - "}.
    Built-in field cannot be deleted, cannot be identifier, can be renamed,
    and does not count toward MAX_GROUP_FIELDS (100 custom fields still allowed).
    """
    group, _ = create_group_with_admin(db_session, "Builtin Test Group")
    assert group.display_format == {"parts": ["_name"], "separator": " - "}

    fields = list_group_fields(db_session, group.id)
    assert len(fields) == 1
    bf = fields[0]
    assert bf.key == "_name"
    assert bf.name == "Name"
    assert bf.is_builtin is True
    assert bf.position == 1
    assert bf.is_required is True
    assert bf.is_identifier is False

    # Cannot delete built-in field
    with pytest.raises(PollValidationError) as exc:
        delete_group_field(db_session, group.id, bf.id)
    assert "The Name field cannot be deleted." in str(exc.value)

    # Cannot be identifier
    with pytest.raises(PollValidationError) as exc:
        update_group_field(db_session, group.id, bf.id, is_identifier=True)
    assert "The Name field cannot be the identifier." in str(exc.value)

    # Can be renamed
    renamed_f = update_group_field(db_session, group.id, bf.id, name="Full Name")
    assert renamed_f.name == "Full Name"
    assert renamed_f.key == "_name"

    # Add 99 custom fields in bulk to avoid excessive network roundtrips
    db_session.add_all([
        GroupField(
            group_id=group.id,
            name=f"Custom_{i}",
            field_type="text",
            position=i + 2,
            key=f"custom_{i}",
            is_builtin=False,
            is_required=False,
            is_identifier=False,
        )
        for i in range(MAX_GROUP_FIELDS - 1)
    ])
    db_session.commit()

    # 100th custom field via service -> succeeds
    create_group_field(db_session, group.id, "Custom_99", "text")

    all_fields = list_group_fields(db_session, group.id)
    custom_fields = [f for f in all_fields if not f.is_builtin]
    assert len(custom_fields) == MAX_GROUP_FIELDS

    # 101st custom field fails
    with pytest.raises(PollValidationError) as exc:
        create_group_field(db_session, group.id, "Overflow", "text")
    assert f"at most {MAX_GROUP_FIELDS} fields" in str(exc.value)


# ---------------------------------------------------------------------------
# 3. compute_display_name calculation rules
# ---------------------------------------------------------------------------
def test_compute_display_name_rules():
    """
    compute_display_name:
    - single part,
    - several parts with separator,
    - blank values skipped together with their separator,
    - numbers without .0,
    - empty separator,
    - length limit (255 chars),
    - empty result refused.
    """
    fmt = {"parts": ["_name"], "separator": " - "}
    f_map = {
        "_name": GroupField(key="_name", name="Name", field_type="text"),
        "reg_no": GroupField(key="reg_no", name="Register No", field_type="text"),
        "score": GroupField(key="score", name="Score", field_type="number"),
        "ratio": GroupField(key="ratio", name="Ratio", field_type="number"),
        "tag": GroupField(key="tag", name="Tag", field_type="text"),
    }

    # 1. Single part
    res = compute_display_name(fmt, {"_name": "Alice"}, f_map)
    assert res == "Alice"

    # 2. Several parts with separator
    fmt2 = {"parts": ["_name", "reg_no"], "separator": " - "}
    res2 = compute_display_name(fmt2, {"_name": "Asha K", "reg_no": "21001"}, f_map)
    assert res2 == "Asha K - 21001"

    # 3. Blank values skipped together with their separator
    fmt3 = {"parts": ["tag", "_name", "reg_no"], "separator": " | "}
    # tag is blank
    res3 = compute_display_name(fmt3, {"tag": "", "_name": "Bob", "reg_no": "102"}, f_map)
    assert res3 == "Bob | 102"
    # middle is blank
    res3b = compute_display_name(fmt3, {"tag": "Lead", "_name": "   ", "reg_no": "102"}, f_map)
    assert res3b == "Lead | 102"
    # end is blank
    res3c = compute_display_name(fmt3, {"tag": "Lead", "_name": "Bob", "reg_no": None}, f_map)
    assert res3c == "Lead | Bob"

    # 4. Numbers without .0
    fmt_num = {"parts": ["_name", "score", "ratio"], "separator": " / "}
    res_num = compute_display_name(
        fmt_num,
        {"_name": "Charlie", "score": 100.0, "ratio": 3.14},
        f_map,
    )
    assert res_num == "Charlie / 100 / 3.14"

    # Integer 42
    res_num2 = compute_display_name(
        {"parts": ["score"], "separator": " - "},
        {"score": 42},
        f_map,
    )
    assert res_num2 == "42"

    # 5. Empty separator
    fmt_empty_sep = {"parts": ["_name", "reg_no"], "separator": ""}
    res_empty_sep = compute_display_name(
        fmt_empty_sep,
        {"_name": "Alice", "reg_no": "99"},
        f_map,
    )
    assert res_empty_sep == "Alice99"

    # 6. Length limit > 255 chars refused
    long_val = "x" * 260
    with pytest.raises(PollValidationError) as exc:
        compute_display_name(fmt, {"_name": long_val}, f_map)
    assert "255 characters" in str(exc.value)

    # 7. Empty result refused
    with pytest.raises(PollValidationError) as exc:
        compute_display_name(fmt2, {"_name": "  ", "reg_no": ""}, f_map)
    assert "Display name is empty. Fill in: Name, Register No." in str(exc.value)


# ---------------------------------------------------------------------------
# 4. Changing format and recomputing members
# ---------------------------------------------------------------------------
def test_changing_format_recomputes_members_and_validations(db_session):
    """
    Changing format recomputes every member's display_name;
    invalid format (unknown field, repeated field, 6 parts, overlong separator) refused;
    empty computed label refused with details and changes nothing;
    duplicate label in group without identifier refused with details;
    duplicate label in group WITH identifier allowed.
    """
    group, _ = create_group_with_admin(db_session, "Recompute Format Group")
    f_reg = create_group_field(db_session, group.id, "Register No", "text")
    f_dept = create_group_field(db_session, group.id, "Dept", "text")

    # Add members
    add_members_bulk(
        db_session,
        group.id,
        members_data=[
            {"display_name": "Alice", "values": {f_reg.key: "101", f_dept.key: "CS"}},
            {"display_name": "Bob", "values": {f_reg.key: "102", f_dept.key: "EE"}},
        ],
    )

    # 1. Update format: parts = [_name, reg_no], sep = " - "
    new_fmt = {"parts": ["_name", f_reg.key], "separator": " - "}
    updated_g = update_group_settings(db_session, group.id, display_format=new_fmt)
    assert updated_g.display_format == new_fmt

    members = list_group_members(db_session, group.id)
    names = {m.field_values["_name"]: m.display_name for m in members}
    assert names["Alice"] == "Alice - 101"
    assert names["Bob"] == "Bob - 102"

    # 2. Refuse invalid formats
    # Unknown field
    with pytest.raises(PollValidationError) as exc:
        update_group_settings(db_session, group.id, display_format={"parts": ["nonexistent"], "separator": " - "})
    assert "Unknown field in display format" in str(exc.value)

    # Repeated field
    with pytest.raises(PollValidationError) as exc:
        update_group_settings(db_session, group.id, display_format={"parts": ["_name", "_name"], "separator": " - "})
    assert "repeated fields" in str(exc.value)

    # 6 parts
    with pytest.raises(PollValidationError) as exc:
        update_group_settings(
            db_session,
            group.id,
            display_format={"parts": ["_name", f_reg.key, f_dept.key, "f4", "f5", "f6"], "separator": " - "},
        )
    assert "between 1 and 5 fields" in str(exc.value)

    # Overlong separator
    with pytest.raises(PollValidationError) as exc:
        update_group_settings(
            db_session,
            group.id,
            display_format={"parts": ["_name"], "separator": "12345678901"},
        )
    assert "10 characters" in str(exc.value)

    # 3. Format leaving member with empty label refused with details and changes nothing
    # Add member with no Dept value
    add_members_bulk(
        db_session,
        group.id,
        members_data=[{"display_name": "EmptyDept", "values": {f_reg.key: "103", f_dept.key: ""}}],
    )
    with pytest.raises(PollValidationError) as exc:
        update_group_settings(
            db_session,
            group.id,
            display_format={"parts": [f_dept.key], "separator": " - "},
        )
    assert "Cannot update display format: 1 member(s)" in str(exc.value)
    assert exc.value.details is not None
    assert "Display name is empty" in exc.value.details[0]["message"]
    # Group format unchanged
    assert group.display_format == new_fmt

    # 4. Duplicate label in group without identifier refused with details
    # Add member whose Register No will clash with Alice
    add_members_bulk(
        db_session,
        group.id,
        members_data=[{"display_name": "AliceClone", "values": {f_reg.key: "101", f_dept.key: "ME"}}],
    )
    with pytest.raises(PollValidationError) as exc:
        update_group_settings(
            db_session,
            group.id,
            display_format={"parts": [f_reg.key], "separator": " - "},
        )
    assert "Cannot update display format: 1 member(s)" in str(exc.value)
    assert exc.value.details is not None
    assert "Duplicate display name" in exc.value.details[0]["message"]

    # 5. With identifier field, duplicate display names are allowed!
    empty_m = next(m for m in list_group_members(db_session, group.id) if m.field_values["_name"] == "EmptyDept")
    update_member(db_session, group.id, empty_m.id, values={"_name": "EmptyDept", f_reg.key: "103", f_dept.key: "CE"})
    update_group_field(db_session, group.id, f_dept.id, is_identifier=True)
    updated_g2 = update_group_settings(
        db_session,
        group.id,
        display_format={"parts": [f_reg.key], "separator": " - "},
    )
    assert updated_g2.display_format == {"parts": [f_reg.key], "separator": " - "}


# ---------------------------------------------------------------------------
# 5. Member create and update with display_name
# ---------------------------------------------------------------------------
def test_member_add_and_update_display_name_rules(db_session):
    """
    display_name shorthand works and sets field_values['_name'];
    {display_name, values} works;
    display name follows later value changes;
    empty computed label gives row-level error;
    uniqueness applies without identifier and not with one.
    """
    group, _ = create_group_with_admin(db_session, "Member Shorthand Group")
    f_reg = create_group_field(db_session, group.id, "Reg No", "text")

    # Format: [Name, Reg No]
    update_group_settings(
        db_session,
        group.id,
        display_format={"parts": ["_name", f_reg.key], "separator": " # "},
    )

    # 1. display_name shorthand sets _name
    members = add_members_bulk(
        db_session,
        group.id,
        display_names=["Alice", "Bob"],
    )
    assert members[0].field_values["_name"] == "Alice"
    assert members[0].display_name == "Alice"  # Reg No is blank, skipped with separator!

    # 2. {display_name, values} with values['_name'] taking precedence
    m3_list = add_members_bulk(
        db_session,
        group.id,
        members_data=[
            {"display_name": "Ignored", "values": {"_name": "Charlie", f_reg.key: "900"}},
        ],
    )
    assert m3_list[0].display_name == "Charlie # 900"
    assert m3_list[0].field_values["_name"] == "Charlie"

    # 3. Later value update recomputes display name
    updated_m = update_member(
        db_session,
        group.id,
        m3_list[0].id,
        values={"_name": "Charles", f_reg.key: "901"},
    )
    assert updated_m.display_name == "Charles # 901"

    # 4. Empty computed label gives row-level error text
    with pytest.raises(PollValidationError) as exc:
        add_members_bulk(
            db_session,
            group.id,
            members_data=[{"display_name": "  ", "values": {"_name": "", f_reg.key: ""}}],
        )
    assert "Display name is empty. Fill in: Name, Reg No." in str(exc.value)
    db_session.rollback()

    # 5. Uniqueness applies without identifier
    with pytest.raises(PollValidationError) as exc:
        add_members_bulk(
            db_session,
            group.id,
            members_data=[{"display_name": "Alice"}],
        )
    assert "already exists in group" in str(exc.value)
    db_session.rollback()

    # 6. Uniqueness NOT applied with identifier
    update_member(db_session, group.id, members[0].id, values={"_name": "Alice", f_reg.key: "101"})
    update_member(db_session, group.id, members[1].id, values={"_name": "Bob", f_reg.key: "102"})
    update_group_field(db_session, group.id, f_reg.id, is_identifier=True)

    # Set format to only [_name] so both members end up with display_name="Alice"
    update_group_settings(db_session, group.id, display_format={"parts": ["_name"], "separator": " - "})
    m_dup = add_members_bulk(
        db_session,
        group.id,
        members_data=[{"display_name": "Alice", "values": {"_name": "Alice", f_reg.key: "103"}}],
    )
    assert len(m_dup) == 1
    assert m_dup[0].display_name == "Alice"


# ---------------------------------------------------------------------------
# 6. Field deletion rules with display format
# ---------------------------------------------------------------------------
def test_field_in_format_cannot_be_deleted(db_session):
    """
    A field in display_format cannot be deleted (422: 'Remove it from the display name first.').
    After removing it from the format, it can be deleted.
    """
    group, _ = create_group_with_admin(db_session, "Field Delete Rule Group")
    f = create_group_field(db_session, group.id, "Tag", "text")

    # Put Tag in format
    update_group_settings(
        db_session,
        group.id,
        display_format={"parts": ["_name", f.key], "separator": " - "},
    )

    # Refuse delete
    with pytest.raises(PollValidationError) as exc:
        delete_group_field(db_session, group.id, f.id)
    assert "Remove it from the display name first." in str(exc.value)

    # Remove from format
    update_group_settings(
        db_session,
        group.id,
        display_format={"parts": ["_name"], "separator": " - "},
    )

    # Now deletion succeeds
    delete_group_field(db_session, group.id, f.id)
    assert len([fld for fld in list_group_fields(db_session, group.id) if not fld.is_builtin]) == 0


# ---------------------------------------------------------------------------
# 7. Public label computation and join masking
# ---------------------------------------------------------------------------
def test_public_label_masking(db_session):
    """
    Public label:
    - With identifier in format, masked identifier replaces identifier part (e.g. •••001).
    - With identifier NOT in format, public label equals display name.
    """
    group, _ = create_group_with_admin(db_session, "Public Label Group")
    f_id = create_group_field(db_session, group.id, "StudentID", "text", is_identifier=True)
    fields = list_group_fields(db_session, group.id)

    # 1. Identifier in format: [_name, StudentID]
    fmt1 = {"parts": ["_name", f_id.key], "separator": " - "}
    member_vals = {"_name": "Diana Prince", f_id.key: "WONDER123"}
    pub_name = compute_public_display_name(fmt1, member_vals, fields, f_id.key)
    # Masking rule for 'WONDER123' (len 9 >= 4): keeps last 3 chars -> •••123
    assert pub_name == "Diana Prince - •••123"

    # Full display name has unmasked identifier
    full_name = compute_display_name(fmt1, member_vals, {f.key: f for f in fields})
    assert full_name == "Diana Prince - WONDER123"

    # 2. Identifier NOT in format: [_name]
    fmt2 = {"parts": ["_name"], "separator": " - "}
    pub_name2 = compute_public_display_name(fmt2, member_vals, fields, f_id.key)
    assert pub_name2 == "Diana Prince"


# ---------------------------------------------------------------------------
# 8. Making built-in field optional rules
# ---------------------------------------------------------------------------
def test_making_builtin_field_optional_rules(db_session):
    """
    Making built-in field optional is refused when display format depends on it
    and some member has no value for it.
    """
    group, _ = create_group_with_admin(db_session, "Optional Builtin Group")
    bf = next(f for f in list_group_fields(db_session, group.id) if f.is_builtin)
    f_other = create_group_field(db_session, group.id, "Other", "text")

    # Add member with empty _name
    # Temporarily switch format to Other so member can be added without _name
    update_group_settings(db_session, group.id, display_format={"parts": [f_other.key], "separator": " - "})
    update_group_field(db_session, group.id, bf.id, is_required=False)

    m = add_members_bulk(
        db_session,
        group.id,
        members_data=[{"display_name": "TagOnly", "values": {"_name": "", f_other.key: "TagOnly"}}],
    )

    # Switch format back to [_name, f_other]
    # This works because f_other is present
    update_group_settings(db_session, group.id, display_format={"parts": ["_name", f_other.key], "separator": " - "})

    # Now, trying to update bf with is_required=False while format has _name and m has empty _name
    with pytest.raises(PollValidationError) as exc:
        update_group_field(db_session, group.id, bf.id, is_required=False)
    assert "Cannot make field 'Name' optional" in str(exc.value)


# ---------------------------------------------------------------------------
# 9. Concurrency: group-row lock serializes format updates
# ---------------------------------------------------------------------------
def test_concurrency_format_updates(test_engine):
    """Updating a group's display format locks the group row so concurrent updates serialize."""
    session_factory = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)
    with session_factory() as session:
        group, _ = create_group_with_admin(session, "Concurrent Group")
        f1 = create_group_field(session, group.id, "F1", "text")
        f2 = create_group_field(session, group.id, "F2", "text")
        gid = group.id
        f1_key = f1.key
        f2_key = f2.key

    results = []
    lock = threading.Lock()

    def run_update(parts, sep):
        with session_factory() as s:
            try:
                update_group_settings(s, gid, display_format={"parts": parts, "separator": sep})
                with lock:
                    results.append("success")
            except Exception as e:
                with lock:
                    results.append(str(e))

    t1 = threading.Thread(target=run_update, args=(["_name", f1_key], " | "))
    t2 = threading.Thread(target=run_update, args=(["_name", f2_key], " :: "))

    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert results == ["success", "success"]
    with session_factory() as session:
        final_group = session.get(Group, gid)
        # One of the two formats won cleanly
        assert final_group.display_format in (
            {"parts": ["_name", f1_key], "separator": " | "},
            {"parts": ["_name", f2_key], "separator": " :: "},
        )
        session.delete(final_group)
        session.commit()
