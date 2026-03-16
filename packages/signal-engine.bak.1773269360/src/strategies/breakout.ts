/**
 * @agoraiq/signal-engine v2 — Breakout Confirmation Strategy
 *
 * WHEN IT FIRES
 * ─────────────
 * In the transition zone where the regime detector says RANGE_CHOP
 * or UNKNOWN — meaning EMAs haven't aligned yet, but price is
 * breaking a structurally significant level. By the time the regime
 * detector confirms TRENDING, the breakout is over. This strategy
 * catches the move the other two strategies miss.
 *
 * Also fires in early TRENDING regimes (first 5 bars after regime
 * shift) when price is still near the breakout level, because
 * the trend continuation strategy's EMA proximity filter may
 * reject these entries as overextended.
 *
 * REQUIREMENTS
 * ────────────
 * 1. A real level to break: detected by swing point clustering
 *    (services/levels.ts), not a naive high/low of the last N bars.
 *    Level must have strength >= 0.3 and touchCount >= 2.
 *
 * 2. Price closes beyond the level: the breakout bar's close must
 *    be past the level, not just a wick. Wicks that touch and reverse
 *    are failed breakouts, not confirmed ones.
 *
 * 3. Volume confirmation: bar volume must exceed the breakout threshold
 *    for the symbol. A breakout without volume is a fakeout.
 *
 * 4. Momentum: MACD histogram must be non-negative (bullish breakout)
 *    or non-positive (bearish). This is a weak filter — momentum
 *    often lags the breakout, so the threshold is zero, not strongly
 *    positive/negative.
 *
 * 5. No extreme RSI: RSI must not be overbought (>75) for longs or
 *    oversold (<25) for shorts. Breakouts at extremes are exhaustion
 *    moves, not continuation.
 *
 * ENTRY/EXIT LEVELS
 * ─────────────────
 * Entry zone: level price to current price (you're entering at the
 * breakout, not waiting for a pullback — that's a different strategy).
 *
 * Stop loss: below the broken level by 0.5 ATR (bullish) or above by
 * 0.5 ATR (bearish). If the level recaptures, the thesis is dead.
 *
 * TP1: 1.5 ATR from entry. TP2: 3.0 ATR from entry. Wider than
 * trend continuation because breakout moves tend to be larger.
 */

import type { MarketSnapshot, StrategySignalCandidate, ReasonCode } from "../types";
import { Direction, RegimeType, ConfidenceLevel } from "../types";
import { detectLevels, type Level } from "../services/levels";
import { volumeBreakoutThreshold } from "../utils/thresholds";

// ─── Configuration ─────────────────────────────────────────────────────────────

const MIN_LEVEL_STRENGTH = 0.3;
const MIN_LEVEL_TOUCHES = 2;
const RSI_UPPER_LIMIT = 75;    // don't buy breakouts into overbought
const RSI_LOWER_LIMIT = 25;    // don't sell breakdowns into oversold

// ─── Regime filter ─────────────────────────────────────────────────────────────

function isBreakoutRegime(regime: RegimeType): boolean {
  return (
    regime === RegimeType.RANGE_CHOP ||
    regime === RegimeType.UNKNOWN ||
    regime === RegimeType.TRENDING_BULL ||
    regime === RegimeType.TRENDING_BEAR
  );
}

// ─── Strategy ──────────────────────────────────────────────────────────────────

