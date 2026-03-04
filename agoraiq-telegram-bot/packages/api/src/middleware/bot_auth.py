"""Middleware to authenticate bot and worker requests."""

from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_403_FORBIDDEN
from app.core.config import settings

security = HTTPBearer()

async def verify_bot_api_key(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> str:
    if credentials.credentials != settings.TELEGRAM_INTERNAL_API_KEY:
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Invalid internal API key")
    return credentials.credentials

async def verify_worker_api_key(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> str:
    if credentials.credentials != settings.TELEGRAM_WORKER_API_KEY:
        raise HTTPException(status_code=HTTP_403_FORBIDDEN, detail="Invalid worker API key")
    return credentials.credentials
