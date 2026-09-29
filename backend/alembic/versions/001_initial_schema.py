"""Initial database schema migration

Revision ID: 001_initial_schema
Revises: 
Create Date: 2026-09-29 11:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. groups
    op.create_table(
        "groups",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # 2. members
    op.create_table(
        "members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE", name="fk_members_group_id"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("group_id", "display_name", name="uq_members_group_display_name"),
    )
    op.create_index("ix_members_group_id", "members", ["group_id"], unique=False)

    # 3. polls
    op.create_table(
        "polls",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description_raw", sa.Text(), nullable=True),
        sa.Column("description_final", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="open", nullable=False),
        sa.Column("allow_multiple", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completion_time_mode", sa.String(length=20), server_default="last", nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('open', 'closed')", name="ck_polls_status"),
        sa.CheckConstraint("completion_time_mode IN ('first', 'last')", name="ck_polls_completion_time_mode"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE", name="fk_polls_group_id"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_polls_group_id", "polls", ["group_id"], unique=False)

    # 4. poll_options
    op.create_table(
        "poll_options",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("poll_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role IN ('target', 'in_progress', 'excused', 'not_yet')", name="ck_poll_options_role"),
        sa.ForeignKeyConstraint(["poll_id"], ["polls.id"], ondelete="CASCADE", name="fk_poll_options_poll_id"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("poll_id", "label", name="uq_poll_options_poll_label"),
        sa.UniqueConstraint("poll_id", "position", name="uq_poll_options_poll_position"),
    )
    op.create_index("ix_poll_options_poll_id", "poll_options", ["poll_id"], unique=False)

    # 5. votes
    op.create_table(
        "votes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("poll_id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("option_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE", name="fk_votes_member_id"),
        sa.ForeignKeyConstraint(["option_id"], ["poll_options.id"], ondelete="CASCADE", name="fk_votes_option_id"),
        sa.ForeignKeyConstraint(["poll_id"], ["polls.id"], ondelete="CASCADE", name="fk_votes_poll_id"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("poll_id", "member_id", "option_id", name="uq_votes_poll_member_option"),
    )
    op.create_index("ix_votes_member_id", "votes", ["member_id"], unique=False)
    op.create_index("ix_votes_option_id", "votes", ["option_id"], unique=False)
    op.create_index("ix_votes_poll_id", "votes", ["poll_id"], unique=False)

    # 6. vote_history
    op.create_table(
        "vote_history",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("poll_id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("option_id", sa.Uuid(), nullable=False),
        sa.Column("first_selected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_selected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE", name="fk_vote_history_member_id"),
        sa.ForeignKeyConstraint(["option_id"], ["poll_options.id"], ondelete="CASCADE", name="fk_vote_history_option_id"),
        sa.ForeignKeyConstraint(["poll_id"], ["polls.id"], ondelete="CASCADE", name="fk_vote_history_poll_id"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("poll_id", "member_id", "option_id", name="uq_vote_history_poll_member_option"),
    )
    op.create_index("ix_vote_history_member_id", "vote_history", ["member_id"], unique=False)
    op.create_index("ix_vote_history_option_id", "vote_history", ["option_id"], unique=False)
    op.create_index("ix_vote_history_poll_id", "vote_history", ["poll_id"], unique=False)


def downgrade() -> None:
    op.drop_table("vote_history")
    op.drop_table("votes")
    op.drop_table("poll_options")
    op.drop_table("polls")
    op.drop_table("members")
    op.drop_table("groups")
