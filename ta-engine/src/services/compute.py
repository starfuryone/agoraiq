import pandas as pd
import numpy as np
import logging
from typing import List, Optional
from datetime import datetime, timezone
import uuid
import ta as ta_lib

from src.models.schemas import (
    IndicatorSnapshot, MarketContext, TASnapshot, TAEvent,
)
from src.services.exchange import fetch_ohlcv, get_current_price, get_24h_stats
from src.config.settings import settings

log = logging.getLogger("ta-engine.compute")


def compute_indicators(df: pd.DataFrame) -> IndicatorSnapshot:
    """Compute all TA indicators from OHLCV DataFrame."""
    c = df["close"]
    h = df["high"]
    l = df["low"]  # noqa: E741
    v = df["volume"]

    # RSI
    rsi_14 = ta_lib.momentum.RSIIndicator(c, window=14).rsi().iloc[-1]
    rsi_7 = ta_lib.momentum.RSIIndicator(c, window=7).rsi().iloc[-1]

    # MACD
    macd = ta_lib.trend.MACD(c, window_slow=26, window_fast=12, window_sign=9)
    macd_line = macd.macd().iloc[-1]
    macd_signal = macd.macd_signal().iloc[-1]
    macd_hist = macd.macd_diff().iloc[-1]

    # EMAs
    ema_9 = ta_lib.trend.EMAIndicator(c, window=9).ema_indicator().iloc[-1]
    ema_21 = ta_lib.trend.EMAIndicator(c, window=21).ema_indicator().iloc[-1]
    ema_50 = ta_lib.trend.EMAIndicator(c, window=50).ema_indicator().iloc[-1]
    ema_200 = ta_lib.trend.EMAIndicator(c, window=200).ema_indicator().iloc[-1] if len(c) >= 200 else None

    # SMAs
    sma_50 = ta_lib.trend.SMAIndicator(c, window=50).sma_indicator().iloc[-1]
    sma_200 = ta_lib.trend.SMAIndicator(c, window=200).sma_indicator().iloc[-1] if len(c) >= 200 else None

    # Bollinger Bands
    bb = ta_lib.volatility.BollingerBands(c, window=20, window_dev=2)
    bb_upper = bb.bollinger_hband().iloc[-1]
    bb_middle = bb.bollinger_mavg().iloc[-1]
    bb_lower = bb.bollinger_lband().iloc[-1]
    bb_bandwidth = (bb_upper - bb_lower) / bb_middle if bb_middle else None
    bb_pctb = bb.bollinger_pband().iloc[-1]

    # ATR
    atr_14 = ta_lib.volatility.AverageTrueRange(h, l, c, window=14).average_true_range().iloc[-1]

    # ADX
    adx_14 = ta_lib.trend.ADXIndicator(h, l, c, window=14).adx().iloc[-1]

    # Stochastic
    stoch = ta_lib.momentum.StochasticOscillator(h, l, c, window=14, smooth_window=3)
    stoch_k = stoch.stoch().iloc[-1]
    stoch_d = stoch.stoch_signal().iloc[-1]

    # OBV
    obv = ta_lib.volume.OnBalanceVolumeIndicator(c, v).on_balance_volume().iloc[-1]

    # VWAP (session-based approximation)
    tp = (h + l + c) / 3
    vwap = float((tp * v).cumsum().iloc[-1] / v.cumsum().iloc[-1]) if v.cumsum().iloc[-1] > 0 else None

    # Ichimoku
    ich = ta_lib.trend.IchimokuIndicator(h, l, window1=9, window2=26, window3=52)
    ichimoku_tenkan = ich.ichimoku_conversion_line().iloc[-1]
    ichimoku_kijun = ich.ichimoku_base_line().iloc[-1]
    ichimoku_senkou_a = ich.ichimoku_a().iloc[-1]
    ichimoku_senkou_b = ich.ichimoku_b().iloc[-1]

    def _f(v):
        """Safely convert to float, handling NaN."""
        if v is None or (isinstance(v, float) and np.isnan(v)):
            return None
        return round(float(v), 6)

    return IndicatorSnapshot(
        rsi_14=_f(rsi_14), rsi_7=_f(rsi_7),
        macd_line=_f(macd_line), macd_signal=_f(macd_signal), macd_histogram=_f(macd_hist),
        ema_9=_f(ema_9), ema_21=_f(ema_21), ema_50=_f(ema_50), ema_200=_f(ema_200),
        sma_50=_f(sma_50), sma_200=_f(sma_200),
        bb_upper=_f(bb_upper), bb_middle=_f(bb_middle), bb_lower=_f(bb_lower),
        bb_bandwidth=_f(bb_bandwidth), bb_pctb=_f(bb_pctb),
        atr_14=_f(atr_14), adx_14=_f(adx_14),
        stoch_k=_f(stoch_k), stoch_d=_f(stoch_d),
        obv=_f(obv), vwap=_f(vwap),
        ichimoku_tenkan=_f(ichimoku_tenkan), ichimoku_kijun=_f(ichimoku_kijun),
        ichimoku_senkou_a=_f(ichimoku_senkou_a), ichimoku_senkou_b=_f(ichimoku_senkou_b),
    )


