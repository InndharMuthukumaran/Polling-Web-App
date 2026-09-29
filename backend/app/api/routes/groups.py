"""Admin group management endpoints."""

from uuid import UUID
from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin_for_group
from app.api.schemas import (
    GroupCreate,
    GroupCreatedResponse,
    GroupDetailResponse,
    GroupSettingsUpdate,
    GroupSummaryResponse,
    MemberSummary,
    MembersBulkCreate,
    MemberUpdate,
    PollCreate,
    PollDetailResponse,
    PollSummaryResponse,
)
from app.models import Group, Poll
from app.services.identity import (
    add_members_bulk,
    approve_claim,
    create_group_with_admin,
    list_group_members,
    reset_claim,
    update_group_settings,
    update_member,
)
from app.services.polls import PollOptionInput, create_poll

router = APIRouter(prefix="/groups", tags=["Groups"])


@router.post("", response_model=GroupCreatedResponse, status_code=status.HTTP_201_CREATED)
def create_group(
    payload: GroupCreate,
    session: Session = Depends(get_db),
) -> GroupCreatedResponse:
    """Create a new group with a unique join code and admin token (shown once)."""
    group, admin_token = create_group_with_admin(session, payload.name)
    return GroupCreatedResponse(
        group_id=group.id,
        name=group.name,
        join_code=group.join_code,
        admin_token=admin_token,
    )


@router.get("/{group_id}", response_model=GroupDetailResponse)
def get_group(
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> GroupDetailResponse:
    """Get group details and members (admin only)."""
    members = list_group_members(session, group.id)
    return GroupDetailResponse(
        id=group.id,
        name=group.name,
        join_code=group.join_code,
        require_claim_approval=group.require_claim_approval,
        members=[MemberSummary.model_validate(m) for m in members],
    )


@router.patch("/{group_id}", response_model=GroupSummaryResponse)
def update_settings(
    payload: GroupSettingsUpdate,
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> GroupSummaryResponse:
    """Update group settings (admin only)."""
    updated_group = update_group_settings(session, group.id, payload.require_claim_approval)
    return GroupSummaryResponse.model_validate(updated_group)


@router.post(
    "/{group_id}/members",
    response_model=list[MemberSummary],
    status_code=status.HTTP_201_CREATED,
)
def add_members(
    payload: MembersBulkCreate,
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> list[MemberSummary]:
    """Bulk-add members to the group (all-or-nothing, admin only)."""
    members = add_members_bulk(session, group.id, payload.display_names)
    return [MemberSummary.model_validate(m) for m in members]


@router.patch("/{group_id}/members/{member_id}", response_model=MemberSummary)
def patch_member(
    member_id: UUID,
    payload: MemberUpdate,
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> MemberSummary:
    """Update member display name or active status (admin only)."""
    member = update_member(
        session,
        group_id=group.id,
        member_id=member_id,
        display_name=payload.display_name,
        is_active=payload.is_active,
    )
    return MemberSummary.model_validate(member)


@router.post("/{group_id}/members/{member_id}/approve", response_model=MemberSummary)
def approve_member_claim(
    member_id: UUID,
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> MemberSummary:
    """Approve a pending member claim (admin only)."""
    member = approve_claim(session, group.id, member_id)
    return MemberSummary.model_validate(member)


@router.post("/{group_id}/members/{member_id}/reset", response_model=MemberSummary)
def reset_member_claim(
    member_id: UUID,
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> MemberSummary:
    """Reset a member claim to unclaimed, revoking existing tokens (admin only)."""
    member = reset_claim(session, group.id, member_id)
    return MemberSummary.model_validate(member)


@router.post(
    "/{group_id}/polls",
    response_model=PollDetailResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_group_poll(
    payload: PollCreate,
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> PollDetailResponse:
    """Create a new poll in this group (admin only)."""
    poll_options = [
        PollOptionInput(label=opt.label, role=opt.role)
        for opt in payload.options
    ]
    poll = create_poll(
        session,
        group_id=group.id,
        name=payload.name,
        options=poll_options,
        description_raw=payload.description_raw,
        allow_multiple=payload.allow_multiple,
        deadline=payload.deadline,
        completion_time_mode=payload.completion_time_mode,
    )
    return PollDetailResponse.model_validate(poll)


@router.get("/{group_id}/polls", response_model=list[PollSummaryResponse])
def list_group_polls(
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> list[PollSummaryResponse]:
    """List all polls for this group, newest first (admin only)."""
    polls = session.scalars(
        select(Poll)
        .where(Poll.group_id == group.id)
        .order_by(Poll.created_at.desc())
    ).all()
    return [PollSummaryResponse.model_validate(p) for p in polls]
