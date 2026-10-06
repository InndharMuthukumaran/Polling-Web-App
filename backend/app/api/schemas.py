"""Pydantic v2 request and response models for the Polling API."""

from datetime import datetime
from typing import Any, Literal
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
# Group Field Schemas
# ---------------------------------------------------------------------------
class GroupFieldResponse(BaseModel):
    id: UUID
    key: str
    name: str
    field_type: str
    is_required: bool
    default_value: str | None = None
    choices: list[str] | None = None
    is_identifier: bool
    position: int

    model_config = ConfigDict(from_attributes=True)


class FieldCreate(BaseModel):
    name: str
    field_type: str
    is_required: bool = False
    default_value: str | None = None
    choices: list[str] | None = None


class FieldUpdate(BaseModel):
    name: str | None = None
    is_required: bool | None = None
    default_value: str | None = None
    choices: list[str] | None = None
    is_identifier: bool | None = None


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
    require_claim_approval: bool | None = None
    allow_name_list: bool | None = None


class MemberSummary(BaseModel):
    id: UUID
    display_name: str
    is_active: bool
    claim_status: str
    values: dict[str, Any] = Field(default_factory=dict)
    identifier: str | None = None

    model_config = ConfigDict(from_attributes=True)


class GroupDetailResponse(BaseModel):
    id: UUID
    name: str
    join_code: str
    require_claim_approval: bool
    allow_name_list: bool = False
    fields: list[GroupFieldResponse] = Field(default_factory=list)
    members: list[MemberSummary]

    model_config = ConfigDict(from_attributes=True)


class GroupSummaryResponse(BaseModel):
    id: UUID
    name: str
    join_code: str
    require_claim_approval: bool
    allow_name_list: bool = False

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Member Management Schemas
# ---------------------------------------------------------------------------
class MemberCreateItem(BaseModel):
    display_name: str
    values: dict[str, Any] | None = None


class MembersBulkCreate(BaseModel):
    display_names: list[str] | None = None
    members: list[MemberCreateItem] | None = None


class MemberUpdate(BaseModel):
    display_name: str | None = None
    is_active: bool | None = None
    values: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Join & Claim Schemas
# ---------------------------------------------------------------------------
class JoinMemberSummary(BaseModel):
    id: UUID
    display_name: str
    taken: bool
    identifier_hint: str | None = None


class JoinGroupResponse(BaseModel):
    group_id: UUID
    group_name: str
    claim_mode: str
    identifier_label: str | None = None
    allow_name_list: bool = False
    members: list[JoinMemberSummary]


class MemberLookupRequest(BaseModel):
    identifier: str


class MemberLookupResponse(BaseModel):
    member_id: UUID
    display_name: str | None = None
    taken: bool


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


class PollFieldCreate(BaseModel):
    name: str = Field(..., min_length=1)
    field_type: str
    is_required: bool = False
    default_value: str | None = None
    choices: list[str] | None = None


class PollCreate(BaseModel):
    name: str = Field(..., min_length=1)
    description_raw: str | None = None
    allow_multiple: bool
    options: list[PollOptionCreate] = Field(..., min_length=2)
    deadline: datetime | None = None
    completion_time_mode: Literal["first", "last"] = "last"
    included_field_ids: list[UUID] | None = None
    poll_fields: list[PollFieldCreate] | None = None


class PollOptionDetail(BaseModel):
    id: UUID
    label: str
    role: str
    position: int

    model_config = ConfigDict(from_attributes=True)


class IncludedFieldResponse(BaseModel):
    id: UUID
    key: str
    name: str
    field_type: str

    model_config = ConfigDict(from_attributes=True)


class PollFieldResponse(BaseModel):
    id: UUID
    key: str
    name: str
    field_type: str
    is_required: bool
    default_value: str | None = None
    choices: list[str] | None = None
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
    included_fields: list[IncludedFieldResponse] = Field(default_factory=list)
    poll_fields: list[PollFieldResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class PollSummaryResponse(BaseModel):
    id: UUID
    name: str
    status: str
    deadline: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PublicPollOption(BaseModel):
    id: UUID
    label: str
    position: int

    model_config = ConfigDict(from_attributes=True)


class PublicPollField(BaseModel):
    key: str
    name: str
    field_type: str
    is_required: bool
    default_value: str | None = None
    choices: list[str] | None = None
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
    poll_fields: list[PublicPollField] = Field(default_factory=list)


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
    answers: dict[str, Any] = Field(default_factory=dict)
    answers_updated_at: datetime | None = None


class PollAnswersRequest(BaseModel):
    values: dict[str, Any]


class PollAnswersResponse(BaseModel):
    answers: dict[str, Any]
    answers_updated_at: datetime


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
    identifier: str | None = None


class MemberBasicStatusSchema(BaseModel):
    member_id: UUID
    display_name: str
    identifier: str | None = None


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
    identifier: str | None = None
    history: list[MemberPollHistoryItem]


# ---------------------------------------------------------------------------
# Spreadsheet Import Schemas
# ---------------------------------------------------------------------------
class ColumnPreview(BaseModel):
    index: int
    header: str


class ImportPreviewResponse(BaseModel):
    filename: str
    sheet: str | None = None
    columns: list[ColumnPreview]
    total_rows: int
    sample_rows: list[list[str]]
    suggested_mapping: dict[str, str]


class ImportResultResponse(BaseModel):
    dry_run: bool
    rows_total: int
    rows_added: int
    rows_skipped: int
    fields_created: list[str]
    errors: list[dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Poll Results Table Schemas
# ---------------------------------------------------------------------------
class PollResultsPollInfo(BaseModel):
    id: UUID
    name: str
    status: str
    deadline: datetime | None = None
    allow_multiple: bool


class PollResultsColumn(BaseModel):
    source: Literal["group", "poll"]
    key: str
    name: str
    field_type: str
    is_identifier: bool


class PollResultsRow(BaseModel):
    member_id: UUID
    display_name: str
    identifier: str | None = None
    status: str
    selected_options: list[str]
    late: bool | None = None
    completed_at: datetime | None = None
    group_values: dict[str, Any] = Field(default_factory=dict)
    answers: dict[str, Any] = Field(default_factory=dict)
    answers_updated_at: datetime | None = None
    answers_complete: bool


class PollResultsResponse(BaseModel):
    poll: PollResultsPollInfo
    columns: list[PollResultsColumn]
    rows: list[PollResultsRow]

