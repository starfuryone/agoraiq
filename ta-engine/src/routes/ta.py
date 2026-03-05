from fastapi import APIRouter, Query, HTTPException
from typing import Optional, List
from datetime import datetime, timezone

from src.models.schemas import TASnapshot, TAEvent, BatchRequest, BatchResponse
from src.services.compute import compute_snapshot, compute_events
from src.config.settings import settings

router = APIRouter(prefix="/ta", tags=["Technical Analysis"])


@router.get("/snapshot", response_model=TASnapshot)
async def get_snapshot(
    symbol: str = Query(..., description="Trading pair e.g. BTC/USDT"),
    tf: str = Query("1h", description="Timeframe: 15m, 1h, 4h, 1d"),
    exchange: Optional[str] = Query(None, description="Exchange override"),
):
    """Get full TA snapshot for a symbol/timeframe."""
    symbol = symbol.upper().replace("USDT", "/USDT").replace("BTC", "/BTC") if "/" not in symbol else symbol
    if tf not in ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w"]:
        raise HTTPException(400, f"Invalid timeframe: {tf}")

    snap = await compute_snapshot(symbol, tf, exchange)
    if not snap:
        raise HTTPException(404, f"No data for {symbol} on {tf}")
    return snap


@router.get("/events", response_model=List[TAEvent])
async def get_events(
    symbol: str = Query(..., description="Trading pair e.g. BTC/USDT"),
    tf: str = Query("15m", description="Timeframe"),
    since: Optional[str] = Query(None, description="ISO datetime filter"),
    exchange: Optional[str] = Query(None),
):
    """Get detected TA events for a symbol."""
    symbol = symbol.upper().replace("USDT", "/USDT").replace("BTC", "/BTC") if "/" not in symbol else symbol
    events = await compute_events(symbol, tf, exchange)

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            events = [e for e in events if e.detected_at >= since_dt]
        except ValueError:
            raise HTTPException(400, "Invalid 'since' datetime format")

    return events


@router.post("/batch", response_model=BatchResponse)
async def batch_compute(req: BatchRequest):
    """Compute TA for multiple symbols/timeframes at once."""
    if len(req.symbols) > 50:
        raise HTTPException(400, "Max 50 symbols per batch")
    if len(req.timeframes) > 4:
        raise HTTPException(400, "Max 4 timeframes per batch")

    snapshots: List[TASnapshot] = []
    events: List[TAEvent] = []

    for symbol in req.symbols:
        sym = symbol.upper().replace("USDT", "/USDT").replace("BTC", "/BTC") if "/" not in symbol else symbol
        for tf in req.timeframes:
            snap = await compute_snapshot(sym, tf)
            if snap:
                snapshots.append(snap)
                evts = await compute_events(sym, tf)
                events.extend(evts)

    return BatchResponse(
        snapshots=snapshots,
        events=events,
        computed_at=datetime.now(timezone.utc),
    )


@router.get("/symbols")
async def list_symbols():
    """List configured symbols."""
    return {"symbols": settings.SYMBOLS, "timeframes": settings.TIMEFRAMES}


@router.get("/health")
async def health():
    return {"status": "ok", "service": "agoraiq-ta-engine"}
