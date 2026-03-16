/**
 * @agoraiq/signal-engine — Scoring Engine
 *
 * Orchestrates all scoring components and computes the final weighted score.
 *
 * Weight allocation:
 *   0.35 × technical       (always on)
 *   0.25 × market structure (ablatable)
 *   0.20 × news            (ablatable)
 *   0.20 × provider        (ablatable)
 *   minus risk penalty      (ablatable)
 *   plus alpha adjustments  (ablatable)
 *
 * When a factor is disabled via the ablation framework, its score is
 * set to neutral (50 for component scores, 0 for penalties). Weights
 * are NOT redistributed — this shows the actual effect of removing
 * the factor, not an idealized rebalancing.
 */

import type { StrategySignalCandidate, MarketSnapshot } from "../types";
import { RegimeType } from "../types";
import { scoreTechnicals } from "./technical-score";
import { scoreMarketStructure } from "./market-structure-score";
import { scoreNewsContext } from "./news-score";
import { scoreProviderContext } from "./provider-score";
import { scoreRiskPenalty } from "./risk-penalty";
import { scoreAlphaIntelligence } from "./alpha-intelligence";
import { mapScoreToConfidence } from "./confidence";
import { computeExpectedR, entryMid, clamp } from "../utils/math";
import { liquidityThreshold } from "../utils/thresholds";
import { getActiveFactors } from "../ablation";
import { logger } from "../services/logger";

/**
 * Apply the full scoring framework to a candidate.
 * Respects ablation factor toggles.
 */
export async function applyGlobalScoring(
  candidate: StrategySignalCandidate,
  snapshot: MarketSnapshot
): Promise<StrategySignalCandidate> {
  const factors = getActiveFactors();

  // ─── Technical score (always on — core signal) ─────────────────────────────
  candidate.technicalScore = scoreTechnicals(candidate, snapshot);

  // ─── Market structure (ablatable) ──────────────────────────────────────────
  candidate.marketStructureScore = factors.marketStructure
    ? scoreMarketStructure(candidate, snapshot)
    : 50;

  // ─── News (ablatable) ──────────────────────────────────────────────────────
  candidate.newsScore = factors.news
    ? scoreNewsContext(candidate, snapshot)
    : 50;

  // ─── Provider history (ablatable) ──────────────────────────────────────────
  candidate.providerScore = factors.providerHistory
    ? await scoreProviderContext(candidate, snapshot)
    : 50;

  // ─── Risk penalty (ablatable) ──────────────────────────────────────────────
  candidate.riskPenalty = factors.riskPenalty
    ? scoreRiskPenalty(candidate, snapshot)
    : 0;

  // ─── Alpha intelligence (ablatable) ────────────────────────────────────────
  if (factors.alphaIntelligence) {
    const alpha = scoreAlphaIntelligence(candidate, snapshot);
    candidate.marketStructureScore = clamp(
      candidate.marketStructureScore + alpha.marketStructureBonus,
      0,
      100
    );
    candidate.riskPenalty += alpha.riskPenaltyBonus;
    candidate.reasonCodes.push(...alpha.reasonCodes);
    candidate.riskFlags.push(...alpha.riskFlags);
  }

  // ─── Weighted final score ──────────────────────────────────────────────────
  candidate.finalScore =
    0.35 * candidate.technicalScore +
    0.25 * candidate.marketStructureScore +
    0.2 * candidate.newsScore +
    0.2 * candidate.providerScore -
    candidate.riskPenalty;

  // ─── Expected R ────────────────────────────────────────────────────────────
  const mid = entryMid(candidate.entryLow, candidate.entryHigh);
  candidate.expectedR = computeExpectedR(mid, candidate.stopLoss, candidate.takeProfit2);

  // ─── Confidence ────────────────────────────────────────────────────────────
  candidate.confidence = mapScoreToConfidence(candidate.finalScore);

  // ─── Regime-based risk flags (always on — not a scoring factor) ────────────
  if (snapshot.regime === RegimeType.HIGH_VOL_EVENT) {
    if (!candidate.riskFlags.includes("HIGH_VOLATILITY_EVENT")) {
      candidate.riskFlags.push("HIGH_VOLATILITY_EVENT");
    }
  }

  if (snapshot.volume < liquidityThreshold(snapshot.symbol)) {
    if (!candidate.riskFlags.includes("LOW_LIQUIDITY")) {
      candidate.riskFlags.push("LOW_LIQUIDITY");
    }
  }

  logger.debug(
    `Scored ${candidate.symbol} ${candidate.strategyType}: ` +
      `tech=${candidate.technicalScore} mkt=${candidate.marketStructureScore} ` +
      `news=${candidate.newsScore} prov=${candidate.providerScore} ` +
      `penalty=${candidate.riskPenalty} ` +
      `final=${candidate.finalScore.toFixed(1)} conf=${candidate.confidence} R=${candidate.expectedR}`
  );

  return candidate;
}
