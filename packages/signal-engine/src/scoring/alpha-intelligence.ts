/**
 * @agoraiq/signal-engine — Alpha Intelligence Score
 *
 * Scores based on orderbook depth, whale activity, liquidation clusters,
 * and cross-exchange context. These are the signals that distinguish
 * a quantitative engine from a retail indicator bot.
 *
 * This component contributes to the market_structure_score.
 * Instead of replacing the existing score, it provides bonus/penalty
 * adjustments that the scoring orchestrator applies.
 */

import type { StrategySignalCandidate, MarketSnapshot, ReasonCode, RiskFlag } from "../types";
import { Direction } from "../types";
import { clamp } from "../utils/math";

export interface AlphaAdjustment {
  /** Points to add to market_structure_score (can be negative) */
  marketStructureBonus: number;
  /** Points to subtract from final score via risk penalty */
  riskPenaltyBonus: number;
  /** Reason codes to append */
  reasonCodes: ReasonCode[];
  /** Risk flags to append */
  riskFlags: RiskFlag[];
}

/**
 * Compute scoring adjustments from alpha intelligence signals.
 */
export function scoreAlphaIntelligence(
  candidate: StrategySignalCandidate,
  snapshot: MarketSnapshot
): AlphaAdjustment {
  let marketStructureBonus = 0;
  let riskPenaltyBonus = 0;
  const reasonCodes: ReasonCode[] = [];
  const riskFlags: RiskFlag[] = [];

  const depth = snapshot.orderbookDepth;
  const whale = snapshot.whaleActivity;
  const liq = snapshot.liquidationClusters;
  const cross = snapshot.crossExchange;

  // ─── Order Book Depth ──────────────────────────────────────────────────────

  if (candidate.direction === Direction.LONG) {
    // Bid wall supporting the price = bullish
    if (depth.bidWallSize > 500_000 && depth.bidWallPrice < snapshot.price) {
      marketStructureBonus += 8;
      reasonCodes.push("BID_WALL_SUPPORT");
    }
    // Depth ratio favoring bids
    if (depth.depthRatio > 1.5) {
      marketStructureBonus += 5;
      reasonCodes.push("DEPTH_RATIO_BULLISH");
    }
    // Ask wall near our TP = resistance warning (reduce bonus, don't penalize)
    if (
      depth.askWallSize > 500_000 &&
      depth.askWallPrice > snapshot.price &&
      depth.askWallPrice < candidate.takeProfit1
    ) {
      marketStructureBonus -= 3;
      reasonCodes.push("ASK_WALL_RESISTANCE");
    }
  }

  if (candidate.direction === Direction.SHORT) {
    // Ask wall capping the price = bearish
    if (depth.askWallSize > 500_000 && depth.askWallPrice > snapshot.price) {
      marketStructureBonus += 8;
      reasonCodes.push("ASK_WALL_RESISTANCE");
    }
    // Depth ratio favoring asks
    if (depth.depthRatio < 0.67) {
      marketStructureBonus += 5;
      reasonCodes.push("DEPTH_RATIO_BEARISH");
    }
    // Bid wall near our TP = support warning
    if (
      depth.bidWallSize > 500_000 &&
      depth.bidWallPrice < snapshot.price &&
      depth.bidWallPrice > candidate.takeProfit1
    ) {
      marketStructureBonus -= 3;
      reasonCodes.push("BID_WALL_SUPPORT");
    }
  }

  // Thin orderbook = risk
  if (depth.spreadBps > 10) {
    riskPenaltyBonus += 5;
    riskFlags.push("WIDE_SPREAD");
  }
  if (depth.bidDepth1Pct + depth.askDepth1Pct < 100_000) {
    riskPenaltyBonus += 5;
    riskFlags.push("THIN_ORDERBOOK");
  }

  // ─── Whale Activity ────────────────────────────────────────────────────────

  if (candidate.direction === Direction.LONG && whale.whaleDirection === "BUY") {
    marketStructureBonus += 7;
    reasonCodes.push("WHALE_BUYING");
  }
  if (candidate.direction === Direction.SHORT && whale.whaleDirection === "SELL") {
    marketStructureBonus += 7;
    reasonCodes.push("WHALE_SELLING");
  }

  // Whale trading against our direction = risk
  if (candidate.direction === Direction.LONG && whale.whaleDirection === "SELL" && whale.largeTradeRatio > 0.15) {
    riskPenaltyBonus += 5;
    riskFlags.push("WHALE_COUNTER_TRADE");
  }
  if (candidate.direction === Direction.SHORT && whale.whaleDirection === "BUY" && whale.largeTradeRatio > 0.15) {
    riskPenaltyBonus += 5;
    riskFlags.push("WHALE_COUNTER_TRADE");
  }

  // ─── Liquidation Clusters ──────────────────────────────────────────────────

  if (candidate.direction === Direction.LONG) {
    // Short squeeze zone above: shorts will be forced to cover = fuel for our trade
    if (
      liq.shortClusterValue > 1_000_000 &&
      liq.shortClusterPrice > snapshot.price &&
      liq.shortClusterPrice <= candidate.takeProfit2
    ) {
      marketStructureBonus += 10;
      reasonCodes.push("SHORT_SQUEEZE_ZONE");
    }
  }

  if (candidate.direction === Direction.SHORT) {
    // Long squeeze zone below: longs will be force-sold = fuel for our trade
    if (
      liq.longClusterValue > 1_000_000 &&
      liq.longClusterPrice < snapshot.price &&
      liq.longClusterPrice >= candidate.takeProfit2
    ) {
      marketStructureBonus += 10;
      reasonCodes.push("LONG_SQUEEZE_ZONE");
    }
  }

  // Active cascade = high risk regardless of direction
  if (liq.cascadeDetected) {
    riskPenaltyBonus += 8;
    riskFlags.push("LIQUIDATION_CASCADE_ACTIVE");
    reasonCodes.push("LIQUIDATION_CASCADE");
  }

  // ─── Cross-Exchange Context ────────────────────────────────────────────────

  if (candidate.direction === Direction.LONG && cross.priceConsensus === "BULLISH") {
    marketStructureBonus += 5;
    reasonCodes.push("CROSS_EXCHANGE_CONSENSUS");
  }
  if (candidate.direction === Direction.SHORT && cross.priceConsensus === "BEARISH") {
    marketStructureBonus += 5;
    reasonCodes.push("CROSS_EXCHANGE_CONSENSUS");
  }

  // Divergence across exchanges = uncertainty
  if (cross.divergenceDetected) {
    riskPenaltyBonus += 5;
    riskFlags.push("CROSS_EXCHANGE_DIVERGENCE");
    reasonCodes.push("CROSS_EXCHANGE_DIVERGENCE");
  }

  return {
    marketStructureBonus: clamp(marketStructureBonus, -15, 30),
    riskPenaltyBonus: clamp(riskPenaltyBonus, 0, 25),
    reasonCodes,
    riskFlags,
  };
}
