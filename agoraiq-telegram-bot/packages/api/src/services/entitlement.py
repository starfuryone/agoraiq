"""Entitlement checking service."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

TIER_HIERARCHY = {"FREE": 0, "PRO": 1, "ELITE": 2}

async def get_user_tier(db: AsyncSession, user_id: str) -> tuple[str, str | None]:
    from app.models.user import User
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user: return ("FREE", None)
    tier = getattr(user, "tier", "FREE")
    expires = getattr(user, "tier_expires_at", None)
    return (tier, expires.isoformat() if expires else None)

def tier_satisfies(user_tier: str, required_tier: str) -> bool:
    return TIER_HIERARCHY.get(user_tier, 0) >= TIER_HIERARCHY.get(required_tier, 0)
