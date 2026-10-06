"""Group fields management and value validation service."""

from datetime import datetime, timezone
import math
import re
from typing import Any, Protocol, Sequence, runtime_checkable
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import (
    FieldNotFoundError,
    GroupNotFoundError,
    PollValidationError,
)
from app.models import Group, GroupField, Member


@runtime_checkable
class FieldLike(Protocol):
    """Protocol for field-like objects (GroupField or PollField)."""

    key: str
    name: str
    field_type: str
    is_required: bool
    default_value: str | None
    choices: list[str] | None


def resolve_uuid(val: uuid.UUID | str) -> uuid.UUID:
    """Resolve a UUID from either UUID or string representation."""
    if isinstance(val, uuid.UUID):
        return val
    return uuid.UUID(str(val))


def is_blank(val: Any) -> bool:
    """Return True if a value is missing, null, or only whitespace."""
    if val is None:
        return True
    if isinstance(val, str) and not val.strip():
        return True
    return False


def normalize_identifier(val: str) -> str:
    """Normalize identifier: trim, collapse inner whitespace to single spaces, casefold."""
    trimmed = val.strip()
    collapsed = " ".join(trimmed.split())
    return collapsed.casefold()


def generate_field_key(name: str, existing_keys: set[str]) -> str:
    """Generate a unique key for a field from its name.

    Lowercase, runs of non-letters and non-digits become '_', trimmed of '_',
    with '_2', '_3' appended if already taken. Never changes when renamed.
    """
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    base = s.strip("_")
    if not base:
        base = "field"

    # Truncate base to 70 chars to leave space for suffix
    base = base[:70]

    key = base
    counter = 2
    while key in existing_keys:
        key = f"{base}_{counter}"
        counter += 1
    return key


def validate_choices(choices: Any) -> list[str]:
    """Validate choices for a choice field: 2 to 50 unique items, 1 to 100 chars each."""
    if not isinstance(choices, list):
        raise PollValidationError("Choices must be a list of strings.")
    if len(choices) < 2 or len(choices) > 50:
        raise PollValidationError("A choice field must have between 2 and 50 choices.")

    seen: set[str] = set()
    cleaned: list[str] = []
    for item in choices:
        if not isinstance(item, str):
            raise PollValidationError("Each choice must be a string.")
        trimmed = item.strip()
        if not (1 <= len(trimmed) <= 100):
            raise PollValidationError(
                "Each choice must be between 1 and 100 characters."
            )
        cf = trimmed.casefold()
        if cf in seen:
            raise PollValidationError(f"Duplicate choice: '{trimmed}'.")
        seen.add(cf)
        cleaned.append(trimmed)

    return cleaned


def validate_and_canonicalize_value(
    field_type: str,
    val: Any,
    choices: list[str] | None = None,
    field_name: str | None = None,
) -> Any:
    """Validate a non-blank value for a given field type and return its canonical form."""
    label = field_name or "Field"

    if field_type == "text":
        if not isinstance(val, str):
            raise PollValidationError(f"{label} must be a text string.")
        trimmed = val.strip()
        if len(trimmed) > 500:
            raise PollValidationError(f"{label} must be at most 500 characters.")
        return trimmed

    elif field_type == "link":
        if not isinstance(val, str):
            raise PollValidationError(f"{label} must be a link string.")
        trimmed = val.strip()
        if len(trimmed) > 2000:
            raise PollValidationError(f"{label} link must be at most 2000 characters.")
        if " " in trimmed:
            raise PollValidationError(f"{label} link must not contain spaces.")
        if not (trimmed.startswith("http://") or trimmed.startswith("https://")):
            raise PollValidationError(
                f"{label} link must start with 'http://' or 'https://'."
            )
        return trimmed

    elif field_type == "choice":
        if not isinstance(val, str):
            raise PollValidationError(f"{label} must be a string matching a choice.")
        trimmed = val.strip()
        cf = trimmed.casefold()
        if choices:
            for c in choices:
                if c.casefold() == cf:
                    return c
        raise PollValidationError(
            f"Value '{trimmed}' for {label} is not one of the allowed choices."
        )

    elif field_type == "number":
        # Disallow booleans
        if isinstance(val, bool):
            raise PollValidationError(f"{label} must be a valid number.")

        if isinstance(val, (int, float)):
            if not math.isfinite(val):
                raise PollValidationError(f"{label} must be a finite number.")
            if isinstance(val, int) or val.is_integer():
                return int(val)
            return float(val)

        if isinstance(val, str):
            trimmed = val.strip()
            # Try integer first
            try:
                return int(trimmed)
            except ValueError:
                pass
            # Try float
            try:
                num = float(trimmed)
                if not math.isfinite(num):
                    raise PollValidationError(f"{label} must be a finite number.")
                if num.is_integer():
                    return int(num)
                return float(num)
            except ValueError:
                pass
            raise PollValidationError(f"'{val}' is not a valid number for {label}.")

        raise PollValidationError(f"{label} must be a valid number.")

    else:
        raise PollValidationError(f"Unsupported field type: {field_type}")