export function runBreakout(
  snapshot: MarketSnapshot
): StrategySignalCandidate | null {
  if (!isBreakoutRegime(snapshot.regime)) return null;

  const price = snapshot.price;
  const atr = snapshot.atr;
  const volThresh = volumeBreakoutThreshold(snapshot.symbol);

  // Volume gate
  if (snapshot.volume < volThresh) return null;

  // Detect levels from the candle history
  const levels = detectLevels(snapshot.candles, 100, price);

  const base: Partial<StrategySignalCandidate> = {
    strategyType: "BREAKOUT_CONFIRMATION",
    symbol: snapshot.symbol,
    timeframe: snapshot.timeframe,
    timestamp: snapshot.timestamp,
    technicalScore: 0,
    marketStructureScore: 0,
    newsScore: 0,
    providerScore: 0,
    riskPenalty: 0,
    finalScore: 0,
    confidence: ConfidenceLevel.REJECT,
    expectedR: 0,
    reasonCodes: [],
    riskFlags: [],
  };

  // ─── Bullish breakout: price above nearest resistance ──────────────────────
  const resistance = findBreakableLevel(levels.resistance, price, "above");

  if (resistance && price > resistance.price) {
    // Price closed above the level
    const reasons: ReasonCode[] = [];

    // Momentum: MACD not fighting the move
    if (snapshot.macdHistogram < 0) return tryBearish();
    reasons.push("RESISTANCE_BREAKOUT");
    reasons.push("VOLUME_CONFIRMATION");

    // RSI not overbought
    if (snapshot.rsi > RSI_UPPER_LIMIT) return tryBearish();

    // Orderbook confirmation (optional, adds conviction)
    if (snapshot.orderbookImbalance > 0.10) {
      reasons.push("ORDERBOOK_BUY_PRESSURE");
    }

    if (snapshot.macdHistogram > 0) {
      reasons.push("MACD_POSITIVE");
    }

    // Entry zone: from the level to current price
    const entryLow = resistance.price;
    const entryHigh = price;
    const stopLoss = resistance.price - 0.5 * atr;
    const tp1 = price + 1.5 * atr;
    const tp2 = price + 3.0 * atr;

    // Sanity: stop must be below entry
    if (stopLoss >= entryLow) return tryBearish();

    // Sanity: price shouldn't already be too far past the level
    // (more than 1 ATR past = you missed the breakout)
    if (price - resistance.price > atr) return tryBearish();

    return {
      ...base,
      direction: Direction.LONG,
      entryLow,
      entryHigh,
      stopLoss,
      takeProfit1: tp1,
      takeProfit2: tp2,
      reasonCodes: reasons,
    } as StrategySignalCandidate;
  }

  // ─── Bearish breakdown: price below nearest support ────────────────────────
  return tryBearish();

  function tryBearish(): StrategySignalCandidate | null {
    const support = findBreakableLevel(levels.support, price, "below");

    if (!support || price >= support.price) return null;

    const reasons: ReasonCode[] = [];

    if (snapshot.macdHistogram > 0) return null;
    reasons.push("SUPPORT_BREAKDOWN");
    reasons.push("VOLUME_CONFIRMATION");

    if (snapshot.rsi < RSI_LOWER_LIMIT) return null;

    if (snapshot.orderbookImbalance < -0.10) {
      reasons.push("ORDERBOOK_SELL_PRESSURE");
    }

    if (snapshot.macdHistogram < 0) {
      reasons.push("MACD_NEGATIVE");
    }

    const entryLow = price;
    const entryHigh = support.price;
    const stopLoss = support.price + 0.5 * atr;
    const tp1 = price - 1.5 * atr;
    const tp2 = price - 3.0 * atr;

    if (stopLoss <= entryHigh) return null;
    if (support.price - price > atr) return null;

    return {
      ...base,
      direction: Direction.SHORT,
      entryLow,
      entryHigh,
      stopLoss,
      takeProfit1: tp1,
      takeProfit2: tp2,
      reasonCodes: reasons,
    } as StrategySignalCandidate;
  }
}

// ─── Level Selection ───────────────────────────────────────────────────────────

/**
 * Find the best level that price is breaking.
 *
 * "above" = look for resistance levels that price has closed above.
 * "below" = look for support levels that price has closed below.
 *
 * Returns the strongest qualifying level within 1 ATR of price,
 * or null if none qualify.
 */
function findBreakableLevel(
  levels: Level[],
  price: number,
  direction: "above" | "below"
): Level | null {
  // Levels are already sorted by strength (strongest first)
  for (const level of levels) {
    // Minimum quality
    if (level.strength < MIN_LEVEL_STRENGTH) continue;
    if (level.touchCount < MIN_LEVEL_TOUCHES) continue;

    // Must be near current price (within 3%)
    const dist = Math.abs(level.price - price) / price;
    if (dist > 0.03) continue;

    return level;
  }

  return null;
}
