/**
 * @agoraiq/signal-engine — Level Detection Service
 *
 * Detects support and resistance from swing point clustering.
 *
 * APPROACH
 * ───────
 * 1. Swing point identification: a bar whose high (or low) is the
 *    most extreme within N bars on each side. This finds actual
 *    pivot points, not just the highest bar in a window.
 *
 * 2. Proximity clustering: swing points within clusterPct of each
 *    other are merged into a single zone. The zone's price is the
 *    volume-weighted average of its members. This prevents treating
 *    86,100 and 86,200 as two separate levels when they're the
 *    same zone that the market sees.
 *
 * 3. Touch counting: each time price visits a zone (high touches
 *    resistance, low touches support) without breaking through,
 *    the zone's strength increases. A level tested 4 times is
 *    more significant than one tested once.
 *
 * 4. Recency weighting: zones formed within the last lookback/2
 *    bars get a 1.5x strength multiplier. Old levels decay.
 *
 * WHAT THIS DOES NOT DO:
 *    - Volume profile (needs tick data, not OHLCV)
 *    - Order flow imprint (needs L2 book history)
 *    - Multi-timeframe confluence (each call is single-timeframe)
 *
 * OUTPUT
 * ──────
 * Returns arrays of Level objects sorted by strength (strongest first).
 * Each level has: price, strength (0-1 normalized), touchCount,
 * lastTouchIndex, and whether it's above or below current price.
 */

import type { Candle } from "../types";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface Level {
  price: number;
  strength: number;       // 0-1 normalized
  touchCount: number;
  lastTouchIndex: number; // bar index of most recent touch
  type: "support" | "resistance";
}

export interface DetectedLevels {
  resistance: Level[];    // sorted by strength desc, above current price
  support: Level[];       // sorted by strength desc, below current price
  /** The single strongest resistance above price, or null */
  nearestResistance: Level | null;
  /** The single strongest support below price, or null */
  nearestSupport: Level | null;
}

// ─── Configuration ─────────────────────────────────────────────────────────────

const SWING_LOOKBACK = 5;       // bars on each side to qualify as swing point
const CLUSTER_PCT = 0.005;      // 0.5% proximity to merge into same zone
const MIN_TOUCHES = 1;          // minimum touches to be a valid level
const RECENCY_MULTIPLIER = 1.5; // bonus for levels in recent half of data

// ─── Swing Point Detection ─────────────────────────────────────────────────────

interface SwingPoint {
  price: number;
  index: number;
  volume: number;
  type: "high" | "low";
}

function findSwingPoints(candles: Candle[], lookback: number): SwingPoint[] {
  const points: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const bar = candles[i];

    // Swing high: bar.high >= all highs within lookback on both sides
    let isSwingHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high > bar.high) {
        isSwingHigh = false;
        break;
      }
    }

    // Swing low: bar.low <= all lows within lookback on both sides
    let isSwingLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].low < bar.low) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingHigh) {
      points.push({ price: bar.high, index: i, volume: bar.volume, type: "high" });
    }
    if (isSwingLow) {
      points.push({ price: bar.low, index: i, volume: bar.volume, type: "low" });
    }
  }

  return points;
}

// ─── Clustering ────────────────────────────────────────────────────────────────

interface Cluster {
  price: number;           // volume-weighted average price
  totalVolume: number;
  touchCount: number;
  lastTouchIndex: number;
  type: "high" | "low";
}

function clusterSwingPoints(points: SwingPoint[], clusterPct: number): Cluster[] {
  if (points.length === 0) return [];

  // Sort by price
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters: Cluster[] = [];

  let current: Cluster = {
    price: sorted[0].price,
    totalVolume: sorted[0].volume,
    touchCount: 1,
    lastTouchIndex: sorted[0].index,
    type: sorted[0].type,
  };

  for (let i = 1; i < sorted.length; i++) {
    const point = sorted[i];
    const pctDiff = Math.abs(point.price - current.price) / current.price;

    if (pctDiff <= clusterPct) {
      // Merge into current cluster (volume-weighted average)
      const totalVol = current.totalVolume + point.volume;
      current.price =
        (current.price * current.totalVolume + point.price * point.volume) / totalVol;
      current.totalVolume = totalVol;
      current.touchCount++;
      current.lastTouchIndex = Math.max(current.lastTouchIndex, point.index);
      // If any member is a high, the cluster is resistance; if low, support
      // Mixed clusters get classified by majority
      if (point.type === "high") current.type = "high";
    } else {
      clusters.push(current);
      current = {
        price: point.price,
        totalVolume: point.volume,
        touchCount: 1,
        lastTouchIndex: point.index,
        type: point.type,
      };
    }
  }
  clusters.push(current);

  return clusters;
}

