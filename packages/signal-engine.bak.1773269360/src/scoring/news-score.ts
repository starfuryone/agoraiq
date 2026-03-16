/**
 * @agoraiq/signal-engine — News Score
 *
 * Starts at neutral (50) and adjusts based on news event score,
 * sentiment, and source credibility. Direction-aware: positive news
 * helps longs and hurts shorts.
 */

import type { StrategySignalCandidate, MarketSnapshot } from "../types";
import { Direction } from "../types";
import { clamp } from "../utils/math";

export function scoreNewsContext(
  candidate: StrategySignalCandidate,
  snapshot: MarketSnapshot
): number {
  let score = 50; // neutral baseline

  if (candidate.direction === Direction.LONG) {
    score += snapshot.newsEventScore * 25;
    score += snapshot.sentimentScore * 20;
    score += snapshot.sourceCredibilityScore * 10;
  }

  if (candidate.direction === Direction.SHORT) {
    score -= snapshot.newsEventScore * 25;
    score -= snapshot.sentimentScore * 20;
    score += snapshot.sourceCredibilityScore * 10;
  }

  return clamp(score, 0, 100);
}