def parse_default_value(
    field_type: str,
    default_value: str | None,
    choices: list[str] | None,
) -> Any:
    """Validate and parse a default_value string into its typed representation for member field_values."""
    if is_blank(default_value):
        return None
    return validate_and_canonicalize_value(
        field_type, default_value, choices, field_name="default_value"
    )


def validate_field_definition(
    name: str,
    field_type: str,
    choices: list[str] | None = None,
    default_value: str | None = None,
    is_required: bool = False,
    is_identifier: bool = False,
) -> tuple[str, list[str] | None, str | None]:
    """Validate definition attributes common to GroupField and PollField.

    Returns (clean_name, clean_choices, clean_default_value_str).
    """
    if not isinstance(name, str) or not (1 <= len(name.strip()) <= 60):
        raise PollValidationError("Field name must be between 1 and 60 characters.")
    clean_name = name.strip()

    allowed_types = {"text", "number", "choice", "link"}
    if field_type not in allowed_types:
        raise PollValidationError(
            f"Invalid field_type '{field_type}'. Allowed types: {sorted(allowed_types)}."
        )

    # Choices validation
    clean_choices: list[str] | None = None
    if field_type == "choice":
        clean_choices = validate_choices(choices)
    elif choices is not None:
        raise PollValidationError(
            f"Field type '{field_type}' must not have choices."
        )

    # Identifier validation
    if is_identifier:
        if field_type != "text":
            raise PollValidationError("Only a text field can be the identifier.")
        if not is_blank(default_value):
            raise PollValidationError(
                "An identifier field cannot have a default value."
            )

    # Default value validation
    clean_default: str | None = None
    if not is_blank(default_value):
        validated_default = validate_and_canonicalize_value(
            field_type, default_value, clean_choices, field_name=clean_name
        )
        clean_default = str(validated_default)

    return clean_name, clean_choices, clean_default


# ---------------------------------------------------------------------------
# CRUD Services
# ---------------------------------------------------------------------------


def create_group_field(
    session: Session,
    group_id: uuid.UUID | str,
    name: str,
    field_type: str,
    is_required: bool = False,
    default_value: str | None = None,
    choices: list[str] | None = None,
    is_identifier: bool = False,
    commit: bool = True,
) -> GroupField:
    """Create a new group field with locking and validation."""
    gid = resolve_uuid(group_id)

    # Concurrency lock on group row
    group = session.scalar(
        select(Group).where(Group.id == gid).with_for_update()
    )
    if not group:
        raise GroupNotFoundError(f"Group {gid} not found.")

    existing_fields = list(
        session.scalars(
            select(GroupField)
            .where(GroupField.group_id == gid)
            .order_by(GroupField.position)
        ).all()
    )

    if len(existing_fields) >= 30:
        raise PollValidationError("A group can have at most 30 fields.")

    clean_name, clean_choices, clean_default = validate_field_definition(
        name,
        field_type,
        choices=choices,
        default_value=default_value,
        is_required=is_required,
        is_identifier=is_identifier,
    )

    # Unique per group ignoring case
    if any(f.name.casefold() == clean_name.casefold() for f in existing_fields):
        raise PollValidationError(
            f"Field with name '{clean_name}' already exists in group."
        )

    # Identifier validation against existing fields
    if is_identifier:
        if any(f.is_identifier for f in existing_fields):
            raise PollValidationError("Group already has an identifier field.")
        is_required = True

    # Check members count
    member_count = session.scalar(
        select(func.count()).select_from(Member).where(Member.group_id == gid)
    ) or 0

    if member_count > 0:
        if is_identifier:
            raise PollValidationError(
                "Cannot create a new field as the identifier while members exist. "
                "Add the field first, populate values, then update it to be the identifier."
            )
        if is_required and is_blank(clean_default):
            raise PollValidationError(
                f"Cannot add required field without default when {member_count} member(s) exist."
            )

    existing_keys = {f.key for f in existing_fields}
    key = generate_field_key(clean_name, existing_keys)
    position = len(existing_fields) + 1

    field = GroupField(
        id=uuid.uuid4(),
        group_id=gid,
        key=key,
        name=clean_name,
        field_type=field_type,
        is_required=is_required,
        default_value=clean_default,
        choices=clean_choices,
        is_identifier=is_identifier,
        position=position,
        created_at=datetime.now(timezone.utc),
    )
    session.add(field)

    # Adding a field with a default fills that default for all existing members
    if clean_default is not None and member_count > 0:
        typed_default = parse_default_value(field_type, clean_default, clean_choices)
        members = list(
            session.scalars(select(Member).where(Member.group_id == gid)).all()
        )
        for m in members:
            m.field_values = {**m.field_values, key: typed_default}

    if commit:
        session.commit()
        session.refresh(field)
    else:
        session.flush()
    return field


