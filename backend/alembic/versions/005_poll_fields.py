"""Add poll included fields, poll fields, and poll answers

Revision ID: 005_poll_fields
Revises: 004_claim_settings
Create Date: 2026-10-06 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "005_poll_fields"
down_revision: Union[str, None] = "004_claim_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create poll_included_fields table
    op.create_table(
        "poll_included_fields",
        sa.Column("poll_id", sa.Uuid(), nullable=False),
        sa.Column("field_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("poll_id", "field_id", name="pk_poll_included_fields"),
        sa.ForeignKeyConstraint(
            ["poll_id"], ["polls.id"], ondelete="CASCADE", name="fk_poll_included_fields_poll_id"
        ),
        sa.ForeignKeyConstraint(
            ["field_id"], ["group_fields.id"], ondelete="CASCADE", name="fk_poll_included_fields_field_id"
        ),
    )

    # 2. Create poll_fields table
    op.create_table(
        "poll_fields",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("poll_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("field_type", sa.String(length=20), nullable=False),
        sa.Column("is_required", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("default_value", sa.Text(), nullable=True),
        sa.Column("choices", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_poll_fields"),
        sa.ForeignKeyConstraint(
            ["poll_id"], ["polls.id"], ondelete="CASCADE", name="fk_poll_fields_poll_id"
        ),
        sa.UniqueConstraint("poll_id", "key", name="uq_poll_fields_poll_key"),
        sa.CheckConstraint(
            "field_type IN ('text', 'number', 'choice', 'link')", name="ck_poll_fields_field_type"
        ),
    )
    op.create_index(
        "ix_poll_fields_poll_id",
        "poll_fields",
        ["poll_id"],
        unique=False,
    )
    op.create_index(
        "ix_poll_fields_poll_lower_name",
        "poll_fields",
        ["poll_id", sa.text("lower(name)")],
        unique=True,
    )

    # 3. Create poll_answers table
    op.create_table(
        "poll_answers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("poll_id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("values", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_poll_answers"),
        sa.ForeignKeyConstraint(
            ["poll_id"], ["polls.id"], ondelete="CASCADE", name="fk_poll_answers_poll_id"
        ),
        sa.ForeignKeyConstraint(
            ["member_id"], ["members.id"], ondelete="CASCADE", name="fk_poll_answers_member_id"
        ),
        sa.UniqueConstraint("poll_id", "member_id", name="uq_poll_answers_poll_member"),
    )
    op.create_index(
        "ix_poll_answers_poll_id",
        "poll_answers",
        ["poll_id"],
        unique=False,
    )
    op.create_index(
        "ix_poll_answers_member_id",
        "poll_answers",
        ["member_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_poll_answers_member_id", table_name="poll_answers")
    op.drop_index("ix_poll_answers_poll_id", table_name="poll_answers")
    op.drop_table("poll_answers")

    op.drop_index("ix_poll_fields_poll_lower_name", table_name="poll_fields")
    op.drop_index("ix_poll_fields_poll_id", table_name="poll_fields")
    op.drop_table("poll_fields")

    op.drop_table("poll_included_fields")
