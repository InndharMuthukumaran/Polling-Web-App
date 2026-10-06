"""Add allow_name_list to groups

Revision ID: 004_claim_settings
Revises: 003_group_fields
Create Date: 2026-10-05 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "004_claim_settings"
down_revision: Union[str, None] = "003_group_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "groups",
        sa.Column("allow_name_list", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("groups", "allow_name_list")
