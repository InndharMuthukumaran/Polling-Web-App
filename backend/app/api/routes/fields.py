"""Group custom fields management endpoints."""

from uuid import UUID
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin_for_group
from app.api.schemas import (
    FieldCreate,
    FieldUpdate,
    GroupFieldResponse,
)
from app.models import Group
from app.services.fields import (
    create_group_field,
    delete_group_field,
    list_group_fields,
    update_group_field,
)

router = APIRouter(prefix="/groups/{group_id}/fields", tags=["Group Fields"])


@router.get("", response_model=list[GroupFieldResponse])
def get_fields(
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> list[GroupFieldResponse]:
    """Get all fields for a group ordered by position (admin only)."""
    fields = list_group_fields(session, group.id)
    return [GroupFieldResponse.model_validate(f) for f in fields]


@router.post("", response_model=GroupFieldResponse, status_code=status.HTTP_201_CREATED)
def post_field(
    payload: FieldCreate,
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> GroupFieldResponse:
    """Create a new custom field for a group (admin only)."""
    field = create_group_field(
        session,
        group_id=group.id,
        name=payload.name,
        field_type=payload.field_type,
        is_required=payload.is_required,
        default_value=payload.default_value,
        choices=payload.choices,
    )
    return GroupFieldResponse.model_validate(field)


@router.patch("/{field_id}", response_model=GroupFieldResponse)
def patch_field(
    field_id: UUID,
    payload: FieldUpdate,
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> GroupFieldResponse:
    """Update a group custom field (admin only)."""
    field = update_group_field(
        session,
        group_id=group.id,
        field_id=field_id,
        name=payload.name,
        is_required=payload.is_required,
        default_value=payload.default_value,
        choices=payload.choices,
        is_identifier=payload.is_identifier,
    )
    return GroupFieldResponse.model_validate(field)


@router.delete("/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_field(
    field_id: UUID,
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> None:
    """Delete a custom field from a group (admin only)."""
    delete_group_field(session, group_id=group.id, field_id=field_id)
    return None
