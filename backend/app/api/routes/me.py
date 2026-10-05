"""Member self-management endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_member, get_db, require_approved_member
from app.api.schemas import MemberPollSummaryResponse, MeResponse, ReleaseClaimResponse
from app.models import Group, Member, Poll
from app.services.identity import release_own_claim

router = APIRouter(prefix="/me", tags=["Me"])


@router.get("", response_model=MeResponse)
def get_me(
    member: Member = Depends(get_current_member),
    session: Session = Depends(get_db),
) -> MeResponse:
    """Return authenticated member profile. Works for pending claims."""
    group = session.get(Group, member.group_id)
    group_name = group.name if group else ""
    return MeResponse(
        member_id=member.id,
        display_name=member.display_name,
        group_id=member.group_id,
        group_name=group_name,
        claim_status=member.claim_status,
    )


@router.post("/release", response_model=ReleaseClaimResponse)
def release_my_claim(
    member: Member = Depends(get_current_member),
    session: Session = Depends(get_db),
) -> ReleaseClaimResponse:
    """Release member's own claim. Works for both pending and approved members."""
    release_own_claim(session, member)
    return ReleaseClaimResponse(status="unclaimed")


@router.get("/polls", response_model=list[MemberPollSummaryResponse])
def get_my_polls(
    member: Member = Depends(require_approved_member),
    session: Session = Depends(get_db),
) -> list[MemberPollSummaryResponse]:
    """Return all polls of the member's group, newest first (approved members only)."""
    polls = session.scalars(
        select(Poll)
        .where(Poll.group_id == member.group_id)
        .order_by(Poll.created_at.desc())
    ).all()
    return [MemberPollSummaryResponse.model_validate(p) for p in polls]

