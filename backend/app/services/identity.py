"""Identity service layer implementing group creation, admin/member tokens, and claim management."""

from datetime import datetime, timezone
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

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
from app.security import (
    generate_join_code,
    generate_token,
    hash_token,
    verify_token_hash,
)


def ensure_utc(dt: datetime | None) -> datetime | None:
    """Ensure a datetime is timezone-aware UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def resolve_uuid(val: uuid.UUID | str) -> uuid.UUID:
    """Resolve a UUID from either UUID or string representation."""
    if isinstance(val, uuid.UUID):
        return val
    return uuid.UUID(str(val))


def create_group_with_admin(
    session: Session,
    name: str,
    now: datetime | None = None,
) -> tuple[Group, str]:
    """Create a new group with a join code and admin token.

    Returns the created Group and the plain, unhashed admin token.
    """
    if not name or not name.strip():
        raise PollValidationError("Group name cannot be empty.")

    current_time = ensure_utc(now) or datetime.now(timezone.utc)
    admin_token = generate_token()
    join_code = generate_join_code()

    group = Group(
        id=uuid.uuid4(),
        name=name.strip(),
        join_code=join_code,
        admin_token_hash=hash_token(admin_token),
        require_claim_approval=False,
        created_at=current_time,
    )
    session.add(group)
    session.commit()
    session.refresh(group)
    return group, admin_token


def authenticate_admin(
    session: Session,
    group_id: uuid.UUID | str,
    admin_token: str,
) -> Group:
    """Authenticate an admin token against a group.

    Raises GroupNotFoundError if group does not exist.
    Raises InvalidTokenError if token is empty, wrong, or group lacks an admin token.
    """
    gid = resolve_uuid(group_id)
    group = session.get(Group, gid)
    if not group:
        raise GroupNotFoundError(f"Group {gid} not found.")

    if not admin_token or not isinstance(admin_token, str) or not admin_token.strip():
        raise InvalidTokenError("Admin token cannot be empty.")

    if not group.admin_token_hash:
        raise InvalidTokenError("Group has no admin token configured.")

    if not verify_token_hash(admin_token.strip(), group.admin_token_hash):
        raise InvalidTokenError("Invalid admin token.")

    return group


def update_group_settings(
    session: Session,
    group_id: uuid.UUID | str,
    require_claim_approval: bool,
) -> Group:
    """Update settings for a group."""
    gid = resolve_uuid(group_id)
    group = session.get(Group, gid)
    if not group:
        raise GroupNotFoundError(f"Group {gid} not found.")

    group.require_claim_approval = bool(require_claim_approval)
    session.commit()
    session.refresh(group)
    return group


def add_members_bulk(
    session: Session,
    group_id: uuid.UUID | str,
    display_names: list[str],
) -> list[Member]:
    """Bulk-add members to a group. All-or-nothing validation."""
    gid = resolve_uuid(group_id)
    group = session.get(Group, gid)
    if not group:
        raise GroupNotFoundError(f"Group {gid} not found.")

    trimmed_names: list[str] = []
    seen_in_batch: set[str] = set()

    for name in display_names:
        if not isinstance(name, str) or not name.strip():
            raise PollValidationError("Member display_name cannot be blank.")
        t = name.strip()
        if t in seen_in_batch:
            raise PollValidationError(f"Duplicate display_name in batch: '{t}'.")
        seen_in_batch.add(t)
        trimmed_names.append(t)

    # Check against existing members in the group
    existing_members = session.scalars(
        select(Member.display_name).where(Member.group_id == gid)
    ).all()
    existing_names_set = set(existing_members)

    for t in trimmed_names:
        if t in existing_names_set:
            raise PollValidationError(f"Member with name '{t}' already exists in group.")

    current_time = datetime.now(timezone.utc)
    new_members: list[Member] = []
    for t in trimmed_names:
        m = Member(
            id=uuid.uuid4(),
            group_id=gid,
            display_name=t,
            is_active=True,
            claim_status="unclaimed",
            member_token_hash=None,
            claimed_at=None,
            created_at=current_time,
        )
        session.add(m)
        new_members.append(m)

    session.commit()
    for m in new_members:
        session.refresh(m)
    return new_members


def update_member(
    session: Session,
    group_id: uuid.UUID | str,
    member_id: uuid.UUID | str,
    display_name: str | None = None,
    is_active: bool | None = None,
) -> Member:
    """Update member display name or active status."""
    gid = resolve_uuid(group_id)
    mid = resolve_uuid(member_id)

    member = session.get(Member, mid)
    if not member:
        raise MemberNotFoundError(f"Member {mid} not found.")

    if member.group_id != gid:
        raise PermissionDeniedError(f"Member {mid} does not belong to group {gid}.")

    if display_name is not None:
        if not isinstance(display_name, str) or not display_name.strip():
            raise PollValidationError("display_name cannot be blank.")
        trimmed = display_name.strip()
        if trimmed != member.display_name:
            # Check uniqueness within the group
            existing = session.scalar(
                select(Member).where(
                    Member.group_id == gid,
                    Member.display_name == trimmed,
                    Member.id != mid,
                )
            )
            if existing:
                raise PollValidationError(f"Display name '{trimmed}' already in use.")
            member.display_name = trimmed

    if is_active is not None:
        member.is_active = bool(is_active)

    session.commit()
    session.refresh(member)
    return member


def list_group_members(
    session: Session,
    group_id: uuid.UUID | str,
) -> list[Member]:
    """List all members of a group ordered by display name."""
    gid = resolve_uuid(group_id)
    group = session.get(Group, gid)
    if not group:
        raise GroupNotFoundError(f"Group {gid} not found.")

    return list(
        session.scalars(
            select(Member)
            .where(Member.group_id == gid)
            .order_by(Member.display_name)
        ).all()
    )


def get_group_by_join_code(
    session: Session,
    join_code: str,
) -> Group:
    """Retrieve group by its unguessable join code."""
    if not join_code or not isinstance(join_code, str) or not join_code.strip():
        raise GroupNotFoundError("Join code cannot be empty.")

    group = session.scalar(
        select(Group).where(Group.join_code == join_code.strip())
    )
    if not group:
        raise GroupNotFoundError(f"No group found for join code: '{join_code}'.")
    return group


def claim_member(
    session: Session,
    join_code: str,
    member_id: uuid.UUID | str,
    now: datetime | None = None,
) -> tuple[Member, str]:
    """Claim a member name using the group join code.

    Locks member row with FOR UPDATE. Returns (member, plain_member_token).
    """
    group = get_group_by_join_code(session, join_code)
    mid = resolve_uuid(member_id)

    # Lock the member row
    member = session.scalar(
        select(Member).where(Member.id == mid).with_for_update()
    )
    if not member:
        raise MemberNotFoundError(f"Member {mid} not found.")

    if member.group_id != group.id:
        raise PermissionDeniedError(
            f"Member {mid} does not belong to group with join code '{join_code}'."
        )

    if not member.is_active:
        raise MemberInactiveError(f"Member {mid} is inactive.")

    if member.claim_status != "unclaimed":
        raise ClaimConflictError(
            f"Member {mid} is already claimed with status '{member.claim_status}'."
        )

    token = generate_token()
    claim_time = ensure_utc(now) or datetime.now(timezone.utc)

    member.member_token_hash = hash_token(token)
    member.claimed_at = claim_time
    member.claim_status = "pending" if group.require_claim_approval else "approved"

    session.commit()
    session.refresh(member)
    return member, token


def approve_claim(
    session: Session,
    group_id: uuid.UUID | str,
    member_id: uuid.UUID | str,
) -> Member:
    """Approve a pending member claim."""
    gid = resolve_uuid(group_id)
    mid = resolve_uuid(member_id)

    member = session.scalar(
        select(Member).where(Member.id == mid).with_for_update()
    )
    if not member:
        raise MemberNotFoundError(f"Member {mid} not found.")

    if member.group_id != gid:
        raise PermissionDeniedError(f"Member {mid} does not belong to group {gid}.")

    if member.claim_status == "unclaimed":
        raise ClaimStateError(f"Cannot approve claim for unclaimed member {mid}.")

    if member.claim_status == "pending":
        member.claim_status = "approved"
        session.commit()
        session.refresh(member)

    # Already approved is a no-op
    return member


def reset_claim(
    session: Session,
    group_id: uuid.UUID | str,
    member_id: uuid.UUID | str,
) -> Member:
    """Reset a member claim to unclaimed, revoking any active token.

    Existing votes and history remain intact.
    """
    gid = resolve_uuid(group_id)
    mid = resolve_uuid(member_id)

    member = session.scalar(
        select(Member).where(Member.id == mid).with_for_update()
    )
    if not member:
        raise MemberNotFoundError(f"Member {mid} not found.")

    if member.group_id != gid:
        raise PermissionDeniedError(f"Member {mid} does not belong to group {gid}.")

    member.claim_status = "unclaimed"
    member.member_token_hash = None
    member.claimed_at = None

    session.commit()
    session.refresh(member)
    return member


def authenticate_member(
    session: Session,
    member_token: str,
) -> Member:
    """Authenticate a member by plain member token.

    Does not verify approval status.
    """
    if not member_token or not isinstance(member_token, str) or not member_token.strip():
        raise InvalidTokenError("Member token cannot be empty.")

    token_hash = hash_token(member_token.strip())
    member = session.scalar(
        select(Member).where(Member.member_token_hash == token_hash)
    )
    if not member:
        raise InvalidTokenError("Invalid member token.")

    return member


def require_approved(member: Member) -> None:
    """Raise ClaimNotApprovedError if member claim_status is not 'approved'."""
    if member.claim_status != "approved":
        raise ClaimNotApprovedError(
            f"Member '{member.display_name}' claim is not approved (status: {member.claim_status})."
        )
