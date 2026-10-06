"""Admin routes for member spreadsheet templates, previews, and bulk imports."""

import json
from uuid import UUID
from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin_for_group
from app.api.schemas import ImportPreviewResponse, ImportResultResponse
from app.errors import PollValidationError
from app.models import Group
from app.services.fields import list_group_fields
from app.services.importer import (
    execute_spreadsheet_import,
    generate_template_file,
    preview_import_data,
    read_upload_capped,
)

router = APIRouter(prefix="/groups", tags=["Imports"])


@router.get("/{group_id}/members/template")
def download_members_template(
    group_id: UUID,
    format: str = Query("xlsx", pattern="^(xlsx|csv)$", description="File format: xlsx or csv"),
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> Response:
    """Download a member roster spreadsheet template with headers and choice validation."""
    fields = list_group_fields(session, group.id)
    content, media_type, filename = generate_template_file(fields, format)

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post(
    "/{group_id}/members/import/preview",
    response_model=ImportPreviewResponse,
)
def preview_members_import(
    group_id: UUID,
    file: UploadFile = File(...),
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> ImportPreviewResponse:
    """Upload a spreadsheet to preview headers, total rows, sample rows, and suggested mapping."""
    content = read_upload_capped(file)
    filename = file.filename or "uploaded.xlsx"
    fields = list_group_fields(session, group.id)

    preview_data = preview_import_data(filename, content, fields)
    return ImportPreviewResponse.model_validate(preview_data)


@router.post(
    "/{group_id}/members/import",
    response_model=ImportResultResponse,
)
def import_group_members(
    group_id: UUID,
    file: UploadFile = File(...),
    mapping: str = Form(...),
    new_fields: str | None = Form(None),
    dry_run: bool = Form(False),
    on_duplicate: str = Form("reject"),
    group: Group = Depends(require_admin_for_group),
    session: Session = Depends(get_db),
) -> ImportResultResponse:
    """Import members in bulk from spreadsheet with all-or-nothing validation."""
    # Parse mapping JSON
    try:
        mapping_data = json.loads(mapping)
        if not isinstance(mapping_data, dict):
            raise ValueError
    except Exception:
        raise PollValidationError("Field 'mapping' must be a valid JSON object.")

    # Parse optional new_fields JSON
    new_fields_data = None
    if new_fields is not None and new_fields.strip():
        try:
            new_fields_data = json.loads(new_fields)
            if not isinstance(new_fields_data, list):
                raise ValueError
        except Exception:
            raise PollValidationError("Field 'new_fields' must be a valid JSON list.")

    content = read_upload_capped(file)
    filename = file.filename or "uploaded.xlsx"

    result = execute_spreadsheet_import(
        session=session,
        group=group,
        filename=filename,
        content=content,
        mapping=mapping_data,
        new_fields_data=new_fields_data,
        dry_run=dry_run,
        on_duplicate=on_duplicate,
    )

    return ImportResultResponse.model_validate(result)
