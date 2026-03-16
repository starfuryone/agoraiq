/**
 * @agoraiq/signal-engine v2 — Scoring Tests
 */

import { describe, it, expect } from "vitest";
import { scoreTechnicals } from "../src/scoring/technical-score";
import { scoreMarketStructure } from "../src/scoring/market-structure-score";
import { scoreNewsContext } from "../src/scoring/news-score";
import { scoreRiskPenalty } from "../src/scoring/risk-penalty";
import { mapScoreToConfidence } from "../src/scoring/confidence";
import type { StrategySignalCandidate, MarketSnapshot } from "../src/types";
import { Direction, RegimeType, ConfidenceLevel } from "../src/types";
import { NEUTRAL_DEPTH } from "../src/services/orderbook-depth";
import { NEUTRAL_WHALE } from "../src/services/whale-detection";
import { NEUTRAL_LIQ_CLUSTERS } from "../src/services/liquidation-clusters";
import { NEUTRAL_CROSS_EXCHANGE } from "../src/services/cross-exchange";

function makeCandidate(overrides: Partial<StrategySignalCandidate> = {}): StrategySignalCandidate {
  return {
    strategyType: "TREND_CONTINUATION",
    symbol: "BTC",
    timeframe: "1h",
    timestamp: new Date(),
    direction: Direction.LONG,
    entryLow: 86500,
    entryHigh: 87500,
    stopLoss: 85000,
    takeProfit1: 89000,
    takeProfit2: 91000,
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
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    symbol: "BTC",
    timeframe: "1h",
    timestamp: new Date(),
    price: 87000,
    volume: 2_000_000,
    high: 87500,
    low: 86500,
    rsi: 55,
    macdLine: 100,
    macdSignal: 80,
    macdHistogram: 20,
    ema20: 86800,
    ema50: 86000,
    ema200: 84000,
    atr: 800,
    bollingerUpper: 88000,
    bollingerMid: 87000,
    bollingerLower: 86000,
    vwap: 86500,
    fundingRate: 0.0001,
    openInterest: 1_000_000_000,
    oiChangePct: 0.01,
    liquidationLong: 0,
    liquidationShort: 0,
    orderbookImbalance: 0.15,
    orderbookDepth: NEUTRAL_DEPTH,
    whaleActivity: NEUTRAL_WHALE,
    liquidationClusters: NEUTRAL_LIQ_CLUSTERS,
    crossExchange: NEUTRAL_CROSS_EXCHANGE,
    sentimentScore: 0.1,
    fearGreed: 55,
    newsEventScore: 0,
    sourceCredibilityScore: 0.5,
    regime: RegimeType.TRENDING_BULL,
    candles: [],
    ...overrides,
  };
}

describe("Technical Score", () => {
  it("scores 100 when all LONG conditions met", () => {
    const candidate = makeCandidate({ direction: Direction.LONG });
    const snap = makeSnapshot({
      price: 87000,
      ema50: 86000,
      ema200: 84000,
      rsi: 55,
      macdHistogram: 20,
      vwap: 86500,
    });
    expect(scoreTechnicals(candidate, snap)).toBe(100);
  });

  it("scores 0 when no conditions met", () => {
    const candidate = makeCandidate({ direction: Direction.LONG });
    const snap = makeSnapshot({
      price: 83000,
      ema50: 86000,
      ema200: 84000,
      rsi: 80,
      macdHistogram: -20,
      vwap: 87000,
    });
    expect(scoreTechnicals(candidate, snap)).toBe(0);
  });
});

describe("Confidence Mapping", () => {
  it("maps scores to correct levels", () => {
    expect(mapScoreToConfidence(85)).toBe(ConfidenceLevel.HIGH);
    expect(mapScoreToConfidence(72)).toBe(ConfidenceLevel.MEDIUM);
    expect(mapScoreToConfidence(55)).toBe(ConfidenceLevel.LOW);
    expect(mapScoreToConfidence(40)).toBe(ConfidenceLevel.REJECT);
  });
});

describe("Risk Penalty", () => {
  it("adds penalty for high ATR", () => {
    const candidate = makeCandidate();
    const snap = makeSnapshot({ atr: 4000, price: 87000 }); // atr/price > 0.04
    const penalty = scoreRiskPenalty(candidate, snap);
    expect(penalty).toBeGreaterThan(0);
  });

  it("flags crowded longs", () => {
    const candidate = makeCandidate({ direction: Direction.LONG });
    const snap = makeSnapshot({ fundingRate: 0.06 });
    scoreRiskPenalty(candidate, snap);
    expect(candidate.riskFlags).toContain("CROWDED_LONGS");
  });
});

describe("News Score", () => {
  it("starts at neutral 50 with no news", () => {
    const candidate = makeCandidate();
    const snap = makeSnapshot({ newsEventScore: 0, sentimentScore: 0, sourceCredibilityScore: 0.5 });
    const score = scoreNewsContext(candidate, snap);
    expect(score).toBe(55); // 50 + 0 + 0 + 0.5*10
  });

  it("boosts long score with positive news", () => {
    const candidate = makeCandidate({ direction: Direction.LONG });
    const snap = makeSnapshot({ newsEventScore: 0.8, sentimentScore: 0.5, sourceCredibilityScore: 0.8 });
    const score = scoreNewsContext(candidate, snap);
    expect(score).toBeGreaterThan(60);
  });
});
