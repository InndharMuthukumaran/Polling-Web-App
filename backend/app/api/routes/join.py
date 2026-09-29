"""Public join and member claim endpoints."""

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.schemas import (
    ClaimResponse,
    JoinGroupResponse,
    JoinMemberSummary,
    MemberClaimRequest,
)
from app.models import Member
from app.services.identity import claim_member, get_group_by_join_code

router = APIRouter(prefix="/join", tags=["Join"])


@router.get("/{join_code}", response_model=JoinGroupResponse)
def get_join_info(
    join_code: str,
    session: Session = Depends(get_db),
) -> JoinGroupResponse:
    """Return group name and active members with taken/untaken status (public)."""
    group = get_group_by_join_code(session, join_code)
    members = session.scalars(
        select(Member)
        .where(Member.group_id == group.id, Member.is_active.is_(True))
        .order_by(Member.display_name)
    ).all()

    return JoinGroupResponse(
        group_id=group.id,
        group_name=group.name,
        members=[
            JoinMemberSummary(
                id=m.id,
                display_name=m.display_name,
                taken=m.claim_status in ("pending", "approved"),
            )
            for m in members
        ],
    )


@router.post(
    "/{join_code}/claim",
    response_model=ClaimResponse,
    status_code=status.HTTP_201_CREATED,
)
def claim_group_member(
    join_code: str,
    payload: MemberClaimRequest,
    session: Session = Depends(get_db),
) -> ClaimResponse:
    """Claim a member name in the group and receive a member token (public)."""
    member, token = claim_member(session, join_code, payload.member_id)
    return ClaimResponse(
        member_id=member.id,
        member_token=token,
        status=member.claim_status,
    )
