/**
 * @agoraiq/signal-engine v2 — Sentiment Service (Per-Asset)
 *
 * WHAT THIS MEASURES AND WHAT IT DOESN'T
 * ───────────────────────────────────────
 * This service produces a per-asset sentiment score by compositing
 * three signals with explicit weights:
 *
 * 1. Funding Rate Deviation (weight: 0.50)
 *    Per-asset. Compares the current funding rate against its own rolling
 *    average over the last 12 readings (~1h at 5min cycles). A funding
 *    rate that is high relative to its own recent mean is more informative
 *    than one that is high in absolute terms, because different assets
 *    have different baseline funding regimes.
 *
 * 2. OI Velocity (weight: 0.30)
 *    Per-asset. Uses oiChangePct from the derivatives service. Rapid OI
 *    growth = new positioning = directional conviction. Rapid OI decline
 *    = position exits = conviction fading. On its own this is directionally
 *    ambiguous — combined with funding direction it becomes useful.
 *
 * 3. Fear & Greed Index (weight: 0.20)
 *    MARKET-WIDE. A single number for all of crypto. NOT asset-specific.
 *    Included because extreme readings (< 20 or > 80) provide weak regime
 *    context. Low weight because: updated once daily (stale), reflects BTC
 *    dominance not altcoin conditions, is backward-looking.
 *
 * WHAT THIS DOES NOT HAVE:
 *    - Social volume / mention delta (needs LunarCrush or Santiment API)
 *    - On-chain flow data (needs Glassnode)
 *    - Exchange deposit/withdrawal flow
 *    - Options skew / put-call ratio
 */

import axios from "axios";
import { logger } from "./logger";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SentimentContext {
  /** Per-asset composite: -1 (bearish) to +1 (bullish) */
  aggregateScore: number;
  /** Market-wide Fear & Greed: 0-100 */
  fearGreed: number;
  /** Funding deviation from rolling mean (debug) */
  fundingDeviation: number;
  /** How much of the score is backed by real data vs defaults (0-1) */
  confidence: number;
}

// ─── Component Weights ─────────────────────────────────────────────────────────

const WEIGHT_FUNDING = 0.50;
const WEIGHT_OI = 0.30;
const WEIGHT_FG = 0.20;

// ─── Funding Rate History (per-asset rolling window) ───────────────────────────

const fundingHistory = new Map<string, number[]>();
const FUNDING_WINDOW = 12; // 12 readings ≈ 1h at 5min intervals

/**
 * Record a funding rate and return the deviation from its rolling mean.
 * Positive = funding moved bullish relative to its recent baseline.
 */
function recordFundingAndGetDeviation(symbol: string, currentRate: number): number {
  let history = fundingHistory.get(symbol);
  if (!history) {
    history = [];
    fundingHistory.set(symbol, history);
  }

  history.push(currentRate);
  if (history.length > FUNDING_WINDOW) history.shift();

  if (history.length < 3) return 0;

  const mean = history.reduce((sum, r) => sum + r, 0) / history.length;
  const deviation = currentRate - mean;

  // Normalize: funding rates typically range ±0.03% (0.0003).
  // A deviation of 0.0002 from mean is significant.
  return Math.max(-1, Math.min(1, deviation / 0.0002));
}

// ─── OI Velocity Scoring ───────────────────────────────────────────────────────

/**
 * Score OI velocity combined with funding direction.
 *   Rising OI + rising funding = new longs entering (bullish)
 *   Rising OI + falling funding = new shorts entering (bearish)
 *   Falling OI = positions closing (conviction fading)
 */
function scoreOIVelocity(oiChangePct: number, fundingDeviation: number): number {
  const oiMagnitude = Math.max(-1, Math.min(1, oiChangePct / 0.03));

  if (oiMagnitude > 0.1) {
    // OI growing: direction depends on funding
    return fundingDeviation > 0 ? oiMagnitude * 0.8 : -oiMagnitude * 0.8;
  }
  if (oiMagnitude < -0.1) {
    // OI declining: conviction fading, slight reversion signal
    return fundingDeviation > 0 ? -oiMagnitude * 0.3 : oiMagnitude * 0.3;
  }
  return 0;
}

// ─── Fear & Greed Cache ────────────────────────────────────────────────────────

let fgCache: { value: number; fetchedAt: number } | null = null;
const FG_CACHE_TTL_MS = 60 * 60 * 1000;

async function fetchFearGreedIndex(): Promise<number> {
  if (fgCache && Date.now() - fgCache.fetchedAt < FG_CACHE_TTL_MS) {
    return fgCache.value;
  }
  try {
    const res = await axios.get("https://api.alternative.me/fng/", {
      params: { limit: 1, format: "json" },
      timeout: 5000,
    });
    const data = res.data?.data?.[0];
    if (!data) return fgCache?.value ?? 50;
    const value = parseInt(data.value, 10);
    fgCache = { value: isNaN(value) ? 50 : value, fetchedAt: Date.now() };
    return fgCache.value;
  } catch (err: any) {
    logger.warn(`Fear & Greed fetch failed: ${err.message ?? err}`);
    return fgCache?.value ?? 50;
  }
}

// ─── Main function ─────────────────────────────────────────────────────────────

const NEUTRAL: SentimentContext = {
  aggregateScore: 0, fearGreed: 50, fundingDeviation: 0, confidence: 0,
};

/**
 * Get per-asset sentiment context.
 *
 * @param symbol - Asset symbol (BTC, ETH, etc.)
 * @param fundingRate - Current funding rate (from derivatives service)
 * @param oiChangePct - OI change % over last hour (from derivatives service)
 */
export async function getAssetSentiment(
  symbol: string,
  fundingRate = 0,
  oiChangePct = 0
): Promise<SentimentContext> {
  try {
    let dataPoints = 0;

    // Component 1: Funding Rate Deviation (per-asset)
    const fundingDeviation = recordFundingAndGetDeviation(symbol, fundingRate);
    if ((fundingHistory.get(symbol)?.length ?? 0) >= 3) dataPoints++;

    // Component 2: OI Velocity (per-asset)
    const oiScore = scoreOIVelocity(oiChangePct, fundingDeviation);
    if (Math.abs(oiChangePct) > 0.001) dataPoints++;

    // Component 3: Fear & Greed (market-wide, weak)
    const fearGreed = await fetchFearGreedIndex();
    const fgNormalized = (fearGreed - 50) / 50;
    dataPoints++;

    // Composite
    const raw =
      WEIGHT_FUNDING * fundingDeviation +
      WEIGHT_OI * oiScore +
      WEIGHT_FG * fgNormalized;

    const aggregateScore = Math.max(-1, Math.min(1, raw));
    const confidence = dataPoints / 3;

    const result: SentimentContext = {
      aggregateScore, fearGreed, fundingDeviation, confidence,
    };

    logger.debug(
      `Sentiment ${symbol}: agg=${aggregateScore.toFixed(2)} ` +
        `[funding=${fundingDeviation.toFixed(2)}×${WEIGHT_FUNDING} ` +
        `oi=${oiScore.toFixed(2)}×${WEIGHT_OI} ` +
        `fg=${fgNormalized.toFixed(2)}×${WEIGHT_FG}] ` +
        `conf=${confidence.toFixed(1)}`
    );

    return result;
  } catch (err: any) {
    logger.warn(`Sentiment failed for ${symbol}: ${err.message ?? err}`);
    return NEUTRAL;
  }
}
