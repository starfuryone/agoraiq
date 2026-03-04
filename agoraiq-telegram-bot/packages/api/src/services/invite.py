"""Invite link generation using Telegram Bot API."""

from datetime import datetime, timedelta, timezone
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.core.config import settings
from app.models.telegram import TelegramAccount, TelegramInvite, TelegramSource, TelegramAuditLog

INVITE_EXPIRY_MINUTES = 30
MAX_INVITES_PER_HOUR = 5
TG_API = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}"

async def check_entitlement(db: AsyncSession, user_id: str, tier_min: str) -> bool:
    tier_order = {"FREE": 0, "PRO": 1, "ELITE": 2}
    from app.models.user import User
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user: return False
    return tier_order.get(getattr(user, "tier", "FREE"), 0) >= tier_order.get(tier_min, 0)

async def check_rate_limit(db: AsyncSession, account_id: str) -> bool:
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    result = await db.execute(select(func.count(TelegramInvite.id)).where(
        TelegramInvite.telegram_account_id == account_id, TelegramInvite.created_at >= one_hour_ago))
    return (result.scalar() or 0) < MAX_INVITES_PER_HOUR

async def create_invite_link(chat_id: int, expire_date: int, member_limit: int = 1) -> str:
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{TG_API}/createChatInviteLink", json={
            "chat_id": chat_id, "expire_date": expire_date, "member_limit": member_limit, "creates_join_request": False})
        resp.raise_for_status()
        return resp.json()["result"]["invite_link"]

async def generate_invite(db: AsyncSession, telegram_user_id: int, source_id: str) -> dict:
    result = await db.execute(select(TelegramAccount).where(TelegramAccount.telegram_user_id == telegram_user_id))
    account = result.scalar_one_or_none()
    if not account: raise ValueError("NOT_LINKED")
    result = await db.execute(select(TelegramSource).where(TelegramSource.id == source_id, TelegramSource.status == "active"))
    source = result.scalar_one_or_none()
    if not source: raise ValueError("SOURCE_PAUSED")
    if not await check_entitlement(db, account.user_id, source.tier_min): raise ValueError("SOURCE_LOCKED")
    if not await check_rate_limit(db, str(account.id)): raise ValueError("RATE_LIMITED")
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=INVITE_EXPIRY_MINUTES)
    invite_link = await create_invite_link(source.telegram_chat_id, int(expires_at.timestamp()))
    invite = TelegramInvite(telegram_account_id=str(account.id), source_id=source_id, invite_link=invite_link, expires_at=expires_at)
    db.add(invite)
    db.add(TelegramAuditLog(action="invite_created", actor_type="user", actor_id=str(account.user_id),
        target_type="source", target_id=source_id, metadata={"telegram_user_id": telegram_user_id, "invite_link": invite_link}))
    await db.commit()
    return {"invite_link": invite_link, "expires_at": expires_at.isoformat(), "source_name": source.name}
