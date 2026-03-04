"""FastAPI routes for /api/telegram/* endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.db.session import get_db
from app.api.middleware.bot_auth import verify_bot_api_key, verify_worker_api_key
from app.api.services.linking import create_link_code, confirm_link_code
from app.api.services.invite import generate_invite
from app.api.services.entitlement import get_user_tier
from app.models.telegram import TelegramAccount, TelegramSource
from app.core.config import settings

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


class LinkStartRequest(BaseModel):
    telegram_user_id: int
    telegram_username: str | None = None

class LinkConfirmRequest(BaseModel):
    code: str

class InviteRequest(BaseModel):
    telegram_user_id: int
    source_id: str

class PrefsRequest(BaseModel):
    telegram_user_id: int
    notifications_enabled: bool | None = None
    followed_providers: list[str] | None = None


@router.post("/link/start")
async def link_start(body: LinkStartRequest, db: AsyncSession = Depends(get_db), _: str = Depends(verify_bot_api_key)):
    try:
        lc = await create_link_code(db, body.telegram_user_id, body.telegram_username)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"code": lc.code, "link_url": f"{settings.WEB_BASE_URL}/telegram/link?code={lc.code}", "expires_at": lc.expires_at.isoformat()}


@router.post("/link/confirm")
async def link_confirm(body: LinkConfirmRequest, db: AsyncSession = Depends(get_db), user_id: str = Depends(lambda: "")):
    # NOTE: Replace lambda with your actual get_current_user_id dependency
    try:
        account = await confirm_link_code(db, body.code, user_id)
    except ValueError as e:
        code = str(e)
        status_map = {"CODE_NOT_FOUND": 404, "CODE_EXPIRED": 400, "CODE_ALREADY_USED": 400, "ALREADY_LINKED": 409}
        raise HTTPException(status_code=status_map.get(code, 400), detail=code)
    tier, expires = await get_user_tier(db, user_id)
    return {"linked": True, "telegram_user_id": account.telegram_user_id, "telegram_username": account.telegram_username, "tier": tier, "expires_at": expires}


@router.get("/me")
async def get_me(telegram_user_id: int = Query(...), db: AsyncSession = Depends(get_db), _: str = Depends(verify_bot_api_key)):
    result = await db.execute(select(TelegramAccount).where(TelegramAccount.telegram_user_id == telegram_user_id))
    account = result.scalar_one_or_none()
    if not account: return {"linked": False}
    tier, expires = await get_user_tier(db, str(account.user_id))
    return {"linked": True, "user_id": str(account.user_id), "tier": tier, "tier_expires_at": expires,
        "telegram_username": account.telegram_username, "linked_at": account.linked_at.isoformat(),
        "referral_code": None, "referral_count": 0,
        "preferences": {"notifications_enabled": True, "followed_providers": []}}


@router.get("/sources")
async def get_sources(telegram_user_id: int = Query(...), category: str | None = None,
    page: int = Query(1, ge=1), per_page: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db), _: str = Depends(verify_bot_api_key)):
    result = await db.execute(select(TelegramAccount).where(TelegramAccount.telegram_user_id == telegram_user_id))
    account = result.scalar_one_or_none()
    user_tier = "FREE"
    if account:
        tier, _ = await get_user_tier(db, str(account.user_id))
        user_tier = tier
    query = select(TelegramSource).where(TelegramSource.status == "active")
    count_q = select(func.count(TelegramSource.id)).where(TelegramSource.status == "active")
    if category:
        query = query.where(TelegramSource.category == category)
        count_q = count_q.where(TelegramSource.category == category)
    query = query.order_by(TelegramSource.sort_order).offset((page - 1) * per_page).limit(per_page)
    sources = (await db.execute(query)).scalars().all()
    total = (await db.execute(count_q)).scalar() or 0
    tier_order = {"FREE": 0, "PRO": 1, "ELITE": 2}
    return {"sources": [{"id": str(s.id), "name": s.name, "category": s.category, "tags": s.tags or [],
        "tier_min": s.tier_min, "locked": tier_order.get(user_tier, 0) < tier_order.get(s.tier_min, 0),
        "member_count": s.member_count, "provider_id": str(s.provider_id) if s.provider_id else None,
        "description": s.description} for s in sources], "total": total, "page": page, "per_page": per_page}


@router.post("/invite")
async def request_invite(body: InviteRequest, db: AsyncSession = Depends(get_db), _: str = Depends(verify_bot_api_key)):
    try:
        return await generate_invite(db, body.telegram_user_id, body.source_id)
    except ValueError as e:
        code = str(e)
        status_map = {"NOT_LINKED": 403, "ENTITLEMENT_EXPIRED": 403, "SOURCE_LOCKED": 403, "SOURCE_PAUSED": 403, "RATE_LIMITED": 429}
        raise HTTPException(status_code=status_map.get(code, 400), detail={"error": code, "message": code.replace("_", " ").title()})


@router.get("/signals/latest")
async def get_latest_signals(telegram_user_id: int = Query(...), provider_id: str | None = None,
    limit: int = Query(5, ge=1, le=20), db: AsyncSession = Depends(get_db), _: str = Depends(verify_bot_api_key)):
    # TODO: Wire to existing signal service
    return {"signals": []}

@router.get("/signals/{signal_id}/card")
async def get_signal_card(signal_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(verify_bot_api_key)):
    # TODO: Wire to existing signal service
    raise HTTPException(status_code=404, detail="Signal not found")

@router.get("/providers/{provider_id}/summary")
async def get_provider_summary(provider_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(verify_bot_api_key)):
    # TODO: Wire to existing provider analytics
    raise HTTPException(status_code=404, detail="Provider not found")

@router.post("/prefs")
async def update_prefs(body: PrefsRequest, db: AsyncSession = Depends(get_db), _: str = Depends(verify_bot_api_key)):
    return {"updated": True}


# Worker-only routes
worker_router = APIRouter(prefix="/internal/telegram", tags=["telegram-worker"])

@worker_router.post("/reconcile")
async def reconcile_user(body: dict, db: AsyncSession = Depends(get_db), _: str = Depends(verify_worker_api_key)):
    return {"actions_taken": []}

@worker_router.post("/revokeExpired")
async def revoke_expired(db: AsyncSession = Depends(get_db), _: str = Depends(verify_worker_api_key)):
    return {"revoked_count": 0}

@worker_router.post("/resyncMemberships")
async def resync(db: AsyncSession = Depends(get_db), _: str = Depends(verify_worker_api_key)):
    return {"synced": 0, "removed": 0, "errors": 0}