def update_group_field(
    session: Session,
    group_id: uuid.UUID | str,
    field_id: uuid.UUID | str,
    name: str | None = None,
    is_required: bool | None = None,
    default_value: str | None = None,
    choices: list[str] | None = None,
    is_identifier: bool | None = None,
) -> GroupField:
    """Update an existing group field with full validation."""
    gid = resolve_uuid(group_id)
    fid = resolve_uuid(field_id)

    # Concurrency lock
    group = session.scalar(
        select(Group).where(Group.id == gid).with_for_update()
    )
    if not group:
        raise GroupNotFoundError(f"Group {gid} not found.")

    field = session.get(GroupField, fid)
    if not field or field.group_id != gid:
        raise FieldNotFoundError(f"Field {fid} not found in group {gid}.")

    all_fields = list(
        session.scalars(
            select(GroupField).where(GroupField.group_id == gid)
        ).all()
    )
    members = list(
        session.scalars(select(Member).where(Member.group_id == gid)).all()
    )

    # Name update
    if name is not None:
        if not isinstance(name, str) or not (1 <= len(name.strip()) <= 60):
            raise PollValidationError("Field name must be between 1 and 60 characters.")
        clean_name = name.strip()
        if any(
            f.id != fid and f.name.casefold() == clean_name.casefold()
            for f in all_fields
        ):
            raise PollValidationError(
                f"Field with name '{clean_name}' already exists in group."
            )
        field.name = clean_name

    # Choices update
    if choices is not None:
        if field.field_type != "choice":
            raise PollValidationError("Choices can only be set for choice fields.")
        clean_choices = validate_choices(choices)
        new_choices_cf = {c.casefold() for c in clean_choices}

        # Check existing members
        for m in members:
            val = (m.field_values or {}).get(field.key)
            if val is not None and not is_blank(val):
                if str(val).casefold() not in new_choices_cf:
                    raise PollValidationError(
                        f"Cannot update choices: member '{m.display_name}' holds value '{val}' "
                        "which is not in the new choices."
                    )
        field.choices = clean_choices

    # Default value update
    if default_value is not None:
        # Check if identifier
        will_be_identifier = is_identifier if is_identifier is not None else field.is_identifier
        if will_be_identifier and not is_blank(default_value):
            raise PollValidationError(
                "An identifier field cannot have a default value."
            )

        if is_blank(default_value):
            field.default_value = None
        else:
            val_choices = field.choices if choices is None else clean_choices
            validated = validate_and_canonicalize_value(
                field.field_type, default_value, val_choices, field_name=field.name
            )
            field.default_value = str(validated)
        # Rule: Changing default_value never changes existing members.

    # Required status update
    if is_required is not None:
        will_be_identifier = is_identifier if is_identifier is not None else field.is_identifier
        if will_be_identifier and not is_required:
            raise PollValidationError("An identifier field must be required.")

        if is_required and not field.is_required:
            # Making a field required checks every member has a value (or a default is given)
            effective_default = (
                field.default_value
                if default_value is None
                else (None if is_blank(default_value) else str(default_value))
            )
            for m in members:
                val = (m.field_values or {}).get(field.key)
                if is_blank(val):
                    if effective_default is not None:
                        # Backfill with default
                        typed = parse_default_value(
                            field.field_type, effective_default, field.choices
                        )
                        m.field_values = {**m.field_values, field.key: typed}
                    else:
                        raise PollValidationError(
                            f"Cannot make field '{field.name}' required: member "
                            f"'{m.display_name}' has no value and no default was provided."
                        )
        field.is_required = is_required

    # Identifier status update
    if is_identifier is not None:
        if is_identifier and not field.is_identifier:
            # Marking as identifier
            if field.field_type != "text":
                raise PollValidationError("Only a text field can be the identifier.")
            if any(f.is_identifier and f.id != fid for f in all_fields):
                raise PollValidationError("Group already has an identifier field.")
            if field.default_value is not None and not (default_value is not None and is_blank(default_value)):
                raise PollValidationError(
                    "An identifier field cannot have a default value."
                )

            # Check every member has a non-blank value and normalized values are unique
            details: list[dict] = []
            seen_norms: dict[str, str] = {}
            for m in members:
                raw_val = (m.field_values or {}).get(field.key)
                if is_blank(raw_val):
                    details.append({
                        "field": field.name,
                        "message": f"Member '{m.display_name}' has no value for identifier field.",
                    })
                else:
                    norm = normalize_identifier(str(raw_val))
                    if norm in seen_norms:
                        details.append({
                            "field": field.name,
                            "message": (
                                f"Duplicate identifier value '{raw_val}' for member '{m.display_name}' "
                                f"(conflicts with '{seen_norms[norm]}')."
                            ),
                        })
                    else:
                        seen_norms[norm] = m.display_name

            if details:
                raise PollValidationError(
                    "Cannot mark field as identifier due to missing or duplicate member values.",
                    details=details,
                )

            # Success: set identifier_value for all members and make field required
            for m in members:
                raw_val = (m.field_values or {}).get(field.key)
                m.identifier_value = normalize_identifier(str(raw_val))
            field.is_identifier = True
            field.is_required = True
            field.default_value = None

        elif not is_identifier and field.is_identifier:
            # Unmarking as identifier
            for m in members:
                m.identifier_value = None
            field.is_identifier = False
            # Rule: the field stays required
            field.is_required = True

    session.commit()
    session.refresh(field)
    return field


