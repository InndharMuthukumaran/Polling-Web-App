"""Add built-in Name field and customisable display name format

Revision ID: 006_display_format
Revises: 005_poll_fields
Create Date: 2026-10-27 12:00:00.000000

"""
from datetime import datetime, timezone
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "006_display_format"
down_revision: Union[str, None] = "005_poll_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add display_format column to groups
    op.add_column(
        "groups",
        sa.Column(
            "display_format",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text('\'{"parts": ["_name"], "separator": " - "}\'::jsonb'),
            nullable=False,
        ),
    )

    # 2. Add is_builtin column to group_fields
    op.add_column(
        "group_fields",
        sa.Column(
            "is_builtin",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )

    # 3. Data migration for existing groups
    conn = op.get_bind()

    # Query all existing groups
    group_rows = conn.execute(sa.text("SELECT id FROM groups")).fetchall()

    now = datetime.now(timezone.utc)

    for (gid,) in group_rows:
        # Shift positions of existing fields up by 1
        conn.execute(
            sa.text("UPDATE group_fields SET position = position + 1 WHERE group_id = :gid"),
            {"gid": gid},
        )

        # Find existing field names ignoring case
        field_rows = conn.execute(
            sa.text("SELECT name FROM group_fields WHERE group_id = :gid"),
            {"gid": gid},
        ).fetchall()
        existing_names = {r[0].casefold() for r in field_rows}

        if "name" not in existing_names:
            chosen_name = "Name"
        elif "member name" not in existing_names:
            chosen_name = "Member name"
        else:
            counter = 2
            while f"member name {counter}" in existing_names:
                counter += 1
            chosen_name = f"Member name {counter}"

        # Insert built-in _name field at position 1
        new_field_id = uuid.uuid4()
        conn.execute(
            sa.text(
                "INSERT INTO group_fields "
                "(id, group_id, key, name, field_type, is_required, default_value, choices, is_identifier, position, created_at, is_builtin) "
                "VALUES (:id, :gid, '_name', :name, 'text', true, null, null, false, 1, :now, true)"
            ),
            {
                "id": new_field_id,
                "gid": gid,
                "name": chosen_name,
                "now": now,
            },
        )

        # Copy every member's current display_name into field_values["_name"]
        conn.execute(
            sa.text(
                "UPDATE members "
                "SET field_values = jsonb_set(COALESCE(field_values, '{}'::jsonb), '{_name}', to_jsonb(display_name)) "
                "WHERE group_id = :gid"
            ),
            {"gid": gid},
        )


def downgrade() -> None:
    conn = op.get_bind()

    # 1. Delete built-in fields
    conn.execute(sa.text("DELETE FROM group_fields WHERE is_builtin = true"))

    # 2. Shift remaining fields position down by 1
    conn.execute(sa.text("UPDATE group_fields SET position = position - 1"))

    # 3. Remove _name from member field_values
    conn.execute(sa.text("UPDATE members SET field_values = field_values - '_name'"))

    # 4. Drop is_builtin column from group_fields
    op.drop_column("group_fields", "is_builtin")

    # 5. Drop display_format column from groups
    op.drop_column("groups", "display_format")
