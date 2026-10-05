"""Polls service layer implementing all domain rules and operations."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
import uuid

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.errors import (
    GroupNotFoundError,
    MemberGroupMismatchError,
    MemberInactiveError,
    MemberNotFoundError,
    OptionNotFoundError,
    OptionPollMismatchError,
    PollClosedError,
    PollNotFoundError,
    PollValidationError,
)
from app.models import Group, GroupField, Member, Poll, PollOption, Vote, VoteHistory
from app.security import generate_join_code
from app.services.fields import validate_member_values_for_create

VALID_ROLES = frozenset({"target", "in_progress", "excused", "not_yet"})
VALID_COMPLETION_MODES = frozenset({"first", "last"})
VALID_POLL_STATUSES = frozenset({"open", "closed"})


def ensure_utc(dt: datetime | None) -> datetime | None:
    """Ensure a datetime is timezone-aware UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def resolve_uuid(val: uuid.UUID | str) -> uuid.UUID:
    """Resolve a UUID from either UUID or string."""
    if isinstance(val, uuid.UUID):
        return val
    return uuid.UUID(str(val))


@dataclass(frozen=True)
class PollOptionInput:
    """Input payload for a poll option."""

    label: str
    role: str


@dataclass
class AtTargetMember:
    """Member status entry for at_target category."""

    member: Member
    late: bool
    completed_at: datetime


@dataclass
class PollStatusResult:
    """Partitioned active member status lists for a poll."""

    at_target: list[AtTargetMember]
    excused: list[Member]
    behind_target: list[Member]
    not_voted: list[Member]


@dataclass
class MemberOptionHistory:
    """Historical selection details for a member and option."""

    option_id: uuid.UUID
    option_label: str
    first_selected_at: datetime
    last_selected_at: datetime
    is_selected: bool


# ---------------------------------------------------------------------------
# Group and Member Management
# ---------------------------------------------------------------------------


def create_group(
    session: Session,
    name: str,
    now: datetime | None = None,
) -> Group:
    """Create a new group."""
    if not name or not name.strip():
        raise PollValidationError("Group name cannot be empty.")

    current_time = ensure_utc(now) or datetime.now(timezone.utc)
    group = Group(
        id=uuid.uuid4(),
        name=name.strip(),
        join_code=generate_join_code(),
        admin_token_hash=None,
        require_claim_approval=False,
        created_at=current_time,
    )
    session.add(group)
    session.commit()
    session.refresh(group)
    return group


def add_member(
    session: Session,
    group_id: uuid.UUID | str,
    display_name: str,
    is_active: bool = True,
    now: datetime | None = None,
    values: dict[str, Any] | None = None,
) -> Member:
    """Add a new member to a group."""
    gid = resolve_uuid(group_id)

    # Concurrency lock
    group = session.scalar(
        select(Group).where(Group.id == gid).with_for_update()
    )
    if not group:
        raise GroupNotFoundError(f"Group {gid} not found.")

    if not display_name or not display_name.strip():
        raise PollValidationError("Member display_name cannot be empty.")
    clean_name = display_name.strip()

    fields = list(
        session.scalars(
            select(GroupField)
            .where(GroupField.group_id == gid)
            .order_by(GroupField.position)
        ).all()
    )
    id_field = next((f for f in fields if f.is_identifier), None)

    cleaned_vals, identifier_val = validate_member_values_for_create(fields, values)

    if id_field is not None:
        if identifier_val is not None:
            existing = session.scalar(
                select(Member).where(
                    Member.group_id == gid,
                    Member.identifier_value == identifier_val,
                )
            )
            if existing:
                raise PollValidationError(
                    f"Member with identifier '{identifier_val}' already exists."
                )
    else:
        existing = session.scalar(
            select(Member).where(
                Member.group_id == gid,
                Member.display_name == clean_name,
            )
        )
        if existing:
            raise PollValidationError(
                f"Member with name '{clean_name}' already exists in group."
            )

    current_time = ensure_utc(now) or datetime.now(timezone.utc)
    member = Member(
        id=uuid.uuid4(),
        group_id=gid,
        display_name=clean_name,
        is_active=is_active,
        field_values=cleaned_vals,
        identifier_value=identifier_val,
        created_at=current_time,
    )
    if id_field is not None:
        raw_id = cleaned_vals.get(id_field.key)
        member.identifier = str(raw_id) if raw_id is not None else None
    else:
        member.identifier = None

    session.add(member)
    session.commit()
    session.refresh(member)
    if id_field is not None:
        raw_id = (member.field_values or {}).get(id_field.key)
        member.identifier = str(raw_id) if raw_id is not None else None
    else:
        member.identifier = None
    return member


