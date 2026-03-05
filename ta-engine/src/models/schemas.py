from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime


class IndicatorSnapshot(BaseModel):
    rsi_14: Optional[float] = None
    rsi_7: Optional[float] = None
    macd_line: Optional[float] = None
    macd_signal: Optional[float] = None
    macd_histogram: Optional[float] = None
    ema_9: Optional[float] = None
    ema_21: Optional[float] = None
    ema_50: Optional[float] = None
    ema_200: Optional[float] = None
    sma_50: Optional[float] = None
    sma_200: Optional[float] = None
    bb_upper: Optional[float] = None
    bb_middle: Optional[float] = None
    bb_lower: Optional[float] = None
    bb_bandwidth: Optional[float] = None
    bb_pctb: Optional[float] = None
    atr_14: Optional[float] = None
    adx_14: Optional[float] = None
    stoch_k: Optional[float] = None
    stoch_d: Optional[float] = None
    obv: Optional[float] = None
    vwap: Optional[float] = None
    ichimoku_tenkan: Optional[float] = None
    ichimoku_kijun: Optional[float] = None
    ichimoku_senkou_a: Optional[float] = None
    ichimoku_senkou_b: Optional[float] = None


class MarketContext(BaseModel):
    trend: str               # "bullish", "bearish", "neutral"
    trend_strength: str      # "strong", "moderate", "weak"
    regime: str              # "trending", "ranging", "volatile"
    momentum: str            # "accelerating", "decelerating", "flat"
    volatility: str          # "high", "normal", "low"
    key_levels: Dict[str, float]  # support/resistance


class TASnapshot(BaseModel):
    symbol: str
    timeframe: str
    exchange: str
    price: float
    open_24h: Optional[float] = None
    high_24h: Optional[float] = None
    low_24h: Optional[float] = None
    volume_24h: Optional[float] = None
    change_pct_24h: Optional[float] = None
    indicators: IndicatorSnapshot
    context: MarketContext
    timestamp: datetime
    candle_ts: datetime       # last candle timestamp


class TAEvent(BaseModel):
    id: str
    symbol: str
    timeframe: str
    event_type: str           # rsi_oversold, golden_cross, bb_squeeze, etc.
    severity: str             # "info", "warning", "critical"
    title: str
    description: str
    indicator_values: Dict[str, Any]
    price_at_event: float
    detected_at: datetime


class BatchRequest(BaseModel):
    symbols: List[str]
    timeframes: List[str] = ["1h"]


class BatchResponse(BaseModel):
    snapshots: List[TASnapshot]
    events: List[TAEvent]
    computed_at: datetime
