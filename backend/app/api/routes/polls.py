"""Poll viewing, voting, status, and administration endpoints."""

from uuid import UUID
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    get_db,
    require_admin_for_poll,
    require_approved_member_for_poll,
    resolve_uuid,
)
from app.api.schemas import (
    MemberBasicStatusSchema,
    MemberHistoryResponse,
    MemberPollHistoryItem,
    MemberPollMeResponse,
    MemberTargetStatusSchema,
    PollAnswersRequest,
    PollAnswersResponse,
    PollCountsSchema,
    PollDetailResponse,
    PollResultsResponse,
    PollStatusInfoSchema,
    PollStatusResponse,
    PublicPollField,
    PublicPollOption,
    PublicPollResponse,
    VoteRequest,
    VoteResponse,
)
from app.errors import GroupNotFoundError, PollNotFoundError, PollValidationError
from app.models import Group, GroupField, Member, Poll, PollAnswer, Vote
from app.services.polls import (
    all_reached,
    cast_vote,
    close_poll,
    export_poll_results_csv,
    export_poll_results_xlsx,
    get_member_history,
    get_poll_results,
    get_poll_status,
    remove_vote,
    save_poll_answers,
)

router = APIRouter(prefix="/polls", tags=["Polls"])


@router.get("/{poll_id}", response_model=PublicPollResponse)
def get_public_poll(
    poll_id: UUID,
    session: Session = Depends(get_db),
) -> PublicPollResponse:
    """Return public poll details: options without roles, no member votes, includes group info."""
    pid = resolve_uuid(poll_id)
    poll = session.get(Poll, pid)
    if not poll:
        raise PollNotFoundError(f"Poll {pid} not found.")

    group = session.get(Group, poll.group_id)
    if not group:
        raise GroupNotFoundError(f"Group {poll.group_id} not found.")

    # Sort options by position
    sorted_options = sorted(poll.options, key=lambda o: o.position)
    sorted_poll_fields = sorted(poll.poll_fields, key=lambda f: f.position)

    return PublicPollResponse(
        id=poll.id,
        name=poll.name,
        description_raw=poll.description_raw,
        status=poll.status,
        allow_multiple=poll.allow_multiple,
        deadline=poll.deadline,
        options=[
            PublicPollOption(id=opt.id, label=opt.label, position=opt.position)
            for opt in sorted_options
        ],
        group_name=group.name,
        join_code=group.join_code,
        poll_fields=[
            PublicPollField.model_validate(pf)
            for pf in sorted_poll_fields
        ],
    )


@router.post("/{poll_id}/vote", response_model=VoteResponse)
def vote_poll(
    payload: VoteRequest,
    target: tuple[Poll, Member] = Depends(require_approved_member_for_poll),
    session: Session = Depends(get_db),
) -> VoteResponse:
    """Cast or switch a member's vote. Returns current selected option IDs."""
    poll, member = target
    cast_vote(session, poll.id, member.id, payload.option_id)

    # Fetch currently active votes for member
    votes = session.scalars(
        select(Vote).where(Vote.poll_id == poll.id, Vote.member_id == member.id)
    ).all()
    return VoteResponse(selected_option_ids=[v.option_id for v in votes])


@router.delete("/{poll_id}/vote", response_model=VoteResponse)
def delete_poll_vote(
    option_id: UUID | None = Query(None),
    target: tuple[Poll, Member] = Depends(require_approved_member_for_poll),
    session: Session = Depends(get_db),
) -> VoteResponse:
    """Remove a vote (or all votes if option_id omitted). Returns current selected option IDs."""
    poll, member = target
    remove_vote(session, poll.id, member.id, option_id)

    votes = session.scalars(
        select(Vote).where(Vote.poll_id == poll.id, Vote.member_id == member.id)
    ).all()
    return VoteResponse(selected_option_ids=[v.option_id for v in votes])


@router.get("/{poll_id}/me", response_model=MemberPollMeResponse)
def get_my_poll_view(
    target: tuple[Poll, Member] = Depends(require_approved_member_for_poll),
    session: Session = Depends(get_db),
) -> MemberPollMeResponse:
    """Return member's currently selected option IDs and full history for this poll."""
    poll, member = target

    votes = session.scalars(
        select(Vote).where(Vote.poll_id == poll.id, Vote.member_id == member.id)
    ).all()
    history = get_member_history(session, poll.id, member.id)

    ans = session.scalar(
        select(PollAnswer).where(
            PollAnswer.poll_id == poll.id,
            PollAnswer.member_id == member.id,
        )
    )

    return MemberPollMeResponse(
        selected_option_ids=[v.option_id for v in votes],
        history=[MemberPollHistoryItem.model_validate(h) for h in history],
        answers=ans.values if ans and ans.values else {},
        answers_updated_at=ans.updated_at if ans else None,
    )


@router.put("/{poll_id}/answers", response_model=PollAnswersResponse)
def update_poll_answers(
    payload: PollAnswersRequest,
    target: tuple[Poll, Member] = Depends(require_approved_member_for_poll),
    session: Session = Depends(get_db),
) -> PollAnswersResponse:
    """Save or partially update answers to poll-only fields (approved member only)."""
    poll, member = target
    answer = save_poll_answers(session, poll.id, member.id, payload.values)
    return PollAnswersResponse(
        answers=answer.values,
        answers_updated_at=answer.updated_at,
    )


