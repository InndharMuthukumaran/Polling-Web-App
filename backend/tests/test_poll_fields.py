"""Tests for Part R3: Poll columns, poll-only fields, answers, and results table (services & migration)."""

import csv
import io
from pathlib import Path
import uuid
import openpyxl
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.errors import (
    ClaimNotApprovedError,
    MemberGroupMismatchError,
    MemberInactiveError,
    PollClosedError,
    PollValidationError,
)
from app.models import Group, GroupField, Member, Poll, PollAnswer, PollField, PollIncludedField
from app.services.fields import (
    create_group_field,
    delete_group_field,
    update_group_field,
)
from app.services.identity import add_members_bulk, claim_member
from app.services.polls import (
    PollOptionInput,
    cast_vote,
    close_poll,
    create_group,
    create_poll,
    export_poll_results_csv,
    export_poll_results_xlsx,
    get_poll_results,
    save_poll_answers,
)


@pytest.fixture(autouse=True)
def clean_db(test_engine):
    """Clean all tables before and after each test."""
    with test_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    yield
    with test_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())


def test_migration_005_poll_fields_cycle(test_engine_and_url):
    """Test 1: Migration upgrade on empty database, downgrade one step and upgrade again."""
    engine, test_db_url = test_engine_and_url
    backend_dir = Path(__file__).resolve().parent.parent
    alembic_ini_path = backend_dir / "alembic.ini"

    alembic_cfg = Config(str(alembic_ini_path))
    alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", test_db_url)

    # 1. Downgrade one step to 004_claim_settings
    with engine.begin() as connection:
        alembic_cfg.attributes["connection"] = connection
        command.downgrade(alembic_cfg, "004_claim_settings")

    # 2. Upgrade again to head (005_poll_fields)
    with engine.begin() as connection:
        alembic_cfg.attributes["connection"] = connection
        command.upgrade(alembic_cfg, "head")

    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with session_factory() as session:
        group = create_group(session, "Migration Group")
        poll = create_poll(
            session,
            group_id=group.id,
            name="Migration Poll",
            allow_multiple=False,
            options=[
                PollOptionInput(label="Option 1", role="target"),
                PollOptionInput(label="Option 2", role="not_yet"),
            ],
        )
        assert poll.id is not None
        assert poll.included_fields == []
        assert poll.poll_fields == []


def test_create_poll_with_included_fields_and_poll_fields(test_engine):
    """Test 2: Creating a poll with included group fields and poll-only fields: column order, limits, duplicates."""
    session_factory = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)
    with session_factory() as session:
        group = create_group(session, "Engineering Group")
        id_field = create_group_field(
            session, group.id, name="RegNo", field_type="text", is_identifier=True
        )
        gf1 = create_group_field(session, group.id, name="Department", field_type="text")
        gf2 = create_group_field(session, group.id, name="Year", field_type="number")

        # Identifier field in included_field_ids must be ignored (not stored in poll_included_fields).
        # Duplicate gf1 ID must be ignored while preserving order.
        included_ids = [gf2.id, id_field.id, gf1.id, gf2.id]
        poll_fields_input = [
            {
                "name": "Preferred Location",
                "field_type": "choice",
                "choices": ["Bangalore", "Chennai"],
                "default_value": "Bangalore",
                "is_required": False,
            },
            {
                "name": "Expected CTC",
                "field_type": "number",
                "is_required": True,
            },
        ]

        poll = create_poll(
            session,
            group_id=group.id,
            name="Placement Poll",
            allow_multiple=False,
            options=[
                PollOptionInput(label="Placed", role="target"),
                PollOptionInput(label="Searching", role="in_progress"),
            ],
            included_field_ids=included_ids,
            poll_fields=poll_fields_input,
        )

        assert len(poll.included_fields) == 2
        assert poll.included_fields[0].field_id == gf2.id
        assert poll.included_fields[0].position == 1
        assert poll.included_fields[1].field_id == gf1.id
        assert poll.included_fields[1].position == 2

        assert len(poll.poll_fields) == 2
        assert poll.poll_fields[0].name == "Preferred Location"
        assert poll.poll_fields[0].key == "preferred_location"
        assert poll.poll_fields[0].position == 1
        assert poll.poll_fields[0].default_value == "Bangalore"
        assert poll.poll_fields[1].name == "Expected CTC"
        assert poll.poll_fields[1].key == "expected_ctc"
        assert poll.poll_fields[1].position == 2
        assert poll.poll_fields[1].is_required is True


