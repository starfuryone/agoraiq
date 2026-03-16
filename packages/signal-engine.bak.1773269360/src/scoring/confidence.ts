/**
 * @agoraiq/signal-engine — Confidence Mapping
 */

import { ConfidenceLevel } from "../types";

export function mapScoreToConfidence(score: number): ConfidenceLevel {
  if (score >= 80) return ConfidenceLevel.HIGH;
  if (score >= 65) return ConfidenceLevel.MEDIUM;
  if (score >= 50) return ConfidenceLevel.LOW;
  return ConfidenceLevel.REJECT;
}
