"""SQLAlchemy models for Telegram integration tables."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    BigInteger, Column, DateTime, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint, JSON
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import relationship

from app.db.base import Base


class TelegramAccount(Base):
    __tablename__ = "telegram_accounts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    telegram_user_id = Column(BigInteger, unique=True, nullable=False, index=True)
    telegram_username = Column(String(255), nullable=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), unique=True, nullable=False, index=True)
    linked_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_seen_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    flags = Column(JSON, default=dict)
    user = relationship("User", back_populates="telegram_account")
    invites = relationship("TelegramInvite", back_populates="account")
    memberships = relationship("TelegramMembership", back_populates="account")


class TelegramLinkCode(Base):
    __tablename__ = "telegram_link_codes"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    code = Column(String(16), unique=True, nullable=False, index=True)
    telegram_user_id = Column(BigInteger, nullable=False, index=True)
    telegram_username = Column(String(255), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    used_by_user_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class TelegramSource(Base):
    __tablename__ = "telegram_sources"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name = Column(String(255), nullable=False)
    telegram_chat_id = Column(BigInteger, unique=True, nullable=False)
    telegram_username = Column(String(255), nullable=True)
    category = Column(String(50), nullable=False, index=True)
    tags = Column(ARRAY(String), default=list)
    tier_min = Column(String(20), default="FREE")
    status = Column(String(20), default="active", index=True)
    sort_order = Column(Integer, default=0)
    provider_id = Column(UUID(as_uuid=True), nullable=True)
    description = Column(Text, nullable=True)
    member_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    invites = relationship("TelegramInvite", back_populates="source")
    memberships = relationship("TelegramMembership", back_populates="source")
    __table_args__ = (Index("ix_telegram_sources_category_status", "category", "status"),)


class TelegramInvite(Base):
    __tablename__ = "telegram_invites"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    telegram_account_id = Column(UUID(as_uuid=True), ForeignKey("telegram_accounts.id"), nullable=False, index=True)
    source_id = Column(UUID(as_uuid=True), ForeignKey("telegram_sources.id"), nullable=False, index=True)
    invite_link = Column(String(512), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    used_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    revoke_reason = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    account = relationship("TelegramAccount", back_populates="invites")
    source = relationship("TelegramSource", back_populates="invites")


class TelegramMembership(Base):
    __tablename__ = "telegram_memberships"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    telegram_account_id = Column(UUID(as_uuid=True), ForeignKey("telegram_accounts.id"), nullable=False)
    source_id = Column(UUID(as_uuid=True), ForeignKey("telegram_sources.id"), nullable=False)
    joined_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    removed_at = Column(DateTime(timezone=True), nullable=True)
    remove_reason = Column(String(255), nullable=True)
    status = Column(String(20), default="active", index=True)
    account = relationship("TelegramAccount", back_populates="memberships")
    source = relationship("TelegramSource", back_populates="memberships")
    __table_args__ = (UniqueConstraint("telegram_account_id", "source_id", name="uq_membership_account_source"),)


class TelegramAuditLog(Base):
    __tablename__ = "telegram_audit_logs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    action = Column(String(50), nullable=False)
    actor_type = Column(String(20), nullable=False)
    actor_id = Column(String(255), nullable=True)
    target_type = Column(String(50), nullable=True)
    target_id = Column(String(255), nullable=True)
    metadata = Column(JSON, default=dict)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    __table_args__ = (
        Index("ix_audit_action_created", "action", "created_at"),
        Index("ix_audit_actor", "actor_id"),
        Index("ix_audit_target", "target_id"),
    )


class Referral(Base):
    __tablename__ = "referrals"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    referrer_user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    referred_user_id = Column(UUID(as_uuid=True), nullable=True)
    referral_code = Column(String(32), unique=True, nullable=False, index=True)
    reward_type = Column(String(20), default="free_days")
    reward_value = Column(Integer, default=7)
    status = Column(String(20), default="pending")
    claimed_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
