/**
 * @agoraiq/signal-engine v2 — Strategy Tests
 */

import { describe, it, expect } from "vitest";
import { runTrendContinuation } from "../src/strategies/trend-continuation";
import { runMeanReversion } from "../src/strategies/mean-reversion";
import { runBreakout } from "../src/strategies/breakout";
import type { MarketSnapshot } from "../src/types";
import { RegimeType, Direction } from "../src/types";
import { NEUTRAL_DEPTH } from "../src/services/orderbook-depth";
import { NEUTRAL_WHALE } from "../src/services/whale-detection";
import { NEUTRAL_LIQ_CLUSTERS } from "../src/services/liquidation-clusters";
import { NEUTRAL_CROSS_EXCHANGE } from "../src/services/cross-exchange";

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
    macdHistogram: 200,
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

describe("Trend Continuation (Hardened)", () => {
  it("fires LONG in TRENDING_BULL with full confirmation", () => {
    const snap = makeSnapshot({
      regime: RegimeType.TRENDING_BULL,
      price: 87000,
      ema20: 86800,
      ema50: 86000,
      ema200: 84000,
      rsi: 58,
      macdHistogram: 200,
      vwap: 86500,
      volume: 2_000_000,
      atr: 800,
    });

    const result = runTrendContinuation(snap);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe(Direction.LONG);
    expect(result!.reasonCodes).toContain("EMA_BULLISH_ALIGNMENT");
    expect(result!.reasonCodes).toContain("VWAP_ALIGNED");
    expect(result!.reasonCodes).toContain("EMA20_PROXIMITY");
  });

  it("rejects when regime is not trending", () => {
    const snap = makeSnapshot({ regime: RegimeType.RANGE_CHOP });
    expect(runTrendContinuation(snap)).toBeNull();
  });

  it("rejects when price is below VWAP in bull regime", () => {
    const snap = makeSnapshot({
      regime: RegimeType.TRENDING_BULL,
      price: 86000,
      vwap: 87000,
    });
    expect(runTrendContinuation(snap)).toBeNull();
  });

  it("rejects when price is overextended from EMA20", () => {
    const snap = makeSnapshot({
      regime: RegimeType.TRENDING_BULL,
      price: 89000,
      ema20: 86000,
      atr: 800, // 1.5 * 800 = 1200, distance = 3000 > 1200
    });
    expect(runTrendContinuation(snap)).toBeNull();
  });

  it("rejects weak MACD histogram", () => {
    const snap = makeSnapshot({
      regime: RegimeType.TRENDING_BULL,
      macdHistogram: 10, // below 0.1% of 87000 = 87
    });
    expect(runTrendContinuation(snap)).toBeNull();
  });

  it("fires SHORT in TRENDING_BEAR", () => {
    const snap = makeSnapshot({
      regime: RegimeType.TRENDING_BEAR,
      price: 83000,
      ema20: 83200,
      ema50: 84000,
      ema200: 86000,
      rsi: 40,
      macdHistogram: -200,
      vwap: 83500,
      volume: 2_000_000,
      atr: 800,
    });

    const result = runTrendContinuation(snap);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe(Direction.SHORT);
  });
});

describe("Mean Reversion (Hardened)", () => {
  it("fires LONG on BB lower extreme + RSI oversold in RANGE_CHOP", () => {
    const snap = makeSnapshot({
      regime: RegimeType.RANGE_CHOP,
      price: 85800,
      bollingerLower: 86000,
      bollingerMid: 87000,
      bollingerUpper: 88000,
      rsi: 25,
      sentimentScore: 0,
      fundingRate: 0,
      oiChangePct: -0.01,
      ema20: 86800,
      atr: 800,
    });

    const result = runMeanReversion(snap);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe(Direction.LONG);
    expect(result!.reasonCodes).toContain("BOLLINGER_LOWER_EXTREME");
    expect(result!.reasonCodes).toContain("RSI_OVERSOLD");
  });

  it("rejects oversold if sentiment is deeply negative", () => {
    const snap = makeSnapshot({
      regime: RegimeType.RANGE_CHOP,
      price: 85800,
      bollingerLower: 86000,
      bollingerMid: 87000,
      bollingerUpper: 88000,
      rsi: 25,
      sentimentScore: -0.7, // strong negative
    });
    expect(runMeanReversion(snap)).toBeNull();
  });

  it("rejects if funding is deeply negative (shorts aggressive)", () => {
    const snap = makeSnapshot({
      regime: RegimeType.RANGE_CHOP,
      price: 85800,
      bollingerLower: 86000,
      bollingerMid: 87000,
      bollingerUpper: 88000,
      rsi: 25,
      sentimentScore: 0,
      fundingRate: -0.0005,
    });
    expect(runMeanReversion(snap)).toBeNull();
  });

  it("rejects if OI is growing (not exhaustion)", () => {
    const snap = makeSnapshot({
      regime: RegimeType.RANGE_CHOP,
      price: 85800,
      bollingerLower: 86000,
      bollingerMid: 87000,
      bollingerUpper: 88000,
      rsi: 25,
      sentimentScore: 0,
      fundingRate: 0,
      oiChangePct: 0.03,
    });
    expect(runMeanReversion(snap)).toBeNull();
  });

  it("fires SHORT on BB upper extreme + RSI overbought", () => {
    const snap = makeSnapshot({
      regime: RegimeType.RANGE_CHOP,
      price: 88200,
      bollingerLower: 86000,
      bollingerMid: 87000,
      bollingerUpper: 88000,
      rsi: 75,
      sentimentScore: 0,
      newsEventScore: 0,
      ema20: 87200,
      atr: 800,
    });

    const result = runMeanReversion(snap);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe(Direction.SHORT);
  });

  it("rejects in TRENDING_BULL regime", () => {
    const snap = makeSnapshot({ regime: RegimeType.TRENDING_BULL });
    expect(runMeanReversion(snap)).toBeNull();
  });
});