def delete_group_field(
    session: Session,
    group_id: uuid.UUID | str,
    field_id: uuid.UUID | str,
) -> None:
    """Delete a group field. Fails if identifier. Removes key from member field_values."""
    gid = resolve_uuid(group_id)
    fid = resolve_uuid(field_id)

    # Concurrency lock
    group = session.scalar(
        select(Group).where(Group.id == gid).with_for_update()
    )
    if not group:
        raise GroupNotFoundError(f"Group {gid} not found.")

    field = session.get(GroupField, fid)
    if not field or field.group_id != gid:
        raise FieldNotFoundError(f"Field {fid} not found in group {gid}.")

    if field.is_identifier:
        raise PollValidationError(
            "The identifier field cannot be deleted; unmark it first."
        )

    # Remove field's key from every member's field_values
    members = list(
        session.scalars(select(Member).where(Member.group_id == gid)).all()
    )
    for m in members:
        if m.field_values and field.key in m.field_values:
            m.field_values = {
                k: v for k, v in m.field_values.items() if k != field.key
            }

    session.delete(field)
    session.commit()


def list_group_fields(
    session: Session,
    group_id: uuid.UUID | str,
) -> list[GroupField]:
    """List all fields of a group ordered by position."""
    gid = resolve_uuid(group_id)
    group = session.get(Group, gid)
    if not group:
        raise GroupNotFoundError(f"Group {gid} not found.")

    return list(
        session.scalars(
            select(GroupField)
            .where(GroupField.group_id == gid)
            .order_by(GroupField.position)
        ).all()
    )


# ---------------------------------------------------------------------------
# Member Field Values Validation for Add & Update
# ---------------------------------------------------------------------------


