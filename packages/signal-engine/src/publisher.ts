/**
 * @agoraiq/signal-engine v2 — Publisher
 *
 * Converts scored candidates into FinalSignals and POSTs to AgoraIQ.
 *
 * AI REASONING POLICY: ADVISORY ONLY
 * ───────────────────────────────────
 * The AI layer adjusts the score and provides narrative context.
 * It NEVER blocks publication. If the rule engine says publish,
 * the signal publishes. Period.
 *
 * Rationale: The rule engine is deterministic and backtestable.
 * AI is probabilistic and not backtestable. Letting AI veto
 * rule-engine decisions creates an untestable black box.
 * AI adds value as color commentary and minor score refinement.
 *
 * Persistence: Every published signal is written to SQLite
 * (signal_analysis table) for the learning loop and self-validation.
 */

import { createHash } from "crypto";
import { getProxiedAxios } from "./services/http-client";
import type {
  StrategySignalCandidate,
  MarketSnapshot,
  FinalSignal,
  EngineSignalPayload,
  AIReasoningOutput,
} from "./types";
import { Direction, SignalStatus, ConfidenceLevel } from "./types";
import { config, toSignalSymbol } from "./config";
import { formatAlertMessage } from "./explanation";
import { runAIReasoning } from "./services/ai-reasoning";
import { mapScoreToConfidence } from "./scoring/confidence";
import {
  enforceAdjustmentLimits,
  applyAdjustmentWithFloor,
  AI_HARD_MAX_ADJUSTMENT,
} from "./ai-governance";
import { insertSignalAnalysis, type AIAuditData } from "./persistence/db";
import { logger } from "./services/logger";

// ─── Publish Gate ──────────────────────────────────────────────────────────────

export function shouldPublish(
  candidate: StrategySignalCandidate | null
): boolean {
  if (!candidate) return false;
  if (candidate.confidence === ConfidenceLevel.REJECT) return false;
  if (candidate.finalScore < config.minPublishScore) return false;
  if (candidate.expectedR < config.minExpectedR) return false;
  return true;
}

// ─── Expiry Computation ────────────────────────────────────────────────────────

function computeExpiry(timeframe: string): Date {
  const now = new Date();
  const expiryMap: Record<string, number> = {
    "15m": 60 * 60 * 1000,
    "1h": 4 * 60 * 60 * 1000,
    "4h": 16 * 60 * 60 * 1000,
    "1d": 3 * 24 * 60 * 60 * 1000,
  };
  const ttl = expiryMap[timeframe] ?? 4 * 60 * 60 * 1000;
  return new Date(now.getTime() + ttl);
}

// ─── Deterministic Signal ID ───────────────────────────────────────────────────

function generateDeterministicId(candidate: StrategySignalCandidate): string {
  const bucket = Math.floor(candidate.timestamp.getTime() / config.scanIntervalMs);
  const input = [
    candidate.symbol,
    candidate.timeframe,
    candidate.strategyType,
    candidate.direction,
    bucket.toString(),
  ].join("|");

  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}

// ─── Convert to Final Signal ───────────────────────────────────────────────────

export function toFinalSignal(
  candidate: StrategySignalCandidate,
  snapshot: MarketSnapshot
): FinalSignal {
  return {
    signalId: generateDeterministicId(candidate),
    symbol: candidate.symbol,
    timeframe: candidate.timeframe,
    direction: candidate.direction,
    strategyType: candidate.strategyType,

    entryLow: candidate.entryLow,
    entryHigh: candidate.entryHigh,
    stopLoss: candidate.stopLoss,
    takeProfit1: candidate.takeProfit1,
    takeProfit2: candidate.takeProfit2,

    technicalScore: candidate.technicalScore,
    marketStructureScore: candidate.marketStructureScore,
    newsScore: candidate.newsScore,
    providerScore: candidate.providerScore,
    riskPenalty: candidate.riskPenalty,
    finalScore: candidate.finalScore,
    confidence: candidate.confidence,
    expectedR: candidate.expectedR,

    regime: snapshot.regime,
    reasonCodes: candidate.reasonCodes,
    riskFlags: candidate.riskFlags,

    status: SignalStatus.PENDING,
    publishedAt: new Date(),
    expiresAt: computeExpiry(candidate.timeframe),
  };
}

// ─── AI Reasoning (Advisory Only) ──────────────────────────────────────────────

/**
 * Run AI reasoning and apply score adjustment with governance enforcement.
 * ADVISORY ONLY: adjusts score and confidence band, NEVER blocks publication.
 *
 * All adjustments are clamped by ai-governance.ts hard limits regardless
 * of what the API returns or what config says.
 */