def test_create_poll_validation_errors(test_engine):
    """Test 2 (cont): Another group's field, name clashes, 15-field limit, invalid choices/types."""
    session_factory = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)
    with session_factory() as session:
        group_a = create_group(session, "Group A")
        group_b = create_group(session, "Group B")

        id_field_a = create_group_field(
            session, group_a.id, name="StudentID", field_type="text", is_identifier=True
        )
        gf_a = create_group_field(session, group_a.id, name="City", field_type="text")
        gf_b = create_group_field(session, group_b.id, name="OtherField", field_type="text")

        base_opts = [
            PollOptionInput(label="Yes", role="target"),
            PollOptionInput(label="No", role="not_yet"),
        ]

        # 1. Another group's field ID is an error
        with pytest.raises(PollValidationError) as exc:
            create_poll(
                session,
                group_id=group_a.id,
                name="Poll Error 1",
                allow_multiple=False,
                options=base_opts,
                included_field_ids=[gf_b.id],
            )
        assert "does not belong to group" in str(exc.value)

        # 2. Poll field name clash with group identifier field (case-insensitive)
        with pytest.raises(PollValidationError) as exc:
            create_poll(
                session,
                group_id=group_a.id,
                name="Poll Error 2",
                allow_multiple=False,
                options=base_opts,
                poll_fields=[{"name": "studentid", "field_type": "text"}],
            )
        assert "conflicts with group identifier field" in str(exc.value)

        # 3. Poll field name clash with included group field (case-insensitive)
        with pytest.raises(PollValidationError) as exc:
            create_poll(
                session,
                group_id=group_a.id,
                name="Poll Error 3",
                allow_multiple=False,
                options=base_opts,
                included_field_ids=[gf_a.id],
                poll_fields=[{"name": "CITY", "field_type": "text"}],
            )
        assert "conflicts with included group field" in str(exc.value)

        # 4. Duplicate poll field name
        with pytest.raises(PollValidationError) as exc:
            create_poll(
                session,
                group_id=group_a.id,
                name="Poll Error 4",
                allow_multiple=False,
                options=base_opts,
                poll_fields=[
                    {"name": "Skill", "field_type": "text"},
                    {"name": "skill", "field_type": "text"},
                ],
            )
        assert "Duplicate poll field name" in str(exc.value)

        # 5. Over 15 poll fields limit
        sixteen_fields = [{"name": f"Question {i}", "field_type": "text"} for i in range(16)]
        with pytest.raises(PollValidationError) as exc:
            create_poll(
                session,
                group_id=group_a.id,
                name="Poll Error 5",
                allow_multiple=False,
                options=base_opts,
                poll_fields=sixteen_fields,
            )
        assert "at most 15" in str(exc.value)

        # 6. Invalid choices (less than 2 choices)
        with pytest.raises(PollValidationError) as exc:
            create_poll(
                session,
                group_id=group_a.id,
                name="Poll Error 6",
                allow_multiple=False,
                options=base_opts,
                poll_fields=[{"name": "Invalid Choice", "field_type": "choice", "choices": ["OnlyOne"]}],
            )
        assert "between 2 and 50 choices" in str(exc.value)