def validate_member_values_for_create(
    fields: Sequence[FieldLike],
    raw_values: dict[str, Any] | None,
    row: int | None = None,
) -> tuple[dict[str, Any], str | None]:
    """Validate and canonicalize field values for creating a new member.

    Fills defaults, checks required fields, and returns (canonical_values, identifier_value).
    """
    raw_values = raw_values or {}
    field_map = {f.key: f for f in fields}

    # 1. Unknown keys check
    for k in raw_values:
        if k not in field_map:
            raise PollValidationError(
                f"Unknown field key: '{k}'.",
                details=[{"row": row, "field": k, "message": f"Unknown field key: '{k}'."}]
                if row is not None
                else None,
            )

    cleaned_values: dict[str, Any] = {}
    identifier_val: str | None = None

    for field in fields:
        raw_val = raw_values.get(field.key)
        if is_blank(raw_val):
            if field.default_value is not None:
                cleaned_values[field.key] = parse_default_value(
                    field.field_type, field.default_value, field.choices
                )
            elif field.is_required:
                raise PollValidationError(
                    f"Field '{field.name}' is required.",
                    details=[
                        {
                            "row": row,
                            "field": field.name,
                            "message": f"Field '{field.name}' is required.",
                        }
                    ]
                    if row is not None
                    else None,
                )
        else:
            try:
                canonical = validate_and_canonicalize_value(
                    field.field_type, raw_val, field.choices, field_name=field.name
                )
                cleaned_values[field.key] = canonical
            except PollValidationError as exc:
                raise PollValidationError(
                    exc.message,
                    details=[{"row": row, "field": field.name, "message": exc.message}]
                    if row is not None
                    else None,
                )

        if getattr(field, "is_identifier", False):
            id_val = cleaned_values.get(field.key)
            if is_blank(id_val):
                raise PollValidationError(
                    f"Identifier field '{field.name}' is required.",
                    details=[
                        {
                            "row": row,
                            "field": field.name,
                            "message": f"Identifier field '{field.name}' is required.",
                        }
                    ]
                    if row is not None
                    else None,
                )
            identifier_val = normalize_identifier(str(id_val))

    return cleaned_values, identifier_val


def validate_member_values_for_update(
    fields: Sequence[FieldLike],
    current_values: dict[str, Any],
    new_values: dict[str, Any],
) -> tuple[dict[str, Any], str | None]:
    """Validate partial update of member field values.

    Only keys sent are changed; sending blank resets to default or removes if no default.
    Returns (updated_field_values, updated_identifier_value).
    """
    field_map = {f.key: f for f in fields}

    # Check unknown keys
    for k in new_values:
        if k not in field_map:
            raise PollValidationError(f"Unknown field key: '{k}'.")

    updated = {**current_values}

    for k, val in new_values.items():
        field = field_map[k]
        if is_blank(val):
            if field.default_value is not None:
                updated[k] = parse_default_value(
                    field.field_type, field.default_value, field.choices
                )
            elif field.is_required:
                raise PollValidationError(
                    f"Field '{field.name}' is required and cannot be blank."
                )
            else:
                updated.pop(k, None)
        else:
            canonical = validate_and_canonicalize_value(
                field.field_type, val, field.choices, field_name=field.name
            )
            updated[k] = canonical

    # Recalculate identifier if an identifier field exists
    identifier_val: str | None = None
    id_field = next((f for f in fields if getattr(f, "is_identifier", False)), None)
    if id_field:
        val = updated.get(id_field.key)
        if is_blank(val):
            raise PollValidationError(
                f"Identifier field '{id_field.name}' is required and cannot be blank."
            )
        identifier_val = normalize_identifier(str(val))

    return updated, identifier_val


def validate_answers_for_update(
    fields: Sequence[FieldLike],
    current_values: dict[str, Any],
    new_values: dict[str, Any],
) -> dict[str, Any]:
    """Validate partial update of poll answers.

    Only keys sent change; blank resets to field default or removes if no default.
    Unknown keys and invalid values raise PollValidationError with row-level details (field=name).
    """
    field_map = {f.key: f for f in fields}

    # 1. Unknown keys check
    for k in new_values:
        if k not in field_map:
            raise PollValidationError(
                f"Unknown field key: '{k}'.",
                details=[{"field": k, "message": f"Unknown field key: '{k}'."}],
            )

    updated = {**current_values}

    for k, val in new_values.items():
        field = field_map[k]
        if is_blank(val):
            if field.default_value is not None:
                updated[k] = parse_default_value(
                    field.field_type, field.default_value, field.choices
                )
            else:
                updated.pop(k, None)
        else:
            try:
                canonical = validate_and_canonicalize_value(
                    field.field_type, val, field.choices, field_name=field.name
                )
                updated[k] = canonical
            except PollValidationError as exc:
                raise PollValidationError(
                    exc.message,
                    details=[{"field": field.name, "message": exc.message}],
                )

    return updated
