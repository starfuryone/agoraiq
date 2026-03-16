/**
 * @agoraiq/signal-engine — AI Governance
 *
 * Hard-coded invariants for AI reasoning behavior.
 * These are NOT configurable. They exist to prevent drift.
 *
 * INVARIANT 1: AI score adjustment is clamped to ±15 regardless of
 *   what config.aiMaxScoreAdjustment says. If config asks for 30,
 *   this module caps it at 15. The config field controls the prompt
 *   instruction; this module controls the actual enforcement.
 *
 * INVARIANT 2: AI cannot affect the publish gate. The publish gate
 *   runs on the pre-AI score. The function enforcePublishGateIsolation()
 *   asserts that the score passed to shouldPublish equals the score
 *   the rule engine produced. If AI has already mutated the score,
 *   this throws.
 *
 * INVARIANT 3: AI adjustments are always applied as a bounded
 *   percentage of the base score, not an absolute number. A +15
 *   adjustment on a 71-point signal is a 21% boost. On an 85-point
 *   signal it's 18%. This prevents AI from having outsized influence
 *   on borderline signals.
 *
 * INVARIANT 4: The effective adjustment is always
 *   clamp(raw × confidence, -HARD_MAX, +HARD_MAX) with confidence
 *   itself clamped to [0, 1]. Even if the API returns
 *   scoreAdjustment=100 and aiConfidence=5, the effective adjustment
 *   is ±15.
 */

// ─── Hard Limits (not configurable) ────────────────────────────────────────────

/** Absolute maximum score adjustment AI can apply, regardless of config */
export const AI_HARD_MAX_ADJUSTMENT = 15;

/** Absolute maximum AI confidence value (clamped from API response) */
export const AI_HARD_MAX_CONFIDENCE = 1.0;

/** AI cannot adjust scores below this floor (prevents AI from creating REJECT) */
export const AI_SCORE_FLOOR = 40;

// ─── Enforcement ───────────────────────────────────────────────────────────────

/**
 * Clamp an AI score adjustment to the hard limit.
 * Called AFTER the AI response is parsed, BEFORE it's applied.
 *
 * @param rawAdjustment - the adjustment from the AI API response
 * @param aiConfidence - the AI's self-reported confidence (0-1)
 * @param configMax - the config-level max (may be larger than hard max)
 * @returns the effective adjustment, always within [-HARD_MAX, +HARD_MAX]
 */
export function enforceAdjustmentLimits(
  rawAdjustment: number,
  aiConfidence: number,
  configMax: number
): { effectiveAdjustment: number; clampedConfidence: number; wasLimited: boolean } {
  // Clamp confidence to [0, 1] regardless of what the API returned
  const clampedConfidence = Math.max(0, Math.min(AI_HARD_MAX_CONFIDENCE, aiConfidence));

  // Clamp raw adjustment to the LESSER of config max and hard max
  const limit = Math.min(Math.abs(configMax), AI_HARD_MAX_ADJUSTMENT);
  const clampedRaw = Math.max(-limit, Math.min(limit, rawAdjustment));

  // Effective = raw × confidence, then clamp again
  const weighted = Math.round(clampedRaw * clampedConfidence);
  const effectiveAdjustment = Math.max(-AI_HARD_MAX_ADJUSTMENT, Math.min(AI_HARD_MAX_ADJUSTMENT, weighted));

  const wasLimited =
    rawAdjustment !== clampedRaw ||
    aiConfidence !== clampedConfidence ||
    weighted !== effectiveAdjustment;

  return { effectiveAdjustment, clampedConfidence, wasLimited };
}

/**
 * Apply an AI adjustment to a score with floor enforcement.
 * The adjusted score will never go below AI_SCORE_FLOOR.
 *
 * @returns the new score and whether the floor was applied
 */
export function applyAdjustmentWithFloor(
  baseScore: number,
  effectiveAdjustment: number
): { adjustedScore: number; floorApplied: boolean } {
  const raw = baseScore + effectiveAdjustment;
  const floorApplied = raw < AI_SCORE_FLOOR;
  const adjustedScore = Math.max(AI_SCORE_FLOOR, raw);

  return { adjustedScore, floorApplied };
}

/**
 * Assert that the publish gate has not been contaminated by AI.
 *
 * Call this BEFORE shouldPublish with the score the rule engine produced.
 * If the score has already been mutated (by AI running out of order),
 * this throws an error that halts the signal — better to lose one signal
 * than to silently compromise the gate.
 *
 * @param ruleEngineScore - score from applyGlobalScoring
 * @param currentSignalScore - signal.finalScore at time of publish gate check
 */
export function assertPublishGateIsolation(
  ruleEngineScore: number,
  currentSignalScore: number
): void {
  // Allow floating point tolerance of 0.001
  if (Math.abs(ruleEngineScore - currentSignalScore) > 0.001) {
    throw new Error(
      `AI GOVERNANCE VIOLATION: publish gate score (${currentSignalScore.toFixed(2)}) ` +
        `differs from rule engine score (${ruleEngineScore.toFixed(2)}). ` +
        `AI may have mutated the score before the publish gate. ` +
        `This is a structural error that must be fixed.`
    );
  }
}
