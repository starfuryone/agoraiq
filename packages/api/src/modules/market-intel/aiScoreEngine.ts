// ============================================================
// AgoraIQ Market Intel — AI Trade Probability Score Engine
// /services/aiScoreEngine.ts
// ============================================================

import type {
  ScoreInputs,
  ScoreResult,
  Side,
  Confidence,
} from './index.js';

// ── Weights (must sum to 1.0) ────────────────────────────────
const WEIGHTS = {
  provider_accuracy:  0.25,
  momentum_strength:  0.20,
  volume_spike:       0.15,
  volatility_regime:  0.15,
  sentiment_score:    0.15,
  funding_rate_signal:0.10,
} as const;

// ── Confidence thresholds ─────────────────────────────────────
const CONFIDENCE_THRESHOLDS: Record<Confidence, number> = {
  HIGH: 0.70,
  MED:  0.55,
  LOW:  0.00,
};

// ── Normalisation helpers ─────────────────────────────────────

/**
 * Hard-clip a value to [0, 1].
 */
export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Min-max normalise a raw value given its expected [min, max] domain.
 * Returns a value in [0, 1].
 */
export function normaliseMinMax(
  value: number,
  min: number,
  max: number,
): number {
  if (max === min) return 0.5;
  return clamp01((value - min) / (max - min));
}

/**
 * Normalise a win-rate percentage (0–100) → 0..1.
 * Anything below 40 % is treated as near-zero signal.
 */
export function normaliseWinRate(winRatePct: number): number {
  return clamp01((winRatePct - 40) / 60); // 40 % floor, 100 % ceiling
}

/**
 * Normalise a funding-rate value to a directional signal.
 *  - Positive funding (longs paying) → weakens bullish case → lower score
 *  - Negative funding (shorts paying) → contrarian bull signal → higher score
 * Returns 0..1 where 1 = strongly bearish funding (good for shorts) or
 *   strongly negative funding (good for longs if going long into -ve).
 *
 * Convention here: map funding rate as an absolute magnitude signal.
 * Direction context is handled externally via `side`.
 */
export function normaliseFundingRate(fundingRatePct: number): number {
  // Typical range: -0.1 % to +0.1 %
  const abs = Math.abs(fundingRatePct);
  return clamp01(abs / 0.1); // 0.1 % max → score of 1
}

/**
 * Normalise a volume spike ratio (currentVol / avgVol) → 0..1.
 * 1x = no spike (score 0), ≥3x = full signal (score 1).
 */
export function normaliseVolumeSpike(ratio: number): number {
  return clamp01((ratio - 1) / 2); // linear between 1x and 3x
}

/**
 * Normalise volatility regime.
 * Maps ATR% or stdev% to 0..1.
 * Very high volatility is NOT unconditionally good; this function
 * peaks at moderate volatility and falls off at extremes.
 * For the scoring formula we use a moderate-volatility sweet spot.
 *
 * Range: 0 % → low (0), ~3 % → optimal (1), ≥6 % → declining.
 */
export function normaliseVolatilityRegime(volatilityPct: number): number {
  // Bell-ish shape: peak at ~3%
  const optimal = 3.0;
  const sigma   = 2.5;
  return clamp01(Math.exp(-0.5 * ((volatilityPct - optimal) / sigma) ** 2));
}

// ── Expected-R heuristic ──────────────────────────────────────
/**
 * Simple Expected R estimate.
 * R = base_r * volatility_multiplier
 * where:
 *   base_r            = 1.0 + (score * 2)          → 1.0..3.0
 *   volatility_factor = 1 + normalised_volatility  → 1.0..2.0
 *
 * Capped at 5R; rounds to 1 decimal.
 * Documentation: Higher probability trades with breakout-level volatility
 * can yield wider R-multiples because targets are typically set at
 * structural levels that align with the expanded ATR range.
 */
function estimateExpectedR(score: number, volatilityRegime: number): number {
  const baseR       = 1.0 + score * 2.0;
  const volFactor   = 1.0 + volatilityRegime;
  const raw         = baseR * volFactor;
  return Math.round(Math.min(raw, 5.0) * 10) / 10;
}