def test_deleting_included_group_field_and_unmarking_identifier(test_engine):
    """Test 3: Deleting an included group field removes it from poll columns; unmarking identifier removes first column; live read."""
    session_factory = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)
    with session_factory() as session:
        group = create_group(session, "Live Read Group")
        id_field = create_group_field(
            session, group.id, name="RollNo", field_type="text", is_identifier=True
        )
        extra_field = create_group_field(
            session, group.id, name="Score", field_type="number"
        )
        members = add_members_bulk(
            session,
            group.id,
            members_data=[
                {"display_name": "Bob", "values": {"rollno": "R001", "score": 85}}
            ],
        )
        bob = members[0]

        poll = create_poll(
            session,
            group_id=group.id,
            name="Score Poll",
            allow_multiple=False,
            options=[
                PollOptionInput(label="Target", role="target"),
                PollOptionInput(label="Pending", role="not_yet"),
            ],
            included_field_ids=[extra_field.id],
            poll_fields=[{"name": "Feedback", "field_type": "text"}],
        )

        results = get_poll_results(session, poll.id)
        assert len(results["columns"]) == 3
        assert results["columns"][0]["name"] == "RollNo"
        assert results["columns"][0]["is_identifier"] is True
        assert results["columns"][1]["name"] == "Score"
        assert results["columns"][2]["name"] == "Feedback"
        assert results["rows"][0]["group_values"]["score"] == 85

        # Live read test: change member's score
        bob.field_values = {**bob.field_values, "score": 95}
        session.commit()

        results_updated = get_poll_results(session, poll.id)
        assert results_updated["rows"][0]["group_values"]["score"] == 95

        # Delete included field -> disappears from poll results
        delete_group_field(session, group.id, extra_field.id)
        results_after_delete = get_poll_results(session, poll.id)
        col_names = [c["name"] for c in results_after_delete["columns"]]
        assert "Score" not in col_names
        assert len(results_after_delete["columns"]) == 2

        # Unmark identifier -> removes automatic first column
        update_group_field(session, group.id, id_field.id, is_identifier=False)
        results_after_unmark = get_poll_results(session, poll.id)
        col_names_unmarked = [c["name"] for c in results_after_unmark["columns"]]
        assert "RollNo" not in col_names_unmarked
        assert len(results_after_unmark["columns"]) == 1
        assert results_after_unmark["columns"][0]["name"] == "Feedback"


def test_answers_save_and_partial_update(test_engine):
    """Test 4: Valid save for each type, invalid values 422 with details, unknown key, partial updates, blanks."""
    session_factory = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)
    with session_factory() as session:
        group = create_group(session, "Answers Group")
        members = add_members_bulk(session, group.id, display_names=["Charlie", "Dave"])
        charlie = members[0]
        dave = members[1]
        charlie.claim_status = "approved"
        dave.claim_status = "approved"
        session.commit()

        poll = create_poll(
            session,
            group_id=group.id,
            name="Answers Poll",
            allow_multiple=False,
            options=[
                PollOptionInput(label="Goal", role="target"),
                PollOptionInput(label="Not yet", role="not_yet"),
            ],
            poll_fields=[
                {"name": "Bio", "field_type": "text"},
                {"name": "Age", "field_type": "number", "default_value": "18"},
                {"name": "Color", "field_type": "choice", "choices": ["Red", "Blue"]},
                {"name": "Profile", "field_type": "link"},
            ],
        )

        # 1. Valid save for each type
        ans = save_poll_answers(
            session,
            poll.id,
            charlie.id,
            {
                "bio": "Hello world",
                "age": 25,
                "color": "Red",
                "profile": "https://example.com/charlie",
            },
        )
        assert ans.values["bio"] == "Hello world"
        assert ans.values["age"] == 25
        assert ans.values["color"] == "Red"
        assert ans.values["profile"] == "https://example.com/charlie"

        # 2. Unknown key raises 422 with details
        with pytest.raises(PollValidationError) as exc:
            save_poll_answers(session, poll.id, charlie.id, {"unknown_key": "val"})
        assert exc.value.details == [{"field": "unknown_key", "message": "Unknown field key: 'unknown_key'."}]

        # 3. Invalid value raises 422 with field name in details
        with pytest.raises(PollValidationError) as exc:
            save_poll_answers(session, poll.id, charlie.id, {"color": "Green"})
        assert exc.value.details[0]["field"] == "Color"

        # 4. Partial update leaves other keys alone
        ans_updated = save_poll_answers(session, poll.id, charlie.id, {"bio": "Updated bio"})
        assert ans_updated.values["bio"] == "Updated bio"
        assert ans_updated.values["age"] == 25
        assert ans_updated.values["color"] == "Red"

        # 5. Blank resets to field default or removes key if no default
        ans_reset = save_poll_answers(session, poll.id, charlie.id, {"bio": "", "age": ""})
        assert "bio" not in ans_reset.values  # bio has no default -> removed
        assert ans_reset.values["age"] == 18  # age has default '18' -> reset to default

        # 6. Defaults are never applied to members who never answered
        results = get_poll_results(session, poll.id)
        dave_row = next(r for r in results["rows"] if r["member_id"] == dave.id)
        assert dave_row["answers"] == {}