async function applyAIReasoning(
  signal: FinalSignal,
  snapshot: MarketSnapshot
): Promise<AIReasoningOutput> {
  const aiResult = await runAIReasoning(signal, snapshot);

  if (!aiResult.available) {
    return aiResult;
  }

  // Enforce hard limits (governance module, not config)
  const { effectiveAdjustment, clampedConfidence, wasLimited } =
    enforceAdjustmentLimits(
      aiResult.scoreAdjustment,
      aiResult.aiConfidence,
      config.aiMaxScoreAdjustment
    );

  if (wasLimited) {
    logger.warn(
      `AI governance limited adjustment: raw=${aiResult.scoreAdjustment} conf=${aiResult.aiConfidence} ` +
        `→ effective=${effectiveAdjustment} (hard max=±${AI_HARD_MAX_ADJUSTMENT})`
    );
  }

  if (effectiveAdjustment !== 0) {
    const oldScore = signal.finalScore;

    // Apply with floor (AI cannot push score below 40)
    const { adjustedScore, floorApplied } =
      applyAdjustmentWithFloor(oldScore, effectiveAdjustment);

    signal.finalScore = adjustedScore;
    signal.confidence = mapScoreToConfidence(signal.finalScore);

    if (floorApplied) {
      logger.warn(
        `AI governance floor applied: ${oldScore.toFixed(1)} + ${effectiveAdjustment} ` +
          `would be ${(oldScore + effectiveAdjustment).toFixed(1)}, floored to ${adjustedScore.toFixed(1)}`
      );
    }

    logger.info(
      `AI adjusted score: ${oldScore.toFixed(1)} → ${signal.finalScore.toFixed(1)} ` +
        `(raw=${aiResult.scoreAdjustment > 0 ? "+" : ""}${aiResult.scoreAdjustment} × ` +
        `conf=${clampedConfidence.toFixed(2)} = ${effectiveAdjustment > 0 ? "+" : ""}${effectiveAdjustment}) ` +
        `confidence: ${signal.confidence}`
    );
  }

  // Store the clamped values, not the raw API values
  aiResult.aiConfidence = clampedConfidence;
  signal.aiReasoning = aiResult;
  return aiResult;
}

// ─── Build Ingestion Payload ───────────────────────────────────────────────────

function buildPayload(
  signal: FinalSignal,
  snapshot: MarketSnapshot
): EngineSignalPayload {
  const payload: EngineSignalPayload = {
    action: signal.direction === Direction.LONG ? "BUY" : "SELL",
    symbol: toSignalSymbol(signal.symbol),
    timeframe: signal.timeframe,
    score: Math.round(signal.finalScore),
    confidence: signal.confidence,
    price: snapshot.price,
    stopLoss: signal.stopLoss,
    takeProfit1: signal.takeProfit1,
    takeProfit2: signal.takeProfit2,
    signalTs: signal.publishedAt.toISOString(),
    meta: {
      strategyType: signal.strategyType,
      regime: signal.regime,
      entryLow: signal.entryLow,
      entryHigh: signal.entryHigh,
      expectedR: signal.expectedR,
      technicalScore: signal.technicalScore,
      marketStructureScore: signal.marketStructureScore,
      newsScore: signal.newsScore,
      providerScore: signal.providerScore,
      riskPenalty: signal.riskPenalty,
      reasonCodes: signal.reasonCodes,
      riskFlags: signal.riskFlags,
      engineVersion: config.engineVersion,
      signalId: signal.signalId,
    },
    rawPayload: {
      snapshot: {
        symbol: snapshot.symbol,
        timeframe: snapshot.timeframe,
        price: snapshot.price,
        rsi: snapshot.rsi,
        macdHistogram: snapshot.macdHistogram,
        ema20: snapshot.ema20,
        ema50: snapshot.ema50,
        ema200: snapshot.ema200,
        atr: snapshot.atr,
        vwap: snapshot.vwap,
        fundingRate: snapshot.fundingRate,
        openInterest: snapshot.openInterest,
        oiChangePct: snapshot.oiChangePct,
        orderbookImbalance: snapshot.orderbookImbalance,
        regime: snapshot.regime,
      },
    },
  };

  if (signal.aiReasoning?.available) {
    payload.meta.aiReasoning = {
      narrative: signal.aiReasoning.narrative,
      scoreAdjustment: signal.aiReasoning.scoreAdjustment,
      aiConfidence: signal.aiReasoning.aiConfidence,
      keyFactors: signal.aiReasoning.keyFactors,
      macroContext: signal.aiReasoning.macroContext,
      caution: signal.aiReasoning.caution,
    };
  }

  return payload;
}