// ─── Touch Counting (post-formation) ───────────────────────────────────────────

function countTouches(
  cluster: Cluster,
  candles: Candle[],
  clusterPct: number
): number {
  let touches = cluster.touchCount; // start with formation touches
  const zone = cluster.price * clusterPct;

  // Count bars after the cluster's last formation point that touched the zone
  for (let i = cluster.lastTouchIndex + 1; i < candles.length; i++) {
    const bar = candles[i];

    if (cluster.type === "high") {
      // Resistance: bar's high entered the zone but close stayed below
      if (bar.high >= cluster.price - zone && bar.close < cluster.price) {
        touches++;
      }
    } else {
      // Support: bar's low entered the zone but close stayed above
      if (bar.low <= cluster.price + zone && bar.close > cluster.price) {
        touches++;
      }
    }
  }

  return touches;
}

// ─── Main Detection ────────────────────────────────────────────────────────────

/**
 * Detect support and resistance levels from candle data.
 *
 * @param candles   - OHLCV bars, oldest first
 * @param lookback  - how many bars to consider (uses the last N)
 * @param currentPrice - current price to classify levels as S or R
 */
export function detectLevels(
  candles: Candle[],
  lookback = 100,
  currentPrice?: number
): DetectedLevels {
  const slice = candles.slice(-lookback);
  const price = currentPrice ?? slice[slice.length - 1]?.close ?? 0;

  if (slice.length < SWING_LOOKBACK * 3) {
    return { resistance: [], support: [], nearestResistance: null, nearestSupport: null };
  }

  // 1. Find swing points
  const swingPoints = findSwingPoints(slice, SWING_LOOKBACK);

  // 2. Cluster by proximity
  const clusters = clusterSwingPoints(swingPoints, CLUSTER_PCT);

  // 3. Count post-formation touches and compute strength
  const recencyThreshold = slice.length / 2;
  let maxTouches = 1;

  const enriched = clusters.map((c) => {
    const touches = countTouches(c, slice, CLUSTER_PCT);
    if (touches > maxTouches) maxTouches = touches;
    return { ...c, touchCount: touches };
  });

  // 4. Score and classify
  const levels: Level[] = enriched
    .filter((c) => c.touchCount >= MIN_TOUCHES)
    .map((c) => {
      // Raw strength from touches + volume + recency
      let raw = c.touchCount / maxTouches;

      // Recency bonus
      if (c.lastTouchIndex > recencyThreshold) {
        raw *= RECENCY_MULTIPLIER;
      }

      const type: Level["type"] = c.price > price ? "resistance" : "support";

      return {
        price: c.price,
        strength: Math.min(1, raw),
        touchCount: c.touchCount,
        lastTouchIndex: c.lastTouchIndex,
        type,
      };
    });

  // 5. Split and sort
  const resistance = levels
    .filter((l) => l.type === "resistance")
    .sort((a, b) => b.strength - a.strength);

  const support = levels
    .filter((l) => l.type === "support")
    .sort((a, b) => b.strength - a.strength);

  // Nearest: strongest level within 3% of current price
  const nearestResistance = resistance.find(
    (l) => (l.price - price) / price < 0.03
  ) ?? null;

  const nearestSupport = support.find(
    (l) => (price - l.price) / price < 0.03
  ) ?? null;

  return { resistance, support, nearestResistance, nearestSupport };
}

// ─── Legacy API (backward compat) ──────────────────────────────────────────────

export function getRecentResistance(candles: Candle[], lookback = 20): number {
  const levels = detectLevels(candles, lookback);
  return levels.nearestResistance?.price ?? Math.max(...candles.slice(-lookback).map((c) => c.high));
}

export function getRecentSupport(candles: Candle[], lookback = 20): number {
  const levels = detectLevels(candles, lookback);
  return levels.nearestSupport?.price ?? Math.min(...candles.slice(-lookback).map((c) => c.low));
}
