/**
 * @agoraiq/signal-engine — Technical Score
 *
 * Five binary checks, each worth 20 points. Max = 100.
 * Tests EMA alignment, RSI zone, MACD, and VWAP position.
 */

import type { StrategySignalCandidate, MarketSnapshot } from "../types";
import { Direction } from "../types";
import { clamp } from "../utils/math";

export function scoreTechnicals(
  candidate: StrategySignalCandidate,
  snapshot: MarketSnapshot
): number {
  let score = 0;

  if (candidate.direction === Direction.LONG) {
    if (snapshot.price > snapshot.ema50) score += 20;
    if (snapshot.ema50 > snapshot.ema200) score += 20;
    if (snapshot.rsi >= 50 && snapshot.rsi <= 68) score += 20;
    if (snapshot.macdHistogram > 0) score += 20;
    if (snapshot.price > snapshot.vwap) score += 20;
  }

  if (candidate.direction === Direction.SHORT) {
    if (snapshot.price < snapshot.ema50) score += 20;
    if (snapshot.ema50 < snapshot.ema200) score += 20;
    if (snapshot.rsi >= 32 && snapshot.rsi <= 50) score += 20;
    if (snapshot.macdHistogram < 0) score += 20;
    if (snapshot.price < snapshot.vwap) score += 20;
  }

  return clamp(score, 0, 100);
}
