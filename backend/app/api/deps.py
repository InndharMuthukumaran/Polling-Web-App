"""FastAPI dependencies for database session, admin auth, and member auth."""

from collections.abc import Generator
import uuid
from uuid import UUID

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import MissingTokenError
from app.db import SessionLocal
from app.errors import (
    ClaimNotApprovedError,
    GroupNotFoundError,
    InvalidTokenError,
    MemberGroupMismatchError,
    MemberInactiveError,
    PermissionDeniedError,
    PollNotFoundError,
)
from app.models import Group, Member, Poll
from app.security import hash_token, verify_token_hash
from app.services.identity import authenticate_member, require_approved


def resolve_uuid(val: UUID | str) -> UUID:
    """Safely convert a UUID or string into a UUID object."""
    if isinstance(val, UUID):
        return val
    return UUID(str(val))


def get_db() -> Generator[Session, None, None]:
    """Provide a transactional database session per request.

    Always rolls back on exception and closes when the request ends.
    """
    session = SessionLocal()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def require_admin_for_group(
    group_id: UUID,
    x_admin_token: str | None = Header(None, alias="X-Admin-Token"),
    session: Session = Depends(get_db),
) -> Group:
    """Validate X-Admin-Token against a specific group.

    - Missing token -> 401 missing_token
    - Unknown group -> 404 not_found
    - Token for a different group -> 403 forbidden
    - Wrong token / no admin configured -> 401 invalid_token
    """
    if not x_admin_token or not x_admin_token.strip():
        raise MissingTokenError("X-Admin-Token header is required.")

    gid = resolve_uuid(group_id)
    group = session.get(Group, gid)
    if not group:
        raise GroupNotFoundError(f"Group {gid} not found.")

    token_clean = x_admin_token.strip()
    if not group.admin_token_hash or not verify_token_hash(token_clean, group.admin_token_hash):
        # Check if this token is a valid admin token for ANY other group
        hashed = hash_token(token_clean)
        other_group = session.scalar(
            select(Group).where(Group.admin_token_hash == hashed)
        )
        if other_group:
            raise PermissionDeniedError("This admin token is not valid for this group.")
        raise InvalidTokenError("Invalid admin token.")

    return group


def require_admin_for_poll(
    poll_id: UUID,
    x_admin_token: str | None = Header(None, alias="X-Admin-Token"),
    session: Session = Depends(get_db),
) -> tuple[Poll, Group]:
    """Validate X-Admin-Token against the group owning the poll.

    - Missing token -> 401 missing_token
    - Unknown poll -> 404 not_found
    - Token for a different group -> 403 forbidden
    - Wrong token -> 401 invalid_token
    """
    if not x_admin_token or not x_admin_token.strip():
        raise MissingTokenError("X-Admin-Token header is required.")

    pid = resolve_uuid(poll_id)
    poll = session.get(Poll, pid)
    if not poll:
        raise PollNotFoundError(f"Poll {pid} not found.")

    group = session.get(Group, poll.group_id)
    if not group:
        raise GroupNotFoundError(f"Group {poll.group_id} not found.")

    token_clean = x_admin_token.strip()
    if not group.admin_token_hash or not verify_token_hash(token_clean, group.admin_token_hash):
        hashed = hash_token(token_clean)
        other_group = session.scalar(
            select(Group).where(Group.admin_token_hash == hashed)
        )
        if other_group:
            raise PermissionDeniedError("This admin token is not valid for this group.")
        raise InvalidTokenError("Invalid admin token.")

    return poll, group


def get_current_member(
    x_member_token: str | None = Header(None, alias="X-Member-Token"),
    session: Session = Depends(get_db),
) -> Member:
    """Authenticate member by X-Member-Token.

    Works for pending claims as well (e.g. for GET /api/v1/me).
    """
    if not x_member_token or not x_member_token.strip():
        raise MissingTokenError("X-Member-Token header is required.")

    return authenticate_member(session, x_member_token.strip())


def require_approved_member(
    member: Member = Depends(get_current_member),
) -> Member:
    """Ensure authenticated member is active and claim is approved."""
    if not member.is_active:
        raise MemberInactiveError(f"Member '{member.display_name}' is inactive.")
    require_approved(member)
    return member


def require_approved_member_for_poll(
    poll_id: UUID,
    member: Member = Depends(require_approved_member),
    session: Session = Depends(get_db),
) -> tuple[Poll, Member]:
    """Ensure member is approved, active, and belongs to the poll's group."""
    pid = resolve_uuid(poll_id)
    poll = session.get(Poll, pid)
    if not poll:
        raise PollNotFoundError(f"Poll {pid} not found.")

    if member.group_id != poll.group_id:
        raise MemberGroupMismatchError(
            f"Member belongs to group {member.group_id}, but poll belongs to group {poll.group_id}."
        )

    return poll, member