def test_answers_guards_and_race_safety(test_engine):
    """Test 5 & 6: Closed poll, other group member, inactive/unapproved, and concurrency race condition."""
    session_factory = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)
    with session_factory() as session:
        group_a = create_group(session, "Guard Group A")
        group_b = create_group(session, "Guard Group B")

        # Member A approved
        mem_a = add_members_bulk(session, group_a.id, display_names=["Alice"])[0]
        mem_a.claim_status = "approved"
        # Member B approved in Group B
        mem_b = add_members_bulk(session, group_b.id, display_names=["Bob"])[0]
        mem_b.claim_status = "approved"
        # Unapproved member in Group A
        mem_unapproved = add_members_bulk(session, group_a.id, display_names=["Unapproved Member"])[0]
        # Inactive member in Group A
        mem_inactive = add_members_bulk(session, group_a.id, display_names=["Inactive Member"])[0]
        mem_inactive.claim_status = "approved"
        mem_inactive.is_active = False

        poll = create_poll(
            session,
            group_id=group_a.id,
            name="Guard Poll",
            allow_multiple=False,
            options=[
                PollOptionInput(label="T", role="target"),
                PollOptionInput(label="N", role="not_yet"),
            ],
            poll_fields=[{"name": "Notes", "field_type": "text"}],
        )

        poll_id = poll.id
        group_a_id = group_a.id
        mem_a_id = mem_a.id
        mem_b_id = mem_b.id
        mem_unapproved_id = mem_unapproved.id
        mem_inactive_id = mem_inactive.id
        session.commit()

    # Member of another group rejected
    with session_factory() as s:
        with pytest.raises(MemberGroupMismatchError):
            save_poll_answers(s, poll_id, mem_b_id, {"notes": "test"})

    # Unapproved member rejected
    with session_factory() as s:
        with pytest.raises(ClaimNotApprovedError):
            save_poll_answers(s, poll_id, mem_unapproved_id, {"notes": "test"})

    # Inactive member rejected
    with session_factory() as s:
        with pytest.raises(MemberInactiveError):
            save_poll_answers(s, poll_id, mem_inactive_id, {"notes": "test"})

    # Closed poll rejected
    with session_factory() as s:
        close_poll(s, poll_id)
        with pytest.raises(PollClosedError):
            save_poll_answers(s, poll_id, mem_a_id, {"notes": "test"})

    # Race safety test: session A loads poll while open, session B closes poll, session A saves answers
    with session_factory() as s_setup:
        race_poll = create_poll(
            s_setup,
            group_id=group_a_id,
            name="Race Answers Poll",
            allow_multiple=False,
            options=[
                PollOptionInput(label="T", role="target"),
                PollOptionInput(label="N", role="not_yet"),
            ],
            poll_fields=[{"name": "Ans", "field_type": "text"}],
        )
        race_poll_id = race_poll.id

    session_a = session_factory()
    poll_a = session_a.get(Poll, race_poll_id)
    assert poll_a.status == "open"

    # Concurrent session closes poll
    with session_factory() as session_b:
        close_poll(session_b, race_poll_id)

    # Session A calls save_poll_answers -> must be rejected with PollClosedError due to populate_existing
    with pytest.raises(PollClosedError):
        save_poll_answers(session_a, race_poll_id, mem_a_id, {"ans": "concurrency test"})
    session_a.close()


def test_answers_complete_and_voting_independence(test_engine):
    """Test 7: answers_complete logic; required poll-only fields do not block voting."""
    session_factory = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)
    with session_factory() as session:
        group = create_group(session, "Completeness Group")
        members = add_members_bulk(session, group.id, display_names=["User1", "User2", "User3"])
        for m in members:
            m.claim_status = "approved"
        session.commit()
        u1, u2, u3 = members[0], members[1], members[2]

        poll = create_poll(
            session,
            group_id=group.id,
            name="Completeness Poll",
            allow_multiple=False,
            options=[
                PollOptionInput(label="Finished", role="target"),
                PollOptionInput(label="Pending", role="not_yet"),
            ],
            poll_fields=[
                {"name": "MandatoryQ", "field_type": "text", "is_required": True},
                {"name": "OptionalQ", "field_type": "text", "is_required": False},
            ],
        )

        # U1 votes WITHOUT answering -> voting MUST succeed!
        cast_vote(session, poll.id, u1.id, poll.options[0].id)
        from app.models import Vote
        votes = list(session.scalars(select(Vote).where(Vote.poll_id == poll.id, Vote.member_id == u1.id)).all())
        assert len(votes) == 1 and votes[0].option_id == poll.options[0].id

        # U2 answers only optional question
        save_poll_answers(session, poll.id, u2.id, {"optionalq": "some info"})

        # U3 answers required question
        save_poll_answers(session, poll.id, u3.id, {"mandatoryq": "required answer"})

        results = get_poll_results(session, poll.id)
        u1_row = next(r for r in results["rows"] if r["member_id"] == u1.id)
        u2_row = next(r for r in results["rows"] if r["member_id"] == u2.id)
        u3_row = next(r for r in results["rows"] if r["member_id"] == u3.id)

        assert u1_row["status"] == "at_target"  # Voting succeeded
        assert u1_row["answers_complete"] is False  # Never answered
        assert u2_row["answers_complete"] is False  # Required question missing
        assert u3_row["answers_complete"] is True  # Required question present


