import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.routes.ta import router as ta_router
from src.services.scanner import start_scanner
from src.config.settings import settings

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("ta-engine")

_scanner_task = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scanner_task
    log.info(f"TA Engine starting on :{settings.PORT}")
    log.info(f"Tracking {len(settings.SYMBOLS)} symbols across {len(settings.TIMEFRAMES)} timeframes")
    _scanner_task = asyncio.create_task(start_scanner())
    yield
    if _scanner_task:
        _scanner_task.cancel()
        try:
            await _scanner_task
        except asyncio.CancelledError:
            pass
    log.info("TA Engine stopped")


app = FastAPI(
    title="AgoraIQ TA Engine",
    description="Technical Analysis microservice — computes indicators, detects events, enriches signals",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ta_router)


@app.get("/health")
async def root_health():
    return {"status": "ok", "service": "agoraiq-ta-engine", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host=settings.HOST, port=settings.PORT, reload=False)
