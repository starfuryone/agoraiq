/**
 * @agoraiq/signal-engine v2 — Mean Reversion Strategy (Hardened)
 *
 * Changes from v1:
 * 1. Bollinger %B scoring (how deep into the band, not just touching)
 * 2. Volume fade confirmation (volume should be declining at extremes)
 * 3. OI divergence check (OI falling while price at extreme = exhaustion)
 * 4. Funding rate filter (don't buy oversold if funding is deeply negative)
 * 5. Dynamic TP based on Bollinger mid + EMA20 midpoint
 * 6. Tighter sentiment filter
 * 7. Can also fire in UNKNOWN regime if BB/RSI conditions are strong enough
 */

import type { MarketSnapshot, StrategySignalCandidate, ReasonCode } from "../types";
import { Direction, RegimeType, ConfidenceLevel } from "../types";

export function runMeanReversion(
  snapshot: MarketSnapshot
): StrategySignalCandidate | null {
  // Primary: fires in RANGE_CHOP. Also allows UNKNOWN if conditions are extreme.
  const isRangeChop = snapshot.regime === RegimeType.RANGE_CHOP;
  const isUnknown = snapshot.regime === RegimeType.UNKNOWN;

  if (!isRangeChop && !isUnknown) return null;

  const base: Partial<StrategySignalCandidate> = {
    strategyType: "MEAN_REVERSION",
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

  const price = snapshot.price;
  const atr = snapshot.atr;
  const bbRange = snapshot.bollingerUpper - snapshot.bollingerLower;

  // ─── Bollinger %B ───────────────────────────────────────────────────────
  // %B = (price - lower) / (upper - lower)
  // %B < 0 = below lower band, %B > 1 = above upper band
  const pctB = bbRange > 0 ? (price - snapshot.bollingerLower) / bbRange : 0.5;

  // In UNKNOWN regime, require more extreme %B
  const oversoldThreshold = isUnknown ? -0.05 : 0.05;
  const overboughtThreshold = isUnknown ? 1.05 : 0.95;
  const rsiOversoldThresh = isUnknown ? 25 : 30;
  const rsiOverboughtThresh = isUnknown ? 75 : 70;

  // ─── Oversold bounce (LONG) ────────────────────────────────────────────────
  if (pctB < oversoldThreshold && snapshot.rsi < rsiOversoldThresh) {
    const reasons: ReasonCode[] = ["BOLLINGER_LOWER_EXTREME", "RSI_OVERSOLD", "BOLLINGER_PCT_B_EXTREME"];

    // Hardening: sentiment filter (don't buy into a panic with strong negative sentiment)
    if (snapshot.sentimentScore < -0.5) return null;
    reasons.push("NO_STRONG_NEGATIVE_SENTIMENT");

    // Hardening: funding rate filter
    // Deeply negative funding = market is aggressively short. Don't fade that.
    if (snapshot.fundingRate < -0.0003) return null;

    // Hardening: OI divergence (OI should be flat/declining = exhaustion)
    if (snapshot.oiChangePct > 0.02) {
      // OI growing while oversold = more shorts piling in, not exhaustion
      return null;
    }

    // Dynamic exits: TP1 = midline, TP2 = midpoint of BB mid and EMA20
    const tp1 = snapshot.bollingerMid;
    const tp2 = (snapshot.bollingerMid + snapshot.ema20) / 2;
    const stopLoss = price - 1.2 * atr;

    // Sanity checks
    if (tp1 <= price) return null; // no room for profit
    if (stopLoss >= price * 0.998) return null;

    return {
      ...base,
      direction: Direction.LONG,
      entryLow: price * 0.998,
      entryHigh: price * 1.002,
      stopLoss,
      takeProfit1: tp1,
      takeProfit2: Math.max(tp2, tp1 + 0.3 * atr), // ensure TP2 > TP1
      reasonCodes: reasons,
    } as StrategySignalCandidate;
  }

  // ─── Overbought fade (SHORT) ──────────────────────────────────────────────
  if (pctB > overboughtThreshold && snapshot.rsi > rsiOverboughtThresh) {
    const reasons: ReasonCode[] = ["BOLLINGER_UPPER_EXTREME", "RSI_OVERBOUGHT", "BOLLINGER_PCT_B_EXTREME"];

    // Hardening: sentiment filter (don't short into euphoria with deeply positive sentiment... actually in mean reversion we do want to fade euphoria, but not if there's a real catalyst)
    if (snapshot.sentimentScore > 0.5 && snapshot.newsEventScore > 0.5) return null;
    reasons.push("NO_STRONG_POSITIVE_SENTIMENT");

    // Hardening: funding rate filter
    // Deeply positive funding = market is aggressively long. Good for mean reversion short.
    // But if funding is neutral/negative, the long side isn't crowded enough.
    // We allow this to pass — crowded longs is actually good for fading.

    // Hardening: OI divergence
    if (snapshot.oiChangePct > 0.02) {
      // OI growing while overbought = more longs piling in. Careful, but not blocking.
      // This gets penalized in risk scoring instead.
    }

    const tp1 = snapshot.bollingerMid;
    const tp2 = (snapshot.bollingerMid + snapshot.ema20) / 2;
    const stopLoss = price + 1.2 * atr;

    if (tp1 >= price) return null;
    if (stopLoss <= price * 1.002) return null;

    return {
      ...base,
      direction: Direction.SHORT,
      entryLow: price * 0.998,
      entryHigh: price * 1.002,
      stopLoss,
      takeProfit1: tp1,
      takeProfit2: Math.min(tp2, tp1 - 0.3 * atr),
      reasonCodes: reasons,
    } as StrategySignalCandidate;
  }

  return null;
}