# ---------------------------------------------------------------------------
# Poll Creation and Management
# ---------------------------------------------------------------------------


def create_poll(
    session: Session,
    group_id: uuid.UUID | str,
    name: str,
    allow_multiple: bool,
    options: Sequence[PollOptionInput | dict[str, Any] | tuple[str, str]],
    description_raw: str | None = None,
    description_final: str | None = None,
    deadline: datetime | None = None,
    completion_time_mode: str = "last",
    now: datetime | None = None,
) -> Poll:
    """Create a new poll with validated options."""
    gid = resolve_uuid(group_id)
    group = session.get(Group, gid)
    if not group:
        raise GroupNotFoundError(f"Group {gid} not found.")

    if not name or not name.strip():
        raise PollValidationError("Poll name cannot be empty.")

    if len(options) < 2:
        raise PollValidationError("A poll must have at least 2 options.")

    if completion_time_mode not in VALID_COMPLETION_MODES:
        raise PollValidationError(
            f"Invalid completion_time_mode: '{completion_time_mode}'. Expected one of {list(VALID_COMPLETION_MODES)}."
        )

    # Convert options to PollOptionInput objects
    normalized_options: list[PollOptionInput] = []
    seen_labels: set[str] = set()
    has_target = False

    for opt in options:
        if isinstance(opt, PollOptionInput):
            label, role = opt.label, opt.role
        elif isinstance(opt, dict):
            label, role = opt["label"], opt["role"]
        elif isinstance(opt, (tuple, list)) and len(opt) == 2:
            label, role = opt[0], opt[1]
        else:
            raise PollValidationError(f"Invalid option specification: {opt}")

        label = str(label)
        role = str(role)

        if not label:
            raise PollValidationError("Poll option label cannot be empty.")

        if label in seen_labels:
            raise PollValidationError(
                f"Duplicate option label detected: '{label}'. Labels must be unique within a poll."
            )
        seen_labels.add(label)

        if role not in VALID_ROLES:
            raise PollValidationError(
                f"Invalid role: '{role}'. Expected one of {list(VALID_ROLES)}."
            )

        if role == "target":
            has_target = True

        normalized_options.append(PollOptionInput(label=label, role=role))

    if not has_target:
        raise PollValidationError(
            "A poll must have at least one option with role 'target'."
        )

    current_time = ensure_utc(now) or datetime.now(timezone.utc)
    deadline_utc = ensure_utc(deadline)

    poll = Poll(
        id=uuid.uuid4(),
        group_id=gid,
        name=name.strip(),
        description_raw=description_raw,
        description_final=description_final,
        status="open",
        allow_multiple=allow_multiple,
        deadline=deadline_utc,
        completion_time_mode=completion_time_mode,
        closed_at=None,
        created_at=current_time,
    )
    session.add(poll)
    session.flush()

    # Assign position in the order given (1-based index)
    for position, opt_input in enumerate(normalized_options, start=1):
        option = PollOption(
            id=uuid.uuid4(),
            poll_id=poll.id,
            label=opt_input.label,
            position=position,
            role=opt_input.role,
            created_at=current_time,
        )
        session.add(option)

    session.commit()
    session.refresh(poll)
    return poll


def close_poll(
    session: Session,
    poll_id: uuid.UUID | str,
    now: datetime | None = None,
) -> Poll:
    """Close an open poll. Closing an already closed poll is a no-op."""
    pid = resolve_uuid(poll_id)
    poll = session.get(Poll, pid)
    if not poll:
        raise PollNotFoundError(f"Poll {pid} not found.")

    if poll.status == "closed":
        return poll

    close_time = ensure_utc(now) or datetime.now(timezone.utc)
    poll.status = "closed"
    poll.closed_at = close_time
    session.commit()
    session.refresh(poll)
    return poll


# ---------------------------------------------------------------------------
# Voting Operations
# ---------------------------------------------------------------------------


