/**
 * @agoraiq/signal-engine v2 — Level Detection Tests
 */

import { describe, it, expect } from "vitest";
import { detectLevels, type DetectedLevels } from "../src/services/levels";
import type { Candle } from "../src/types";

function makeCandles(count: number, basePrice = 87000, volatility = 500): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;

  for (let i = 0; i < count; i++) {
    const change = (Math.sin(i * 0.3) + Math.sin(i * 0.7)) * volatility * 0.3;
    price = basePrice + change;
    candles.push({
      timestamp: Date.now() - (count - i) * 60000,
      open: price - volatility * 0.1,
      high: price + volatility * 0.2,
      low: price - volatility * 0.2,
      close: price + volatility * 0.05,
      volume: 1000000 + Math.random() * 500000,
    });
  }

  return candles;
}

function makeRangeboundCandles(count: number, low: number, high: number): Candle[] {
  const candles: Candle[] = [];
  const mid = (low + high) / 2;
  const range = high - low;

  for (let i = 0; i < count; i++) {
    // Oscillate between support and resistance
    const phase = Math.sin(i * 0.5) * 0.45; // -0.45 to 0.45
    const price = mid + phase * range;

    candles.push({
      timestamp: Date.now() - (count - i) * 60000,
      open: price - range * 0.02,
      high: Math.min(price + range * 0.05, high + range * 0.01),
      low: Math.max(price - range * 0.05, low - range * 0.01),
      close: price + range * 0.01,
      volume: 1000000,
    });
  }

  return candles;
}

describe("Level Detection", () => {
  it("returns empty for insufficient data", () => {
    const candles = makeCandles(10);
    const result = detectLevels(candles, 100);
    expect(result.resistance).toHaveLength(0);
    expect(result.support).toHaveLength(0);
  });

  it("detects levels from rangebound candles", () => {
    // Create rangebound market between 86000 and 88000
    const candles = makeRangeboundCandles(120, 86000, 88000);
    const result = detectLevels(candles, 100, 87000);

    // Should find at least some levels
    const allLevels = [...result.resistance, ...result.support];
    expect(allLevels.length).toBeGreaterThan(0);
  });

  it("classifies levels correctly relative to price", () => {
    const candles = makeRangeboundCandles(120, 86000, 88000);
    const result = detectLevels(candles, 100, 87000);

    for (const r of result.resistance) {
      expect(r.price).toBeGreaterThan(87000);
      expect(r.type).toBe("resistance");
    }

    for (const s of result.support) {
      expect(s.price).toBeLessThan(87000);
      expect(s.type).toBe("support");
    }
  });

  it("strength is normalized between 0 and 1", () => {
    const candles = makeRangeboundCandles(120, 86000, 88000);
    const result = detectLevels(candles, 100, 87000);
    const all = [...result.resistance, ...result.support];

    for (const level of all) {
      expect(level.strength).toBeGreaterThanOrEqual(0);
      expect(level.strength).toBeLessThanOrEqual(1);
    }
  });

  it("levels are sorted by strength descending", () => {
    const candles = makeRangeboundCandles(120, 86000, 88000);
    const result = detectLevels(candles, 100, 87000);

    for (let i = 1; i < result.resistance.length; i++) {
      expect(result.resistance[i].strength).toBeLessThanOrEqual(result.resistance[i - 1].strength);
    }

    for (let i = 1; i < result.support.length; i++) {
      expect(result.support[i].strength).toBeLessThanOrEqual(result.support[i - 1].strength);
    }
  });
});
