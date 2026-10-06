"""Public join and member claim endpoints."""

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.schemas import (
    ClaimResponse,
    JoinGroupResponse,
    JoinMemberSummary,
    MemberClaimRequest,
    MemberLookupRequest,
    MemberLookupResponse,
)
from app.config import settings
from app.errors import MemberNotFoundError
from app.models import GroupField, Member
from app.ratelimit import get_client_ip, lookup_limiter
from app.services.identity import (
    claim_member,
    get_group_by_join_code,
    lookup_member_by_identifier,
    mask_identifier,
)

router = APIRouter(prefix="/join", tags=["Join"])


@router.get("/{join_code}", response_model=JoinGroupResponse)
def get_join_info(
    join_code: str,
    session: Session = Depends(get_db),
) -> JoinGroupResponse:
    """Return group name, claim settings, and active members (public)."""
    group = get_group_by_join_code(session, join_code)
    id_field = session.scalar(
        select(GroupField).where(
            GroupField.group_id == group.id,
            GroupField.is_identifier.is_(True),
        )
    )

    claim_mode = "identifier" if id_field is not None else "list"
    identifier_label = id_field.name if id_field is not None else None

    # Public name list rule:
    # Returned only when claim_mode is "list", or when allow_name_list is True.
    # In "identifier" mode with allow_name_list False, members is empty.
    if claim_mode == "identifier" and not group.allow_name_list:
        members_list: list[JoinMemberSummary] = []
    else:
        active_members = session.scalars(
            select(Member)
            .where(Member.group_id == group.id, Member.is_active.is_(True))
            .order_by(Member.display_name)
        ).all()

        members_list = []
        for m in active_members:
            hint = None
            if id_field is not None and m.field_values:
                raw_val = m.field_values.get(id_field.key)
                hint = mask_identifier(raw_val)
            members_list.append(
                JoinMemberSummary(
                    id=m.id,
                    display_name=m.display_name,
                    taken=m.claim_status in ("pending", "approved"),
                    identifier_hint=hint,
                )
            )

    return JoinGroupResponse(
        group_id=group.id,
        group_name=group.name,
        claim_mode=claim_mode,
        identifier_label=identifier_label,
        allow_name_list=group.allow_name_list,
        members=members_list,
    )


@router.post(
    "/{join_code}/lookup",
    response_model=MemberLookupResponse,
)
def lookup_member(
    join_code: str,
    payload: MemberLookupRequest,
    request: Request,
    session: Session = Depends(get_db),
) -> MemberLookupResponse:
    """Lookup member by identifier with rate limiting on failed attempts (public)."""
    client_ip = get_client_ip(request, settings.trusted_proxy_count)

    ip_key = f"ip:{client_ip}:{join_code}"
    code_key = f"code:{join_code}"

    # 1. Check rate limits before lookup runs (check per-IP first, then per-code)
    lookup_limiter.check(ip_key, limit=settings.lookup_limit_per_ip)
    lookup_limiter.check(code_key, limit=settings.lookup_limit_per_code)

    # 2. Run lookup; record failure for both limits only when lookup fails (generic 404)
    try:
        member = lookup_member_by_identifier(session, join_code, payload.identifier)
    except MemberNotFoundError:
        lookup_limiter.record(ip_key)
        lookup_limiter.record(code_key)
        raise

    # 3. Successful lookups are never recorded
    taken = member.claim_status in ("pending", "approved")

    return MemberLookupResponse(
        member_id=member.id,
        display_name=None if taken else member.display_name,
        taken=taken,
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