def cast_vote(
    session: Session,
    poll_id: uuid.UUID | str,
    member_id: uuid.UUID | str,
    option_id: uuid.UUID | str,
    now: datetime | None = None,
) -> None:
    """Cast or switch a member's vote for an option in a poll."""
    pid = resolve_uuid(poll_id)
    mid = resolve_uuid(member_id)
    oid = resolve_uuid(option_id)

    poll = session.scalar(
        select(Poll).where(Poll.id == pid).with_for_update().execution_options(populate_existing=True)
    )
    if not poll:
        raise PollNotFoundError(f"Poll {pid} not found.")

    if poll.status == "closed":
        raise PollClosedError(f"Poll {pid} is closed. Cannot cast votes.")

    member = session.get(Member, mid)
    if not member:
        raise MemberNotFoundError(f"Member {mid} not found.")

    if member.group_id != poll.group_id:
        raise MemberGroupMismatchError(
            f"Member {mid} does not belong to poll's group {poll.group_id}."
        )

    if not member.is_active:
        raise MemberInactiveError(f"Member {mid} is inactive.")

    option = session.get(PollOption, oid)
    if not option:
        raise OptionNotFoundError(f"Option {oid} not found.")

    if option.poll_id != poll.id:
        raise OptionPollMismatchError(
            f"Option {oid} does not belong to poll {poll.id}."
        )

    current_time = ensure_utc(now) or datetime.now(timezone.utc)

    # Check if option is already currently selected by this member
    existing_selection = session.scalar(
        select(Vote).where(
            Vote.poll_id == pid,
            Vote.member_id == mid,
            Vote.option_id == oid,
        )
    )
    if existing_selection is not None:
        # Re-selecting an already selected option: do nothing (no timestamp change)
        return

    # If single-choice poll, delete member's other current selections in this poll
    if not poll.allow_multiple:
        session.execute(
            delete(Vote).where(
                Vote.poll_id == pid,
                Vote.member_id == mid,
            )
        )

    # Add new selection row
    new_vote = Vote(
        id=uuid.uuid4(),
        poll_id=pid,
        member_id=mid,
        option_id=oid,
        created_at=current_time,
    )
    session.add(new_vote)

    # Update vote_history for this (poll_id, member_id, option_id)
    history_entry = session.scalar(
        select(VoteHistory).where(
            VoteHistory.poll_id == pid,
            VoteHistory.member_id == mid,
            VoteHistory.option_id == oid,
        )
    )

    if history_entry is None:
        # Create history entry
        new_history = VoteHistory(
            id=uuid.uuid4(),
            poll_id=pid,
            member_id=mid,
            option_id=oid,
            first_selected_at=current_time,
            last_selected_at=current_time,
            created_at=current_time,
        )
        session.add(new_history)
    else:
        # Update only last_selected_at
        history_entry.last_selected_at = current_time

    session.commit()


def remove_vote(
    session: Session,
    poll_id: uuid.UUID | str,
    member_id: uuid.UUID | str,
    option_id: uuid.UUID | str | None = None,
    now: datetime | None = None,
) -> None:
    """Remove a specific selection or all selections for a member."""
    pid = resolve_uuid(poll_id)
    mid = resolve_uuid(member_id)

    poll = session.scalar(
        select(Poll).where(Poll.id == pid).with_for_update().execution_options(populate_existing=True)
    )
    if not poll:
        raise PollNotFoundError(f"Poll {pid} not found.")

    if poll.status == "closed":
        raise PollClosedError(f"Poll {pid} is closed. Cannot remove votes.")

    member = session.get(Member, mid)
    if not member:
        raise MemberNotFoundError(f"Member {mid} not found.")

    if member.group_id != poll.group_id:
        raise MemberGroupMismatchError(
            f"Member {mid} does not belong to poll's group {poll.group_id}."
        )

    if option_id is not None:
        oid = resolve_uuid(option_id)
        option = session.get(PollOption, oid)
        if not option:
            raise OptionNotFoundError(f"Option {oid} not found.")

        if option.poll_id != poll.id:
            raise OptionPollMismatchError(
                f"Option {oid} does not belong to poll {poll.id}."
            )

        # Remove only that selection
        session.execute(
            delete(Vote).where(
                Vote.poll_id == pid,
                Vote.member_id == mid,
                Vote.option_id == oid,
            )
        )
    else:
        # Remove all current selections in this poll
        session.execute(
            delete(Vote).where(
                Vote.poll_id == pid,
                Vote.member_id == mid,
            )
        )

    # vote_history is never touched
    session.commit()


# ---------------------------------------------------------------------------
# Status and Reporting Queries
# ---------------------------------------------------------------------------