@router.get("/{poll_id}/status", response_model=PollStatusResponse)
def get_poll_status_view(
    target: tuple[Poll, Group] = Depends(require_admin_for_poll),
    session: Session = Depends(get_db),
) -> PollStatusResponse:
    """Return full status categorization, counts, completion times, and identifiers (admin only)."""
    poll, group = target
    status_result = get_poll_status(session, poll.id)
    is_all_reached = all_reached(session, poll.id)

    id_field = session.scalar(
        select(GroupField).where(
            GroupField.group_id == group.id,
            GroupField.is_identifier.is_(True),
        )
    )
    id_key = id_field.key if id_field is not None else None

    def _get_id(m: Member) -> str | None:
        if not id_key or not m.field_values:
            return None
        val = m.field_values.get(id_key)
        return str(val) if val is not None else None

    total_active = (
        len(status_result.at_target)
        + len(status_result.excused)
        + len(status_result.behind_target)
        + len(status_result.not_voted)
    )

    return PollStatusResponse(
        poll=PollStatusInfoSchema(
            id=poll.id,
            name=poll.name,
            status=poll.status,
            allow_multiple=poll.allow_multiple,
            deadline=poll.deadline,
            completion_time_mode=poll.completion_time_mode,
        ),
        counts=PollCountsSchema(
            total_active=total_active,
            at_target=len(status_result.at_target),
            excused=len(status_result.excused),
            behind_target=len(status_result.behind_target),
            not_voted=len(status_result.not_voted),
        ),
        all_reached=is_all_reached,
        at_target=[
            MemberTargetStatusSchema(
                member_id=item.member.id,
                display_name=item.member.display_name,
                completed_at=item.completed_at,
                late=item.late,
                identifier=_get_id(item.member),
            )
            for item in status_result.at_target
        ],
        excused=[
            MemberBasicStatusSchema(
                member_id=m.id,
                display_name=m.display_name,
                identifier=_get_id(m),
            )
            for m in status_result.excused
        ],
        behind_target=[
            MemberBasicStatusSchema(
                member_id=m.id,
                display_name=m.display_name,
                identifier=_get_id(m),
            )
            for m in status_result.behind_target
        ],
        not_voted=[
            MemberBasicStatusSchema(
                member_id=m.id,
                display_name=m.display_name,
                identifier=_get_id(m),
            )
            for m in status_result.not_voted
        ],
    )


@router.get("/{poll_id}/history", response_model=list[MemberHistoryResponse])
def get_poll_history_view(
    target: tuple[Poll, Group] = Depends(require_admin_for_poll),
    session: Session = Depends(get_db),
) -> list[MemberHistoryResponse]:
    """Return history of all active members who have interacted with this poll (admin only)."""
    poll, group = target

    id_field = session.scalar(
        select(GroupField).where(
            GroupField.group_id == group.id,
            GroupField.is_identifier.is_(True),
        )
    )
    id_key = id_field.key if id_field is not None else None

    def _get_id(m: Member) -> str | None:
        if not id_key or not m.field_values:
            return None
        val = m.field_values.get(id_key)
        return str(val) if val is not None else None

    active_members = session.scalars(
        select(Member)
        .where(Member.group_id == group.id, Member.is_active.is_(True))
        .order_by(Member.display_name)
    ).all()

    result: list[MemberHistoryResponse] = []
    for m in active_members:
        hist = get_member_history(session, poll.id, m.id)
        if hist:
            result.append(
                MemberHistoryResponse(
                    member_id=m.id,
                    display_name=m.display_name,
                    identifier=_get_id(m),
                    history=[MemberPollHistoryItem.model_validate(h) for h in hist],
                )
            )

    return result


@router.post("/{poll_id}/close", response_model=PollDetailResponse)
def close_poll_view(
    target: tuple[Poll, Group] = Depends(require_admin_for_poll),
    session: Session = Depends(get_db),
) -> PollDetailResponse:
    """Close the poll. Idempotent: closing twice returns 200 both times (admin only)."""
    poll, _ = target
    closed_poll = close_poll(session, poll.id)
    return PollDetailResponse.model_validate(closed_poll)


@router.get("/{poll_id}/results")
def get_poll_results_endpoint(
    poll_id: UUID,
    format: str = Query("json"),
    target: tuple[Poll, Group] = Depends(require_admin_for_poll),
    session: Session = Depends(get_db),
):
    """Return poll results table in JSON, CSV, or XLSX format (admin only)."""
    poll, _ = target
    fmt = format.lower()
    if fmt not in ("json", "csv", "xlsx"):
        raise PollValidationError(f"Invalid format '{format}'. Allowed: json, csv, xlsx.")

    results_data = get_poll_results(session, poll.id)

    if fmt == "json":
        return PollResultsResponse.model_validate(results_data)
    elif fmt == "csv":
        csv_bytes, filename = export_poll_results_csv(results_data)
        return Response(
            content=csv_bytes,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    else:  # xlsx
        xlsx_bytes, filename = export_poll_results_xlsx(results_data)
        return Response(
            content=xlsx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
