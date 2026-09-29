"""SQLAlchemy 2.0 ORM models for the polling application."""

from datetime import datetime, timezone
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
    Uuid,
)
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
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utc_now, nullable=False
    )

    members: Mapped[list["Member"]] = relationship(
        "Member", back_populates="group", cascade="all, delete-orphan"
    )
    polls: Mapped[list["Poll"]] = relationship(
        "Poll", back_populates="group", cascade="all, delete-orphan"
    )


class Member(Base):
    """A group member who can participate in polls."""

    __tablename__ = "members"
    __table_args__ = (
        UniqueConstraint(
            "group_id", "display_name", name="uq_members_group_display_name"
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
