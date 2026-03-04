"""Link code generation and confirmation."""

import secrets, string
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.telegram import TelegramAccount, TelegramLinkCode, TelegramAuditLog

LINK_CODE_LENGTH = 8
LINK_CODE_EXPIRY_MINUTES = 10
ALPHABET = string.ascii_uppercase + string.digits

def generate_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(LINK_CODE_LENGTH))

async def create_link_code(db: AsyncSession, telegram_user_id: int, telegram_username: str | None = None) -> TelegramLinkCode:
    existing = await db.execute(select(TelegramAccount).where(TelegramAccount.telegram_user_id == telegram_user_id))
    if existing.scalar_one_or_none():
        raise ValueError("ALREADY_LINKED")
    code = generate_code()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=LINK_CODE_EXPIRY_MINUTES)
    link_code = TelegramLinkCode(code=code, telegram_user_id=telegram_user_id, telegram_username=telegram_username, expires_at=expires_at)
    db.add(link_code)
    await db.commit()
    await db.refresh(link_code)
    return link_code

async def confirm_link_code(db: AsyncSession, code: str, user_id: str) -> TelegramAccount:
    result = await db.execute(select(TelegramLinkCode).where(TelegramLinkCode.code == code))
    link_code = result.scalar_one_or_none()
    if not link_code: raise ValueError("CODE_NOT_FOUND")
    if link_code.used_at: raise ValueError("CODE_ALREADY_USED")
    if link_code.expires_at < datetime.now(timezone.utc): raise ValueError("CODE_EXPIRED")
    existing = await db.execute(select(TelegramAccount).where(TelegramAccount.user_id == user_id))
    if existing.scalar_one_or_none(): raise ValueError("ALREADY_LINKED")
    link_code.used_at = datetime.now(timezone.utc)
    link_code.used_by_user_id = user_id
    account = TelegramAccount(telegram_user_id=link_code.telegram_user_id, telegram_username=link_code.telegram_username, user_id=user_id)
    db.add(account)
    db.add(TelegramAuditLog(action="link", actor_type="user", actor_id=user_id, target_type="telegram_account", target_id=str(link_code.telegram_user_id), metadata={"code": code}))
    await db.commit()
    await db.refresh(account)
    return account