// ── Confidence mapping ────────────────────────────────────────
export function mapConfidence(score: number): Confidence {
  if (score >= CONFIDENCE_THRESHOLDS.HIGH) return 'HIGH';
  if (score >= CONFIDENCE_THRESHOLDS.MED)  return 'MED';
  return 'LOW';
}

// ── Core scoring formula ──────────────────────────────────────
/**
 * Calculate trade probability score.
 *
 * @param inputs  - Normalised (0..1) input signals
 * @param symbol  - Trading pair e.g. "BTCUSDT"
 * @param side    - "LONG" or "SHORT"
 */
export function calculateTradeScore(
  inputs: ScoreInputs,
  symbol: string,
  side: Side,
): ScoreResult {
  // Validate all inputs are within 0..1
  const sanitised: ScoreInputs = {
    provider_accuracy:   clamp01(inputs.provider_accuracy),
    momentum_strength:   clamp01(inputs.momentum_strength),
    volume_spike:        clamp01(inputs.volume_spike),
    volatility_regime:   clamp01(inputs.volatility_regime),
    sentiment_score:     clamp01(inputs.sentiment_score),
    funding_rate_signal: clamp01(inputs.funding_rate_signal),
  };

  const score =
    WEIGHTS.provider_accuracy   * sanitised.provider_accuracy   +
    WEIGHTS.momentum_strength   * sanitised.momentum_strength   +
    WEIGHTS.volume_spike        * sanitised.volume_spike        +
    WEIGHTS.volatility_regime   * sanitised.volatility_regime   +
    WEIGHTS.sentiment_score     * sanitised.sentiment_score     +
    WEIGHTS.funding_rate_signal * sanitised.funding_rate_signal;

  const roundedScore   = Math.round(score * 1000) / 1000;
  const probabilityPct = Math.round(roundedScore * 100);
  const confidence     = mapConfidence(roundedScore);
  const expectedR      = estimateExpectedR(roundedScore, sanitised.volatility_regime);

  return {
    symbol,
    side,
    score:        roundedScore,
    probabilityPct,
    confidence,
    expectedR,
    inputs:       sanitised,
    computedAt:   new Date(),
  };
}

// ── Bulk scoring helper ───────────────────────────────────────
export interface SignalCandidate {
  symbol: string;
  side: Side;
  rawInputs: {
    winRatePct: number;           // 0–100
    momentumPct: number;          // e.g. 5 = +5% price change vs MA
    volumeRatio: number;          // currentVol / avgVol
    volatilityPct: number;        // ATR% or stdev%
    sentimentRaw: number;         // already 0..1 from sentimentProvider
    fundingRatePct: number;       // e.g. 0.01 = 0.01%
  };
}

/**
 * Normalise raw exchange data into ScoreInputs then run scoring.
 * This is the primary entry-point called by the scheduler.
 */
export function scoreSignalCandidate(candidate: SignalCandidate): ScoreResult {
  const { rawInputs } = candidate;

  const inputs: ScoreInputs = {
    provider_accuracy:   normaliseWinRate(rawInputs.winRatePct),
    momentum_strength:   normaliseMinMax(rawInputs.momentumPct, -10, 10),
    volume_spike:        normaliseVolumeSpike(rawInputs.volumeRatio),
    volatility_regime:   normaliseVolatilityRegime(rawInputs.volatilityPct),
    sentiment_score:     clamp01(rawInputs.sentimentRaw),
    funding_rate_signal: normaliseFundingRate(rawInputs.fundingRatePct),
  };

  return calculateTradeScore(inputs, candidate.symbol, candidate.side);
}

// ── Default export ────────────────────────────────────────────
export default {
  calculateTradeScore,
  scoreSignalCandidate,
  mapConfidence,
  normaliseWinRate,
  normaliseVolumeSpike,
  normaliseVolatilityRegime,
  normaliseFundingRate,
  normaliseMinMax,
  clamp01,
};
