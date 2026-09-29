"""Add identity layer to groups and members

Revision ID: 002_identity
Revises: 001_initial_schema
Create Date: 2026-09-29 14:30:00.000000

"""
import secrets
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "002_identity"
down_revision: Union[str, None] = "001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add columns to groups (join_code initially nullable for backfill)
    op.add_column("groups", sa.Column("join_code", sa.String(length=32), nullable=True))
    op.add_column("groups", sa.Column("admin_token_hash", sa.String(length=64), nullable=True))
    op.add_column(
        "groups",
        sa.Column(
            "require_claim_approval",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )

    # 2. Backfill existing groups with unique join codes
    conn = op.get_bind()
    groups_table = sa.table(
        "groups",
        sa.column("id", sa.Uuid()),
        sa.column("join_code", sa.String()),
    )
    existing_rows = conn.execute(
        sa.select(groups_table.c.id).where(groups_table.c.join_code.is_(None))
    ).fetchall()

    used_codes: set[str] = set()
    for row in existing_rows:
        code = secrets.token_urlsafe(9)
        while code in used_codes:
            code = secrets.token_urlsafe(9)
        used_codes.add(code)
        conn.execute(
            sa.update(groups_table)
            .where(groups_table.c.id == row[0])
            .values(join_code=code)
        )

    # 3. Make join_code non-nullable and add unique constraint
    op.alter_column("groups", "join_code", nullable=False)
    op.create_unique_constraint("uq_groups_join_code", "groups", ["join_code"])

    # 4. Add columns and constraints to members
    op.add_column(
        "members",
        sa.Column(
            "claim_status",
            sa.String(length=20),
            server_default="unclaimed",
            nullable=False,
        ),
    )
    op.add_column(
        "members",
        sa.Column("member_token_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "members",
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_unique_constraint(
        "uq_members_member_token_hash", "members", ["member_token_hash"]
    )
    op.create_check_constraint(
        "ck_members_claim_status",
        "members",
        "claim_status IN ('unclaimed', 'pending', 'approved')",
    )


def downgrade() -> None:
    # 1. Revert members changes
    op.drop_constraint("ck_members_claim_status", "members", type_="check")
    op.drop_constraint("uq_members_member_token_hash", "members", type_="unique")
    op.drop_column("members", "claimed_at")
    op.drop_column("members", "member_token_hash")
    op.drop_column("members", "claim_status")

    # 2. Revert groups changes
    op.drop_constraint("uq_groups_join_code", "groups", type_="unique")
    op.drop_column("groups", "require_claim_approval")
    op.drop_column("groups", "admin_token_hash")
    op.drop_column("groups", "join_code")