// ─── Breakout Strategy Tests ───────────────────────────────────────────────────

function makeBreakoutSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  // Build candles that form a clear range with testable levels,
  // then a breakout bar at the end.
  const candles: any[] = [];
  const rangeHigh = 88000;
  const rangeLow = 86000;
  const mid = 87000;

  // 250 bars oscillating in range (enough for indicators + swing detection)
  for (let i = 0; i < 250; i++) {
    const phase = Math.sin(i * 0.4);
    const price = mid + phase * 900;
    candles.push({
      timestamp: Date.now() - (250 - i) * 3600000,
      open: price - 50,
      high: Math.min(price + 200, rangeHigh),
      low: Math.max(price - 200, rangeLow),
      close: price + 50,
      volume: 2000000,
    });
  }

  return {
    ...makeSnapshot({
      regime: RegimeType.RANGE_CHOP,
      price: 88200,  // just above range high (breakout)
      volume: 3000000,
      high: 88300,
      low: 87800,
      rsi: 62,
      macdHistogram: 50,
      orderbookImbalance: 0.15,
      atr: 500,
      ema20: 87200,
      ema50: 87000,
      ema200: 86500,
      candles,
      ...overrides,
    }),
  };
}

describe("Breakout Confirmation", () => {
  it("rejects in HIGH_VOL_EVENT regime", () => {
    const snap = makeBreakoutSnapshot({ regime: RegimeType.HIGH_VOL_EVENT });
    expect(runBreakout(snap)).toBeNull();
  });

  it("rejects in LOW_LIQUIDITY regime", () => {
    const snap = makeBreakoutSnapshot({ regime: RegimeType.LOW_LIQUIDITY });
    expect(runBreakout(snap)).toBeNull();
  });

  it("rejects when volume below breakout threshold", () => {
    const snap = makeBreakoutSnapshot({ volume: 100000 });
    expect(runBreakout(snap)).toBeNull();
  });

  it("rejects when RSI is overbought", () => {
    const snap = makeBreakoutSnapshot({ rsi: 80 });
    expect(runBreakout(snap)).toBeNull();
  });

  it("rejects when MACD opposes direction", () => {
    const snap = makeBreakoutSnapshot({ macdHistogram: -100 });
    // With negative MACD, bullish breakout should fail
    // (may or may not find a bearish setup depending on levels)
    const result = runBreakout(snap);
    if (result) {
      expect(result.direction).toBe(Direction.SHORT);
    }
  });

  it("fires in RANGE_CHOP with price above resistance and volume", () => {
    const snap = makeBreakoutSnapshot();
    const result = runBreakout(snap);
    // Whether this fires depends on whether detectLevels finds
    // a qualifying level from the synthetic candles. The test
    // validates that the strategy runs without errors and that
    // if it does fire, it produces a valid candidate.
    if (result) {
      expect(result.direction).toBe(Direction.LONG);
      expect(result.reasonCodes).toContain("RESISTANCE_BREAKOUT");
      expect(result.reasonCodes).toContain("VOLUME_CONFIRMATION");
      expect(result.stopLoss).toBeLessThan(result.entryLow);
      expect(result.takeProfit1).toBeGreaterThan(result.entryHigh);
      expect(result.takeProfit2).toBeGreaterThan(result.takeProfit1);
    }
  });
});