def derive_context(df: pd.DataFrame, ind: IndicatorSnapshot) -> MarketContext:
    """Derive market context from indicators."""
    price = float(df["close"].iloc[-1])

    # Trend: EMA stack
    bullish_signals = 0
    bearish_signals = 0

    if ind.ema_9 and ind.ema_21:
        if ind.ema_9 > ind.ema_21:
            bullish_signals += 1
        else:
            bearish_signals += 1

    if ind.ema_50 and price > ind.ema_50:
        bullish_signals += 1
    elif ind.ema_50:
        bearish_signals += 1

    if ind.ema_200 and price > ind.ema_200:
        bullish_signals += 1
    elif ind.ema_200:
        bearish_signals += 1

    if ind.macd_histogram and ind.macd_histogram > 0:
        bullish_signals += 1
    elif ind.macd_histogram:
        bearish_signals += 1

    if ind.ichimoku_tenkan and ind.ichimoku_kijun:
        if ind.ichimoku_tenkan > ind.ichimoku_kijun:
            bullish_signals += 1
        else:
            bearish_signals += 1

    total = bullish_signals + bearish_signals
    if total == 0:
        trend, strength = "neutral", "weak"
    elif bullish_signals > bearish_signals:
        trend = "bullish"
        strength = "strong" if bullish_signals >= 4 else "moderate" if bullish_signals >= 3 else "weak"
    elif bearish_signals > bullish_signals:
        trend = "bearish"
        strength = "strong" if bearish_signals >= 4 else "moderate" if bearish_signals >= 3 else "weak"
    else:
        trend, strength = "neutral", "weak"

    # Regime: ADX-based
    adx = ind.adx_14 or 0
    if adx >= 25:
        regime = "trending"
    elif ind.bb_bandwidth and ind.bb_bandwidth < settings.BB_SQUEEZE_THRESHOLD:
        regime = "ranging"
    else:
        regime = "volatile" if adx < 15 and (ind.atr_14 or 0) > 0 else "ranging"

    # Momentum: MACD histogram direction
    if ind.macd_histogram:
        hist = ind.macd_histogram
        # Check histogram direction over last few bars
        macd_ind = ta_lib.trend.MACD(df["close"])
        hist_series = macd_ind.macd_diff()
        if len(hist_series) >= 3:
            recent = hist_series.iloc[-3:].values
            if all(recent[i] > recent[i - 1] for i in range(1, len(recent))):
                momentum = "accelerating"
            elif all(recent[i] < recent[i - 1] for i in range(1, len(recent))):
                momentum = "decelerating"
            else:
                momentum = "flat"
        else:
            momentum = "flat"
    else:
        momentum = "flat"

    # Volatility
    if ind.bb_bandwidth:
        if ind.bb_bandwidth > 0.06:
            volatility = "high"
        elif ind.bb_bandwidth < 0.02:
            volatility = "low"
        else:
            volatility = "normal"
    else:
        volatility = "normal"

    # Key levels
    key_levels = {}
    if ind.ema_200:
        key_levels["ema_200"] = ind.ema_200
    if ind.sma_200:
        key_levels["sma_200"] = ind.sma_200
    if ind.bb_upper:
        key_levels["bb_upper"] = ind.bb_upper
    if ind.bb_lower:
        key_levels["bb_lower"] = ind.bb_lower
    if ind.ichimoku_senkou_a:
        key_levels["ichimoku_cloud_top"] = max(ind.ichimoku_senkou_a, ind.ichimoku_senkou_b or 0)
        key_levels["ichimoku_cloud_bottom"] = min(ind.ichimoku_senkou_a, ind.ichimoku_senkou_b or float("inf"))

    # Recent swing high/low as support/resistance
    if len(df) >= 20:
        key_levels["resistance_20"] = round(float(df["high"].iloc[-20:].max()), 6)
        key_levels["support_20"] = round(float(df["low"].iloc[-20:].min()), 6)

    return MarketContext(
        trend=trend,
        trend_strength=strength,
        regime=regime,
        momentum=momentum,
        volatility=volatility,
        key_levels=key_levels,
    )


