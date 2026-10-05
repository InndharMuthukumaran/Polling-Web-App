"""Add group fields and member field values

Revision ID: 003_group_fields
Revises: 002_identity
Create Date: 2026-10-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "003_group_fields"
down_revision: Union[str, None] = "002_identity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create group_fields table
    op.create_table(
        "group_fields",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("field_type", sa.String(length=20), nullable=False),
        sa.Column("is_required", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("default_value", sa.Text(), nullable=True),
        sa.Column("choices", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_identifier", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_group_fields"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE", name="fk_group_fields_group_id"),
        sa.UniqueConstraint("group_id", "key", name="uq_group_fields_group_key"),
        sa.CheckConstraint("field_type IN ('text', 'number', 'choice', 'link')", name="ck_group_fields_field_type"),
    )
    op.create_index(
        "ix_group_fields_group_lower_name",
        "group_fields",
        ["group_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_index(
        "uq_group_fields_one_identifier",
        "group_fields",
        ["group_id"],
        unique=True,
        postgresql_where=sa.text("is_identifier IS TRUE"),
    )

    # 2. Update members table
    op.add_column(
        "members",
        sa.Column("field_values", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
    )
    op.add_column(
        "members",
        sa.Column("identifier_value", sa.String(length=500), nullable=True),
    )
    op.drop_constraint("uq_members_group_display_name", "members", type_="unique")
    op.create_index(
        "ix_members_group_identifier",
        "members",
        ["group_id", "identifier_value"],
        unique=True,
        postgresql_where=sa.text("identifier_value IS NOT NULL"),
    )


def downgrade() -> None:
    # 1. Revert members table
    op.drop_index("ix_members_group_identifier", table_name="members")
    op.create_unique_constraint("uq_members_group_display_name", "members", ["group_id", "display_name"])
    op.drop_column("members", "identifier_value")
    op.drop_column("members", "field_values")

    # 2. Drop group_fields table
    op.drop_index("uq_group_fields_one_identifier", table_name="group_fields")
    op.drop_index("ix_group_fields_group_lower_name", table_name="group_fields")
    op.drop_table("group_fields")
