/**
 * @agoraiq/signal-engine — Provider Score
 *
 * Uses historical strategy expectancy (win rate, avg R, sample size)
 * to score how well this type of setup has performed historically.
 * Returns 50 (neutral) when no history exists.
 */

import type { StrategySignalCandidate, MarketSnapshot } from "../types";
import { getSetupExpectancy } from "../services/provider-stats";
import { normalize, clamp } from "../utils/math";

export async function scoreProviderContext(
  candidate: StrategySignalCandidate,
  snapshot: MarketSnapshot
): Promise<number> {
  const stats = await getSetupExpectancy(
    candidate.symbol,
    candidate.timeframe,
    candidate.strategyType,
    snapshot.regime
  );

  if (!stats) {
    return 50; // no history — neutral
  }

  let score = 0;
  score += normalize(stats.winRate, 0, 1) * 40;
  score += normalize(stats.avgR, -1, 3) * 35;
  score += normalize(stats.sampleSize, 0, 200) * 25;

  return clamp(score, 0, 100);
}
