/**
 * @agoraiq/signal-engine — Regime Detector
 *
 * Classifies the current market regime to adapt strategy selection
 * and scoring downstream. Maps to: detect_market_regime() in pseudocode.
 *
 * Regime priority order:
 * 1. HIGH_VOL_EVENT (high ATR + strong news)
 * 2. LOW_LIQUIDITY (volume below threshold)
 * 3. TRENDING_BULL / TRENDING_BEAR (EMA alignment + range)
 * 4. RANGE_CHOP (tight range)
 * 5. UNKNOWN (fallback)
 */

import type { MarketSnapshot, Candle } from "./types";
import { RegimeType } from "./types";
import { lastNHighs, lastNLows } from "./utils/ta";
import { liquidityThreshold } from "./utils/thresholds";

export function detectMarketRegime(
  snapshot: MarketSnapshot,
  candles: Candle[]
): RegimeType {
  const emaBullish =
    snapshot.price > snapshot.ema50 && snapshot.ema50 > snapshot.ema200;
  const emaBearish =
    snapshot.price < snapshot.ema50 && snapshot.ema50 < snapshot.ema200;

  const atrPct = snapshot.price > 0 ? snapshot.atr / snapshot.price : 0;

  const recentHighs = lastNHighs(candles, 20);
  const recentLows = lastNLows(candles, 20);
  const rangeHigh = Math.max(...recentHighs);
  const rangeLow = Math.min(...recentLows);
  const recentRangePct =
    snapshot.price > 0 ? (rangeHigh - rangeLow) / snapshot.price : 0;

  // 1. High volatility event: wide ATR + strong news catalyst
  if (atrPct > 0.04 && Math.abs(snapshot.newsEventScore) > 0.6) {
    return RegimeType.HIGH_VOL_EVENT;
  }

  // 2. Low liquidity: volume below per-symbol threshold
  if (snapshot.volume < liquidityThreshold(snapshot.symbol)) {
    return RegimeType.LOW_LIQUIDITY;
  }

  // 3. Trending bull: bullish EMA alignment + meaningful range
  if (emaBullish && recentRangePct > 0.03) {
    return RegimeType.TRENDING_BULL;
  }

  // 4. Trending bear: bearish EMA alignment + meaningful range
  if (emaBearish && recentRangePct > 0.03) {
    return RegimeType.TRENDING_BEAR;
  }

  // 5. Range chop: narrow range
  if (recentRangePct < 0.025) {
    return RegimeType.RANGE_CHOP;
  }

  return RegimeType.UNKNOWN;
}