def get_poll_status(
    session: Session,
    poll_id: uuid.UUID | str,
    now: datetime | None = None,
) -> PollStatusResult:
    """Calculate and return the 4 status categories for all active members in the poll's group."""
    pid = resolve_uuid(poll_id)
    poll = session.get(Poll, pid)
    if not poll:
        raise PollNotFoundError(f"Poll {pid} not found.")

    # Get all active members of the poll's group
    active_members = (
        session.scalars(
            select(Member)
            .where(
                Member.group_id == poll.group_id,
                Member.is_active.is_(True),
            )
            .order_by(Member.display_name)
        )
        .all()
    )

    # Fetch all current votes for this poll with option and history details
    votes = session.scalars(
        select(Vote).where(Vote.poll_id == pid)
    ).all()

    # Map member_id -> list of Vote objects
    member_votes: dict[uuid.UUID, list[Vote]] = {}
    for v in votes:
        member_votes.setdefault(v.member_id, []).append(v)

    # Fetch all options for this poll
    options_by_id = {
        opt.id: opt
        for opt in session.scalars(
            select(PollOption).where(PollOption.poll_id == pid)
        ).all()
    }

    # Fetch all history rows for this poll
    history_rows = session.scalars(
        select(VoteHistory).where(VoteHistory.poll_id == pid)
    ).all()
    history_by_key = {
        (h.member_id, h.option_id): h for h in history_rows
    }

    at_target: list[AtTargetMember] = []
    excused: list[Member] = []
    behind_target: list[Member] = []
    not_voted: list[Member] = []

    for member in active_members:
        cur_votes = member_votes.get(member.id, [])
        if not cur_votes:
            not_voted.append(member)
            continue

        selected_options = [
            options_by_id[v.option_id]
            for v in cur_votes
            if v.option_id in options_by_id
        ]
        target_options = [opt for opt in selected_options if opt.role == "target"]
        excused_options = [opt for opt in selected_options if opt.role == "excused"]
        behind_options = [
            opt for opt in selected_options if opt.role in ("in_progress", "not_yet")
        ]

        if target_options:
            # Rule 6 & 7: at_target
            # Calculate completed_at and late
            candidate_times: list[datetime] = []
            for opt in target_options:
                vh = history_by_key.get((member.id, opt.id))
                if vh is not None:
                    if poll.completion_time_mode == "first":
                        candidate_times.append(vh.first_selected_at)
                    else:
                        candidate_times.append(vh.last_selected_at)

            if not candidate_times:
                # Fallback to vote created_at if history record is missing
                candidate_times = [
                    v.created_at for v in cur_votes if v.option_id in {o.id for o in target_options}
                ]

            completed_at = min(candidate_times)
            late = (poll.deadline is not None) and (completed_at > poll.deadline)
            at_target.append(
                AtTargetMember(
                    member=member,
                    late=late,
                    completed_at=completed_at,
                )
            )
        elif excused_options:
            # Rule 6: excused
            excused.append(member)
        elif behind_options:
            # Rule 6: behind_target
            behind_target.append(member)
        else:
            not_voted.append(member)

    return PollStatusResult(
        at_target=at_target,
        excused=excused,
        behind_target=behind_target,
        not_voted=not_voted,
    )


def all_reached(
    session: Session,
    poll_id: uuid.UUID | str,
    now: datetime | None = None,
) -> bool:
    """Return True if every active member is at target or excused, and at least one is at target."""
    status = get_poll_status(session, poll_id, now=now)
    total_active_members = (
        len(status.at_target)
        + len(status.excused)
        + len(status.behind_target)
        + len(status.not_voted)
    )

    if total_active_members == 0:
        return False

    if len(status.at_target) == 0:
        return False

    if len(status.behind_target) > 0 or len(status.not_voted) > 0:
        return False

    return True


def get_member_history(
    session: Session,
    poll_id: uuid.UUID | str,
    member_id: uuid.UUID | str,
) -> list[MemberOptionHistory]:
    """Return chronological history of all options ever selected by a member in a poll."""
    pid = resolve_uuid(poll_id)
    mid = resolve_uuid(member_id)

    poll = session.get(Poll, pid)
    if not poll:
        raise PollNotFoundError(f"Poll {pid} not found.")

    member = session.get(Member, mid)
    if not member:
        raise MemberNotFoundError(f"Member {mid} not found.")

    # Current selections for this member in this poll
    current_selected_option_ids = set(
        session.scalars(
            select(Vote.option_id).where(
                Vote.poll_id == pid,
                Vote.member_id == mid,
            )
        ).all()
    )

    # History rows joined with options
    history_entries = (
        session.scalars(
            select(VoteHistory)
            .where(
                VoteHistory.poll_id == pid,
                VoteHistory.member_id == mid,
            )
            .order_by(VoteHistory.first_selected_at)
        )
        .all()
    )

    options_by_id = {
        opt.id: opt
        for opt in session.scalars(
            select(PollOption).where(PollOption.poll_id == pid)
        ).all()
    }

    result: list[MemberOptionHistory] = []
    for h in history_entries:
        opt = options_by_id.get(h.option_id)
        label = opt.label if opt else str(h.option_id)
        is_selected = h.option_id in current_selected_option_ids
        result.append(
            MemberOptionHistory(
                option_id=h.option_id,
                option_label=label,
                first_selected_at=h.first_selected_at,
                last_selected_at=h.last_selected_at,
                is_selected=is_selected,
            )
        )

    return result