def detect_events(
    symbol: str, timeframe: str, df: pd.DataFrame, ind: IndicatorSnapshot, price: float
) -> List[TAEvent]:
    """Detect TA events / signals from indicators."""
    events: List[TAEvent] = []
    now = datetime.now(timezone.utc)

    def _evt(etype: str, severity: str, title: str, desc: str, values: dict):
        events.append(TAEvent(
            id=f"ta-{uuid.uuid4().hex[:12]}",
            symbol=symbol, timeframe=timeframe,
            event_type=etype, severity=severity,
            title=title, description=desc,
            indicator_values=values,
            price_at_event=price, detected_at=now,
        ))

    # RSI extremes
    if ind.rsi_14 and ind.rsi_14 <= settings.RSI_OVERSOLD:
        _evt("rsi_oversold", "warning",
             f"{symbol} RSI Oversold ({ind.rsi_14:.1f})",
             f"RSI(14) dropped to {ind.rsi_14:.1f} on {timeframe}. Potential reversal zone.",
             {"rsi_14": ind.rsi_14})

    if ind.rsi_14 and ind.rsi_14 >= settings.RSI_OVERBOUGHT:
        _evt("rsi_overbought", "warning",
             f"{symbol} RSI Overbought ({ind.rsi_14:.1f})",
             f"RSI(14) reached {ind.rsi_14:.1f} on {timeframe}. Watch for pullback.",
             {"rsi_14": ind.rsi_14})

    # Bollinger Band squeeze
    if ind.bb_bandwidth and ind.bb_bandwidth < settings.BB_SQUEEZE_THRESHOLD:
        _evt("bb_squeeze", "info",
             f"{symbol} BB Squeeze ({ind.bb_bandwidth:.4f})",
             f"Bollinger bandwidth compressed to {ind.bb_bandwidth:.4f}. Breakout imminent.",
             {"bb_bandwidth": ind.bb_bandwidth})

    # Golden/Death cross (EMA 50/200)
    if ind.ema_50 and ind.ema_200 and len(df) >= 201:
        ema50_prev = ta_lib.trend.EMAIndicator(df["close"], window=50).ema_indicator().iloc[-2]
        ema200_prev = ta_lib.trend.EMAIndicator(df["close"], window=200).ema_indicator().iloc[-2]
        if ema50_prev < ema200_prev and ind.ema_50 > ind.ema_200:
            _evt("golden_cross", "critical",
                 f"{symbol} Golden Cross",
                 f"EMA 50 crossed above EMA 200 on {timeframe}. Strong bullish signal.",
                 {"ema_50": ind.ema_50, "ema_200": ind.ema_200})
        elif ema50_prev > ema200_prev and ind.ema_50 < ind.ema_200:
            _evt("death_cross", "critical",
                 f"{symbol} Death Cross",
                 f"EMA 50 crossed below EMA 200 on {timeframe}. Strong bearish signal.",
                 {"ema_50": ind.ema_50, "ema_200": ind.ema_200})

    # MACD cross
    if ind.macd_line is not None and ind.macd_signal is not None:
        macd_ind = ta_lib.trend.MACD(df["close"])
        ml = macd_ind.macd()
        ms = macd_ind.macd_signal()
        if len(ml) >= 2 and len(ms) >= 2:
            if ml.iloc[-2] < ms.iloc[-2] and ml.iloc[-1] > ms.iloc[-1]:
                _evt("macd_bullish_cross", "warning",
                     f"{symbol} MACD Bullish Cross",
                     f"MACD crossed above signal line on {timeframe}.",
                     {"macd_line": ind.macd_line, "macd_signal": ind.macd_signal})
            elif ml.iloc[-2] > ms.iloc[-2] and ml.iloc[-1] < ms.iloc[-1]:
                _evt("macd_bearish_cross", "warning",
                     f"{symbol} MACD Bearish Cross",
                     f"MACD crossed below signal line on {timeframe}.",
                     {"macd_line": ind.macd_line, "macd_signal": ind.macd_signal})

    # Stochastic oversold/overbought
    if ind.stoch_k and ind.stoch_k < 20 and ind.stoch_d and ind.stoch_d < 20:
        _evt("stoch_oversold", "info",
             f"{symbol} Stochastic Oversold",
             f"Stoch K={ind.stoch_k:.1f} D={ind.stoch_d:.1f} on {timeframe}.",
             {"stoch_k": ind.stoch_k, "stoch_d": ind.stoch_d})

    if ind.stoch_k and ind.stoch_k > 80 and ind.stoch_d and ind.stoch_d > 80:
        _evt("stoch_overbought", "info",
             f"{symbol} Stochastic Overbought",
             f"Stoch K={ind.stoch_k:.1f} D={ind.stoch_d:.1f} on {timeframe}.",
             {"stoch_k": ind.stoch_k, "stoch_d": ind.stoch_d})

    # Ichimoku cloud cross
    if ind.ichimoku_tenkan and ind.ichimoku_kijun:
        ich = ta_lib.trend.IchimokuIndicator(df["high"], df["low"])
        tk = ich.ichimoku_conversion_line()
        kj = ich.ichimoku_base_line()
        if len(tk) >= 2 and len(kj) >= 2:
            if tk.iloc[-2] < kj.iloc[-2] and tk.iloc[-1] > kj.iloc[-1]:
                _evt("ichimoku_bullish_cross", "warning",
                     f"{symbol} Ichimoku TK Cross (Bullish)",
                     f"Tenkan crossed above Kijun on {timeframe}.",
                     {"tenkan": ind.ichimoku_tenkan, "kijun": ind.ichimoku_kijun})

    # Price touching BB bands
    if ind.bb_lower and price <= ind.bb_lower * 1.005:
        _evt("bb_lower_touch", "info",
             f"{symbol} at Lower BB",
             f"Price touching lower Bollinger Band on {timeframe}.",
             {"price": price, "bb_lower": ind.bb_lower})

    if ind.bb_upper and price >= ind.bb_upper * 0.995:
        _evt("bb_upper_touch", "info",
             f"{symbol} at Upper BB",
             f"Price touching upper Bollinger Band on {timeframe}.",
             {"price": price, "bb_upper": ind.bb_upper})

    # Strong trend (ADX > 40)
    if ind.adx_14 and ind.adx_14 > 40:
        _evt("strong_trend", "info",
             f"{symbol} Strong Trend (ADX {ind.adx_14:.1f})",
             f"ADX at {ind.adx_14:.1f} on {timeframe} indicates very strong trend.",
             {"adx_14": ind.adx_14})

    return events


