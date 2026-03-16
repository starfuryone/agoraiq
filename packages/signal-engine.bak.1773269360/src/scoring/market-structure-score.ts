/**
 * @agoraiq/signal-engine — Market Structure Score
 *
 * Evaluates orderbook imbalance, OI growth, funding rate health,
 * volume confirmation, and liquidation pressure.
 */

import type { StrategySignalCandidate, MarketSnapshot } from "../types";
import { Direction } from "../types";
import { clamp } from "../utils/math";
import {
  volumeConfirmationThreshold,
  liquidationThreshold,
} from "../utils/thresholds";

export function scoreMarketStructure(
  candidate: StrategySignalCandidate,
  snapshot: MarketSnapshot
): number {
  let score = 0;
  const volThresh = volumeConfirmationThreshold(snapshot.symbol);
  const liqThresh = liquidationThreshold(snapshot.symbol);

  if (candidate.direction === Direction.LONG) {
    if (snapshot.orderbookImbalance > 0.1) score += 25;
    if (snapshot.oiChangePct > 0) score += 20;
    if (snapshot.fundingRate >= -0.01 && snapshot.fundingRate <= 0.02) score += 20;
    if (snapshot.volume > volThresh) score += 20;
    if (snapshot.liquidationShort > liqThresh) score += 15;
  }

  if (candidate.direction === Direction.SHORT) {
    if (snapshot.orderbookImbalance < -0.1) score += 25;
    if (snapshot.oiChangePct > 0) score += 20;
    if (snapshot.fundingRate >= -0.02 && snapshot.fundingRate <= 0.01) score += 20;
    if (snapshot.volume > volThresh) score += 20;
    if (snapshot.liquidationLong > liqThresh) score += 15;
  }

  return clamp(score, 0, 100);
}
