/**
 * @agoraiq/signal-engine — Risk Penalty
 *
 * Subtracts from the final score based on risk conditions:
 * high volatility, low liquidity, crowded positioning, event shock.
 * Also appends risk flags to the candidate.
 */

import type { StrategySignalCandidate, MarketSnapshot, RiskFlag } from "../types";
import { Direction, RegimeType } from "../types";
import { liquidityThreshold } from "../utils/thresholds";

export function scoreRiskPenalty(
  candidate: StrategySignalCandidate,
  snapshot: MarketSnapshot
): number {
  let penalty = 0;
  const flags: RiskFlag[] = [];

  const atrPct = snapshot.price > 0 ? snapshot.atr / snapshot.price : 0;

  // High ATR relative to price
  if (atrPct > 0.04) {
    penalty += 10;
  }

  // Low liquidity regime
  if (snapshot.regime === RegimeType.LOW_LIQUIDITY) {
    penalty += 15;
  }

  // Crowded longs (high positive funding on a long)
  if (candidate.direction === Direction.LONG && snapshot.fundingRate > 0.05) {
    penalty += 10;
    flags.push("CROWDED_LONGS");
  }

  // Crowded shorts (high negative funding on a short)
  if (candidate.direction === Direction.SHORT && snapshot.fundingRate < -0.05) {
    penalty += 10;
    flags.push("CROWDED_SHORTS");
  }

  // Event shock (extreme news + high vol regime)
  if (
    Math.abs(snapshot.newsEventScore) > 0.8 &&
    snapshot.regime === RegimeType.HIGH_VOL_EVENT
  ) {
    penalty += 5;
    flags.push("EVENT_SHOCK");
  }

  // Append flags to candidate
  candidate.riskFlags = [...candidate.riskFlags, ...flags];

  return penalty;
}