def test_export_csv_and_xlsx_services(test_engine):
    """Test 10: CSV and Excel export formatting, BOM, formula protection, numeric types, safe filenames."""
    session_factory = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)
    with session_factory() as session:
        group = create_group(session, "Export Group")
        create_group_field(session, group.id, name="EmpID", field_type="text", is_identifier=True)
        members = add_members_bulk(
            session,
            group.id,
            members_data=[
                {"display_name": "Eve", "values": {"empid": "@eve_handle"}},
                {"display_name": "Frank", "values": {"empid": "E002"}},
            ],
        )
        for m in members:
            m.claim_status = "approved"
        session.commit()
        eve, frank = members[0], members[1]

        poll = create_poll(
            session,
            group_id=group.id,
            name="Quarterly: Survey / 2026?",
            allow_multiple=False,
            options=[
                PollOptionInput(label="Yes", role="target"),
                PollOptionInput(label="No", role="not_yet"),
            ],
            poll_fields=[
                {"name": "Formula Injection", "field_type": "text"},
                {"name": "Negative Number", "field_type": "number"},
            ],
        )

        # Save answers with formula triggers and negative numbers
        save_poll_answers(
            session,
            poll.id,
            eve.id,
            {"formula_injection": '=HYPERLINK("http://evil.com","click")', "negative_number": -42},
        )
        save_poll_answers(
            session,
            poll.id,
            frank.id,
            {"formula_injection": "+1234567890", "negative_number": 100},
        )

        results = get_poll_results(session, poll.id)

        # 1. CSV export
        csv_bytes, csv_filename = export_poll_results_csv(results)
        assert csv_filename == "Quarterly_Survey_2026.csv"
        assert csv_bytes.startswith(b"\xef\xbb\xbf")  # UTF-8 BOM

        csv_text = csv_bytes.decode("utf-8-sig")
        reader = list(csv.reader(io.StringIO(csv_text)))
        headers = reader[0]
        assert headers == [
            "Name",
            "EmpID",
            "Formula Injection",
            "Negative Number",
            "Status",
            "Selected options",
            "Late",
            "Completed at",
            "Answers complete",
        ]

        eve_row = next(r for r in reader[1:] if r[0] == "Eve")
        # Identifier starting with @ must have leading quote
        assert eve_row[1] == "'@eve_handle"
        # Formula cell starting with = must have leading quote
        assert eve_row[2] == '\'=HYPERLINK("http://evil.com","click")'
        # Negative number stays number
        assert eve_row[3] == "-42"

        frank_row = next(r for r in reader[1:] if r[0] == "Frank")
        # Text starting with + must have leading quote
        assert frank_row[2] == "'+1234567890"

        # 2. Excel export
        xlsx_bytes, xlsx_filename = export_poll_results_xlsx(results)
        assert xlsx_filename == "Quarterly_Survey_2026.xlsx"

        wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes))
        ws = wb.active
        # Check rows in Excel
        row2 = [ws.cell(row=2, column=c).value for c in range(1, len(headers) + 1)]
        row3 = [ws.cell(row=3, column=c).value for c in range(1, len(headers) + 1)]

        # Find Eve's row
        eve_excel = row2 if row2[0] == "Eve" else row3
        assert eve_excel[1] == "'@eve_handle"
        assert eve_excel[2] == '\'=HYPERLINK("http://evil.com","click")'
        # Negative number stays numeric in Excel
        assert eve_excel[3] == -42
        assert isinstance(eve_excel[3], (int, float))