async def compute_snapshot(
    symbol: str, timeframe: str = "1h", exchange: Optional[str] = None
) -> Optional[TASnapshot]:
    """Full pipeline: fetch data, compute indicators, derive context, detect events."""
    df = await fetch_ohlcv(symbol, timeframe, limit=200, exchange_name=exchange)
    if df is None or len(df) < 50:
        return None

    indicators = compute_indicators(df)
    context = derive_context(df, indicators)
    price = get_current_price(df)
    stats = get_24h_stats(df)

    return TASnapshot(
        symbol=symbol,
        timeframe=timeframe,
        exchange=exchange or settings.EXCHANGE,
        price=price,
        open_24h=stats.get("open_24h"),
        high_24h=stats.get("high_24h"),
        low_24h=stats.get("low_24h"),
        volume_24h=stats.get("volume_24h"),
        change_pct_24h=round(((price - stats.get("open_24h", price)) / stats.get("open_24h", price)) * 100, 2) if stats.get("open_24h") else None,
        indicators=indicators,
        context=context,
        timestamp=datetime.now(timezone.utc),
        candle_ts=df.index[-1].to_pydatetime().replace(tzinfo=timezone.utc),
    )


async def compute_events(
    symbol: str, timeframe: str = "1h", exchange: Optional[str] = None
) -> List[TAEvent]:
    """Fetch and detect events."""
    df = await fetch_ohlcv(symbol, timeframe, limit=200, exchange_name=exchange)
    if df is None or len(df) < 50:
        return []

    indicators = compute_indicators(df)
    price = get_current_price(df)
    return detect_events(symbol, timeframe, df, indicators, price)