// ─── Publish to AgoraIQ ────────────────────────────────────────────────────────

const recentSignalIds = new Set<string>();
const MAX_RECENT_IDS = 500;

function trackPublished(id: string): void {
  recentSignalIds.add(id);
  if (recentSignalIds.size > MAX_RECENT_IDS) {
    const first = recentSignalIds.values().next().value;
    if (first) recentSignalIds.delete(first);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postWithRetry(
  url: string,
  payload: EngineSignalPayload,
  signalId: string
): Promise<boolean> {
  const maxAttempts = config.publishRetryAttempts + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await getProxiedAxios().post(url, payload, {
        headers: {
          Authorization: `Bearer ${config.providerToken}`,
          "Content-Type": "application/json",
          "X-Signal-Id": signalId,
        },
        timeout: 10_000,
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300) return true;

      if (response.status >= 400 && response.status < 500) {
        logger.error(
          `Publish failed (4xx): HTTP ${response.status} — ${JSON.stringify(response.data).slice(0, 200)}`
        );
        return false;
      }

      logger.warn(
        `Publish attempt ${attempt}/${maxAttempts} got HTTP ${response.status} — retrying`
      );
    } catch (err: any) {
      logger.warn(
        `Publish attempt ${attempt}/${maxAttempts} network error: ${err?.message ?? err} — retrying`
      );
    }

    if (attempt < maxAttempts) {
      await sleep(config.publishRetryDelayMs * attempt);
    }
  }

  logger.error(`Publish failed after ${maxAttempts} attempts for signal ${signalId}`);
  return false;
}

/**
 * Publish a final signal to AgoraIQ and persist to local SQLite.
 *
 * AI reasoning runs here (advisory only — never blocks).
 * Signal is persisted to signal_analysis regardless of HTTP outcome.
 */
export async function publishSignal(
  signal: FinalSignal,
  snapshot: MarketSnapshot
): Promise<boolean> {
  // Dedup check
  if (recentSignalIds.has(signal.signalId)) {
    logger.info(`Skipping duplicate: ${signal.signalId} (${signal.symbol} ${signal.strategyType})`);
    return false;
  }

  // ─── Capture pre-AI score for audit trail ──────────────────────────────────
  const baseFinalScore = signal.finalScore;

  // ─── AI Reasoning (advisory only) ──────────────────────────────────────────
  const aiResult = await applyAIReasoning(signal, snapshot);

  if (aiResult.available && signal.confidence === ConfidenceLevel.REJECT) {
    // AI dropped to REJECT. Log but STILL PUBLISH — AI is advisory.
    logger.warn(
      `AI dropped signal to REJECT (score=${signal.finalScore.toFixed(1)}) — ` +
        `publishing anyway (AI is advisory). Caution: ${aiResult.caution ?? "none"}`
    );
  }

  // ─── Build AI audit data ───────────────────────────────────────────────────
  const audit: AIAuditData = {
    aiEnabled: config.aiEnabled,
    aiModelVersion: config.aiEnabled ? config.aiModel : "",
    baseFinalScore,
    postAiFinalScore: signal.finalScore,
    aiConfidence: aiResult.available ? aiResult.aiConfidence : null,
    aiReasoningLatencyMs: aiResult.available ? aiResult.latencyMs : null,
  };

  // ─── Persist to SQLite ─────────────────────────────────────────────────────
  try {
    insertSignalAnalysis(signal, audit);
  } catch (err) {
    logger.warn("Failed to persist signal to SQLite", { err });
    // Non-fatal — proceed with publishing
  }

  const payload = buildPayload(signal, snapshot);
  const url = `${config.apiBaseUrl}/engine/ingest`;

  logger.info(
    `Publishing: ${signal.symbol} ${signal.direction} ${signal.strategyType} ` +
      `score=${baseFinalScore.toFixed(1)}→${signal.finalScore.toFixed(1)} R=${signal.expectedR}` +
      (aiResult.available ? ` [AI: ${aiResult.scoreAdjustment > 0 ? "+" : ""}${aiResult.scoreAdjustment}, conf=${aiResult.aiConfidence.toFixed(2)}, ${aiResult.latencyMs}ms]` : "")
  );

  const ok = await postWithRetry(url, payload, signal.signalId);

  if (ok) {
    trackPublished(signal.signalId);
    logger.info(`✓ Published: ${signal.signalId}`);
    logger.debug(`Alert:\n${formatAlertMessage(signal)}`);
  }

  return ok;
}
