"""Limits route exposing application guardrails and constraints."""

from fastapi import APIRouter

from app.api.schemas import LimitsResponse
from app import limits

router = APIRouter(tags=["limits"])


@router.get("/limits", response_model=LimitsResponse)
def get_limits() -> LimitsResponse:
    """Return public application limits and guardrails (no authentication required)."""
    return LimitsResponse(
        max_group_fields=limits.MAX_GROUP_FIELDS,
        max_poll_fields=limits.MAX_POLL_FIELDS,
        max_choices=limits.MAX_CHOICES,
        min_choices=limits.MIN_CHOICES,
        max_text_length=limits.MAX_TEXT_LENGTH,
        max_import_rows=limits.MAX_IMPORT_ROWS,
        max_import_columns=limits.MAX_IMPORT_COLUMNS,
        max_import_file_bytes=limits.MAX_IMPORT_FILE_BYTES,
        max_members_per_request=limits.MAX_MEMBERS_PER_REQUEST,
    )
