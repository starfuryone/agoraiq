/**
 * @agoraiq/signal-engine v2 — Trend Continuation Strategy (Hardened)
 *
 * Changes from v1:
 * 1. Volume confirmation required (no signals in dead markets)
 * 2. VWAP alignment check (price must be on the right side of VWAP)
 * 3. EMA20 proximity filter (entry only near the fast EMA, not extended)
 * 4. Dynamic ATR-based entry zone and SL (adapts to volatility)
 * 5. Tighter RSI bands to reduce false positives
 * 6. MACD histogram must exceed a minimum threshold (not just > 0)
 */

import type { MarketSnapshot, StrategySignalCandidate, ReasonCode } from "../types";
import { Direction, RegimeType, ConfidenceLevel } from "../types";
import { volumeConfirmationThreshold } from "../utils/thresholds";

export function runTrendContinuation(
  snapshot: MarketSnapshot
): StrategySignalCandidate | null {
  // Only fires in trending regimes
  if (
    snapshot.regime !== RegimeType.TRENDING_BULL &&
    snapshot.regime !== RegimeType.TRENDING_BEAR
  ) {
    return null;
  }

  // Volume gate: reject signals in thin markets
  const volThresh = volumeConfirmationThreshold(snapshot.symbol);
  if (snapshot.volume < volThresh * 0.5) {
    return null;
  }

  const base: Partial<StrategySignalCandidate> = {
    strategyType: "TREND_CONTINUATION",
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

  const atr = snapshot.atr;
  const price = snapshot.price;

  // ─── Minimum MACD histogram strength ────────────────────────────────────
  // Avoid weak momentum: histogram must be at least 0.1% of price
  const macdMinThreshold = price * 0.001;

  // ─── EMA20 proximity filter ─────────────────────────────────────────────
  // Price should be within 1.5 ATR of EMA20 (not overextended)
  const ema20Distance = Math.abs(price - snapshot.ema20);
  const maxEmaDistance = 1.5 * atr;

  // ─── Bullish trend continuation ────────────────────────────────────────────
  if (snapshot.regime === RegimeType.TRENDING_BULL) {
    const reasons: ReasonCode[] = [];

    // Core: EMA alignment
    if (!(price > snapshot.ema50 && snapshot.ema50 > snapshot.ema200)) return null;
    reasons.push("EMA_BULLISH_ALIGNMENT");

    // Core: RSI in healthy bullish zone (tighter than v1)
    if (!(snapshot.rsi >= 52 && snapshot.rsi <= 68)) return null;
    reasons.push("RSI_BULLISH_MIDZONE");

    // Core: MACD histogram positive and above minimum strength
    if (!(snapshot.macdHistogram > macdMinThreshold)) return null;
    reasons.push("MACD_POSITIVE");

    // Hardening: VWAP alignment
    if (price > snapshot.vwap) {
      reasons.push("VWAP_ALIGNED");
    } else {
      return null; // Price below VWAP in a bull trend = not confirming
    }

    // Hardening: EMA20 proximity (not overextended)
    if (ema20Distance > maxEmaDistance) return null;
    reasons.push("EMA20_PROXIMITY");

    // Hardening: Volume confirmation
    if (snapshot.volume >= volThresh) {
      reasons.push("VOLUME_CONFIRMATION");
    }

    // Dynamic ATR-based levels
    const entryLow = price - 0.3 * atr;
    const entryHigh = price + 0.3 * atr;
    const stopLoss = snapshot.ema20 - 0.8 * atr;
    const tp1 = price + 1.2 * atr;
    const tp2 = price + 2.2 * atr;

    // Sanity: SL must be below entry
    if (stopLoss >= entryLow) return null;

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

  // ─── Bearish trend continuation ────────────────────────────────────────────
  if (snapshot.regime === RegimeType.TRENDING_BEAR) {
    const reasons: ReasonCode[] = [];

    if (!(price < snapshot.ema50 && snapshot.ema50 < snapshot.ema200)) return null;
    reasons.push("EMA_BEARISH_ALIGNMENT");

    if (!(snapshot.rsi >= 32 && snapshot.rsi <= 48)) return null;
    reasons.push("RSI_BEARISH_MIDZONE");

    if (!(snapshot.macdHistogram < -macdMinThreshold)) return null;
    reasons.push("MACD_NEGATIVE");

    if (price < snapshot.vwap) {
      reasons.push("VWAP_ALIGNED");
    } else {
      return null;
    }

    if (ema20Distance > maxEmaDistance) return null;
    reasons.push("EMA20_PROXIMITY");

    if (snapshot.volume >= volThresh) {
      reasons.push("VOLUME_CONFIRMATION");
    }

    const entryLow = price - 0.3 * atr;
    const entryHigh = price + 0.3 * atr;
    const stopLoss = snapshot.ema20 + 0.8 * atr;
    const tp1 = price - 1.2 * atr;
    const tp2 = price - 2.2 * atr;

    if (stopLoss <= entryHigh) return null;

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

  return null;
}
