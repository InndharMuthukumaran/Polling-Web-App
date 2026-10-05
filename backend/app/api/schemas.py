"""Pydantic v2 request and response models for the Polling API."""

from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Error Schemas
# ---------------------------------------------------------------------------
class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


# ---------------------------------------------------------------------------
# Health Schemas
# ---------------------------------------------------------------------------
class HealthResponse(BaseModel):
    status: str = "ok"


# ---------------------------------------------------------------------------
# Group Request & Response Schemas
# ---------------------------------------------------------------------------
class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1)


class GroupCreatedResponse(BaseModel):
    group_id: UUID
    name: str
    join_code: str
    admin_token: str


class GroupSettingsUpdate(BaseModel):
    require_claim_approval: bool


class MemberSummary(BaseModel):
    id: UUID
    display_name: str
    is_active: bool
    claim_status: str

    model_config = ConfigDict(from_attributes=True)


class GroupDetailResponse(BaseModel):
    id: UUID
    name: str
    join_code: str
    require_claim_approval: bool
    members: list[MemberSummary]

    model_config = ConfigDict(from_attributes=True)


class GroupSummaryResponse(BaseModel):
    id: UUID
    name: str
    join_code: str
    require_claim_approval: bool

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Member Management Schemas
# ---------------------------------------------------------------------------
class MembersBulkCreate(BaseModel):
    display_names: list[str]


class MemberUpdate(BaseModel):
    display_name: str | None = None
    is_active: bool | None = None


# ---------------------------------------------------------------------------
# Join & Claim Schemas
# ---------------------------------------------------------------------------
class JoinMemberSummary(BaseModel):
    id: UUID
    display_name: str
    taken: bool


class JoinGroupResponse(BaseModel):
    group_id: UUID
    group_name: str
    members: list[JoinMemberSummary]


class MemberClaimRequest(BaseModel):
    member_id: UUID


class ClaimResponse(BaseModel):
    member_id: UUID
    member_token: str
    status: str


# ---------------------------------------------------------------------------
# Member /me Schemas
# ---------------------------------------------------------------------------
class MeResponse(BaseModel):
    member_id: UUID
    display_name: str
    group_id: UUID
    group_name: str
    claim_status: str


class MemberPollSummaryResponse(BaseModel):
    id: UUID
    name: str
    status: str
    deadline: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ReleaseClaimResponse(BaseModel):
    status: str = "unclaimed"



# ---------------------------------------------------------------------------
# Poll Creation & Details Schemas
# ---------------------------------------------------------------------------
class PollOptionCreate(BaseModel):
    label: str = Field(..., min_length=1)
    role: str


class PollCreate(BaseModel):
    name: str = Field(..., min_length=1)
    description_raw: str | None = None
    allow_multiple: bool
    options: list[PollOptionCreate] = Field(..., min_length=2)
    deadline: datetime | None = None
    completion_time_mode: Literal["first", "last"] = "last"


class PollOptionDetail(BaseModel):
    id: UUID
    label: str
    role: str
    position: int

    model_config = ConfigDict(from_attributes=True)


class PollDetailResponse(BaseModel):
    id: UUID
    group_id: UUID
    name: str
    description_raw: str | None = None
    status: str
    allow_multiple: bool
    deadline: datetime | None = None
    completion_time_mode: str
    created_at: datetime
    closed_at: datetime | None = None
    options: list[PollOptionDetail]

    model_config = ConfigDict(from_attributes=True)


class PollSummaryResponse(BaseModel):
    id: UUID
    name: str
    status: str
    deadline: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# Public Poll View: NO roles, NO votes, includes join_code and group_name
class PublicPollOption(BaseModel):
    id: UUID
    label: str
    position: int

    model_config = ConfigDict(from_attributes=True)


class PublicPollResponse(BaseModel):
    id: UUID
    name: str
    description_raw: str | None = None
    status: str
    allow_multiple: bool
    deadline: datetime | None = None
    options: list[PublicPollOption]
    group_name: str
    join_code: str


# ---------------------------------------------------------------------------
# Voting & Member Poll Views
# ---------------------------------------------------------------------------
class VoteRequest(BaseModel):
    option_id: UUID


class VoteResponse(BaseModel):
    selected_option_ids: list[UUID]


class MemberPollHistoryItem(BaseModel):
    option_id: UUID
    option_label: str
    first_selected_at: datetime
    last_selected_at: datetime
    is_selected: bool

    model_config = ConfigDict(from_attributes=True)


class MemberPollMeResponse(BaseModel):
    selected_option_ids: list[UUID]
    history: list[MemberPollHistoryItem]


# ---------------------------------------------------------------------------
# Poll Status & Group History Schemas (Admin View)
# ---------------------------------------------------------------------------
class PollStatusInfoSchema(BaseModel):
    id: UUID
    name: str
    status: str
    allow_multiple: bool
    deadline: datetime | None = None
    completion_time_mode: str


class PollCountsSchema(BaseModel):
    total_active: int
    at_target: int
    excused: int
    behind_target: int
    not_voted: int


class MemberTargetStatusSchema(BaseModel):
    member_id: UUID
    display_name: str
    completed_at: datetime
    late: bool


class MemberBasicStatusSchema(BaseModel):
    member_id: UUID
    display_name: str


class PollStatusResponse(BaseModel):
    poll: PollStatusInfoSchema
    counts: PollCountsSchema
    all_reached: bool
    at_target: list[MemberTargetStatusSchema]
    excused: list[MemberBasicStatusSchema]
    behind_target: list[MemberBasicStatusSchema]
    not_voted: list[MemberBasicStatusSchema]


class MemberHistoryResponse(BaseModel):
    member_id: UUID
    display_name: str
    history: list[MemberPollHistoryItem]
