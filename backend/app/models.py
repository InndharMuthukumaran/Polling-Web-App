"""SQLAlchemy 2.0 ORM models for the polling application."""

from datetime import datetime, timezone
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class UTCDateTime(TypeDecorator):
    """DateTime type that guarantees timezone-aware UTC datetimes across all database dialects."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        if value is not None:
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc)
        return value

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        if value is not None:
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc)
        return value


def utc_now() -> datetime:
    """Return timezone-aware current UTC time."""
    return datetime.now(timezone.utc)


class Group(Base):
    """A group in which polls and members exist."""

    __tablename__ = "groups"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    join_code: Mapped[str] = mapped_column(
        String(32), unique=True, nullable=False
    )
    admin_token_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True
    )
    require_claim_approval: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    allow_name_list: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utc_now, nullable=False
    )

    fields: Mapped[list["GroupField"]] = relationship(
        "GroupField",
        back_populates="group",
        cascade="all, delete-orphan",
        order_by="GroupField.position",
    )
    members: Mapped[list["Member"]] = relationship(
        "Member", back_populates="group", cascade="all, delete-orphan"
    )
    polls: Mapped[list["Poll"]] = relationship(
        "Poll", back_populates="group", cascade="all, delete-orphan"
    )


class GroupField(Base):
    """A custom field defined for members within a group."""

    __tablename__ = "group_fields"
    __table_args__ = (
        UniqueConstraint("group_id", "key", name="uq_group_fields_group_key"),
        CheckConstraint(
            "field_type IN ('text', 'number', 'choice', 'link')",
            name="ck_group_fields_field_type",
        ),
        Index("ix_group_fields_group_lower_name", "group_id", text("lower(name)"), unique=True),
        Index(
            "uq_group_fields_one_identifier",
            "group_id",
            unique=True,
            postgresql_where=text("is_identifier IS TRUE"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    field_type: Mapped[str] = mapped_column(String(20), nullable=False)
    is_required: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    default_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    choices: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    is_identifier: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utc_now, nullable=False
    )

    group: Mapped["Group"] = relationship("Group", back_populates="fields")
    poll_inclusions: Mapped[list["PollIncludedField"]] = relationship(
        "PollIncludedField", back_populates="field", cascade="all, delete-orphan"
    )


class Member(Base):
    """A group member who can participate in polls."""

    __tablename__ = "members"
    __table_args__ = (
        CheckConstraint(
            "claim_status IN ('unclaimed', 'pending', 'approved')",
            name="ck_members_claim_status",
        ),
        Index(
            "ix_members_group_identifier",
            "group_id",
            "identifier_value",
            unique=True,
            postgresql_where=text("identifier_value IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )
    claim_status: Mapped[str] = mapped_column(
        String(20), default="unclaimed", nullable=False
    )
    member_token_hash: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True
    )
    claimed_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    field_values: Mapped[dict] = mapped_column(
        JSONB, default=dict, server_default="{}", nullable=False
    )
    identifier_value: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utc_now, nullable=False
    )

    group: Mapped["Group"] = relationship("Group", back_populates="members")
    votes: Mapped[list["Vote"]] = relationship(
        "Vote", back_populates="member", cascade="all, delete-orphan"
    )
    vote_history: Mapped[list["VoteHistory"]] = relationship(
        "VoteHistory", back_populates="member", cascade="all, delete-orphan"
    )
    poll_answers: Mapped[list["PollAnswer"]] = relationship(
        "PollAnswer", back_populates="member", cascade="all, delete-orphan"
    )

    @property
    def values(self) -> dict:
        return self.field_values if self.field_values is not None else {}

    @property
    def identifier(self) -> str | None:
        if getattr(self, "_identifier_override", None) is not None:
            return self._identifier_override
        if self.identifier_value is None:
            return None
        if self.group and hasattr(self.group, "fields"):
            for f in self.group.fields:
                if f.is_identifier:
                    val = (self.field_values or {}).get(f.key)
                    return str(val) if val is not None else None
        return None

    @identifier.setter
    def identifier(self, val: str | None) -> None:
        self._identifier_override = val


class Poll(Base):
    """A poll created within a group."""

    __tablename__ = "polls"
    __table_args__ = (
        CheckConstraint(
            "status IN ('open', 'closed')", name="ck_polls_status"
        ),
        CheckConstraint(
            "completion_time_mode IN ('first', 'last')",
            name="ck_polls_completion_time_mode",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_final: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), default="open", nullable=False
    )
    allow_multiple: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    deadline: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    completion_time_mode: Mapped[str] = mapped_column(
        String(20), default="last", nullable=False
    )
    closed_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utc_now, nullable=False
    )

    group: Mapped["Group"] = relationship("Group", back_populates="polls")
    options: Mapped[list["PollOption"]] = relationship(
        "PollOption",
        back_populates="poll",
        cascade="all, delete-orphan",
        order_by="PollOption.position",
    )
    votes: Mapped[list["Vote"]] = relationship(
        "Vote", back_populates="poll", cascade="all, delete-orphan"
    )
    vote_history: Mapped[list["VoteHistory"]] = relationship(
        "VoteHistory", back_populates="poll", cascade="all, delete-orphan"
    )
    included_fields: Mapped[list["PollIncludedField"]] = relationship(
        "PollIncludedField",
        back_populates="poll",
        cascade="all, delete-orphan",
        order_by="PollIncludedField.position",
    )
    poll_fields: Mapped[list["PollField"]] = relationship(
        "PollField",
        back_populates="poll",
        cascade="all, delete-orphan",
        order_by="PollField.position",
    )
    answers: Mapped[list["PollAnswer"]] = relationship(
        "PollAnswer", back_populates="poll", cascade="all, delete-orphan"
    )


class PollOption(Base):
    """An option available for selection in a poll."""

    __tablename__ = "poll_options"
    __table_args__ = (
        UniqueConstraint(
            "poll_id", "label", name="uq_poll_options_poll_label"
        ),
        UniqueConstraint(
            "poll_id", "position", name="uq_poll_options_poll_position"
        ),
        CheckConstraint(
            "role IN ('target', 'in_progress', 'excused', 'not_yet')",
            name="ck_poll_options_role",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    poll_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("polls.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utc_now, nullable=False
    )

    poll: Mapped["Poll"] = relationship("Poll", back_populates="options")
    votes: Mapped[list["Vote"]] = relationship(
        "Vote", back_populates="option", cascade="all, delete-orphan"
    )
    vote_history: Mapped[list["VoteHistory"]] = relationship(
        "VoteHistory", back_populates="option", cascade="all, delete-orphan"
    )


class Vote(Base):
    """A member's current active selection in a poll."""

    __tablename__ = "votes"
    __table_args__ = (
        UniqueConstraint(
            "poll_id", "member_id", "option_id", name="uq_votes_poll_member_option"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    poll_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("polls.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True
    )
    option_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("poll_options.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utc_now, nullable=False
    )

    poll: Mapped["Poll"] = relationship("Poll", back_populates="votes")
    member: Mapped["Member"] = relationship("Member", back_populates="votes")
    option: Mapped["PollOption"] = relationship(
        "PollOption", back_populates="votes"
    )


class VoteHistory(Base):
    """Historical record of when a member first and last selected an option."""

    __tablename__ = "vote_history"
    __table_args__ = (
        UniqueConstraint(
            "poll_id",
            "member_id",
            "option_id",
            name="uq_vote_history_poll_member_option",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    poll_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("polls.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True
    )
    option_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("poll_options.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    first_selected_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False
    )
    last_selected_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utc_now, nullable=False
    )

    poll: Mapped["Poll"] = relationship("Poll", back_populates="vote_history")
    member: Mapped["Member"] = relationship(
        "Member", back_populates="vote_history"
    )
    option: Mapped["PollOption"] = relationship(
        "PollOption", back_populates="vote_history"
    )


class PollIncludedField(Base):
    """Association linking a poll to an included group field, with display ordering."""

    __tablename__ = "poll_included_fields"

    poll_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("polls.id", ondelete="CASCADE"), primary_key=True
    )
    field_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("group_fields.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    poll: Mapped["Poll"] = relationship("Poll", back_populates="included_fields")
    field: Mapped["GroupField"] = relationship("GroupField", back_populates="poll_inclusions")

    @property
    def id(self) -> uuid.UUID:
        return self.field.id

    @property
    def key(self) -> str:
        return self.field.key

    @property
    def name(self) -> str:
        return self.field.name

    @property
    def field_type(self) -> str:
        return self.field.field_type


class PollField(Base):
    """A custom poll-only field answered by members for this poll."""

    __tablename__ = "poll_fields"
    __table_args__ = (
        UniqueConstraint("poll_id", "key", name="uq_poll_fields_poll_key"),
        CheckConstraint(
            "field_type IN ('text', 'number', 'choice', 'link')",
            name="ck_poll_fields_field_type",
        ),
        Index("ix_poll_fields_poll_lower_name", "poll_id", text("lower(name)"), unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    poll_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("polls.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    field_type: Mapped[str] = mapped_column(String(20), nullable=False)
    is_required: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    default_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    choices: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utc_now, nullable=False
    )

    poll: Mapped["Poll"] = relationship("Poll", back_populates="poll_fields")


class PollAnswer(Base):
    """Member answers to poll-only fields for a specific poll."""

    __tablename__ = "poll_answers"
    __table_args__ = (
        UniqueConstraint("poll_id", "member_id", name="uq_poll_answers_poll_member"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    poll_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("polls.id", ondelete="CASCADE"), nullable=False, index=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("members.id", ondelete="CASCADE"), nullable=False, index=True
    )
    values: Mapped[dict] = mapped_column(
        JSONB, default=dict, server_default="{}", nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utc_now, nullable=False
    )

    poll: Mapped["Poll"] = relationship("Poll", back_populates="answers")
    member: Mapped["Member"] = relationship("Member", back_populates="poll_answers")
