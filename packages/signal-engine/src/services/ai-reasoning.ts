/**
 * @agoraiq/signal-engine — AI Reasoning Agent
 *
 * Sends signal context + market snapshot + alpha intelligence to Claude
 * and gets back:
 * - A narrative explanation of why this signal matters (or doesn't)
 * - A concrete score adjustment (-15 to +15)
 * - Key factors the rule engine may have missed
 * - Macro context considerations
 * - An optional caution flag that can block or weaken the signal
 *
 * The AI layer is additive. It adjusts the rule-based score, it doesn't
 * replace it. If the AI is unavailable (API down, timeout, bad response),
 * the signal publishes with rule-based scores only.
 *
 * Cost control: Only called for signals that pass the publish gate.
 * That's ~2-8 signals/day, not every scan candidate.
 */

import axios from "axios";
import { config } from "../config";
import type {
  FinalSignal,
  MarketSnapshot,
  AIReasoningOutput,
} from "../types";
import { logger } from "./logger";

// ─── Prompt Construction ───────────────────────────────────────────────────────

function buildPrompt(signal: FinalSignal, snapshot: MarketSnapshot): string {
  const depth = snapshot.orderbookDepth;
  const whale = snapshot.whaleActivity;
  const liq = snapshot.liquidationClusters;
  const cross = snapshot.crossExchange;

  return `You are a senior crypto quantitative analyst reviewing a trading signal before it publishes to users.

SIGNAL:
  Symbol: ${signal.symbol}
  Direction: ${signal.direction}
  Strategy: ${signal.strategyType}
  Timeframe: ${signal.timeframe}
  Entry Zone: ${signal.entryLow.toFixed(2)} – ${signal.entryHigh.toFixed(2)}
  Stop Loss: ${signal.stopLoss.toFixed(2)}
  TP1: ${signal.takeProfit1.toFixed(2)}
  TP2: ${signal.takeProfit2.toFixed(2)}
  Expected R: ${signal.expectedR.toFixed(2)}

RULE-BASED SCORES:
  Technical: ${signal.technicalScore}/100
  Market Structure: ${signal.marketStructureScore}/100
  News: ${signal.newsScore}/100
  Provider History: ${signal.providerScore}/100
  Risk Penalty: -${signal.riskPenalty}
  Final Score: ${signal.finalScore.toFixed(1)}
  Confidence: ${signal.confidence}

REGIME: ${signal.regime}
REASON CODES: ${signal.reasonCodes.join(", ")}
RISK FLAGS: ${signal.riskFlags.length > 0 ? signal.riskFlags.join(", ") : "none"}

MARKET CONTEXT:
  Price: $${snapshot.price.toFixed(2)}
  RSI: ${snapshot.rsi.toFixed(1)}
  MACD Histogram: ${snapshot.macdHistogram.toFixed(4)}
  EMA20: ${snapshot.ema20.toFixed(2)} | EMA50: ${snapshot.ema50.toFixed(2)} | EMA200: ${snapshot.ema200.toFixed(2)}
  ATR: ${snapshot.atr.toFixed(2)} (${((snapshot.atr / snapshot.price) * 100).toFixed(2)}% of price)
  VWAP: ${snapshot.vwap.toFixed(2)}
  Funding Rate: ${(snapshot.fundingRate * 100).toFixed(4)}%
  OI Change 1h: ${(snapshot.oiChangePct * 100).toFixed(2)}%

ORDER BOOK:
  Bid Wall: $${(depth.bidWallSize / 1000).toFixed(0)}K at ${depth.bidWallPrice.toFixed(0)}
  Ask Wall: $${(depth.askWallSize / 1000).toFixed(0)}K at ${depth.askWallPrice.toFixed(0)}
  Depth Ratio (bid/ask within 1%): ${depth.depthRatio.toFixed(2)}
  Spread: ${depth.spreadBps.toFixed(1)} bps

WHALE ACTIVITY (last 1h):
  Large Trades: ${whale.largeTradeCount}
  Net Volume: $${(whale.largeTradeNetVolume / 1000).toFixed(0)}K
  Direction: ${whale.whaleDirection}
  Large Trade Ratio: ${(whale.largeTradeRatio * 100).toFixed(1)}%

LIQUIDATION CLUSTERS:
  Long Cluster: $${(liq.longClusterValue / 1000).toFixed(0)}K at ${liq.longClusterPrice.toFixed(0)}
  Short Cluster: $${(liq.shortClusterValue / 1000).toFixed(0)}K at ${liq.shortClusterPrice.toFixed(0)}
  Net Pressure: ${liq.netLiquidationPressure > 0 ? "+" : ""}$${(liq.netLiquidationPressure / 1000).toFixed(0)}K
  Cascade Active: ${liq.cascadeDetected}

CROSS-EXCHANGE:
  Exchanges Reporting: ${Object.keys(cross.prices).join(", ") || "none"}
  Max Spread: ${cross.maxSpreadBps.toFixed(1)} bps
  Divergence: ${cross.divergenceDetected}
  Leading Exchange: ${cross.leadingExchange}
  Price Consensus: ${cross.priceConsensus}

Respond ONLY with a JSON object (no markdown, no backticks, no preamble):
{
  "scoreAdjustment": <integer from -${config.aiMaxScoreAdjustment} to +${config.aiMaxScoreAdjustment}>,
  "aiConfidence": <float 0.0 to 1.0 representing how confident you are in your adjustment>,
  "narrative": "<2-3 sentence explanation of the signal for traders. Be specific about what you see. Reference actual numbers.>",
  "keyFactors": ["<factor 1>", "<factor 2>"],
  "macroContext": "<1 sentence about broader market conditions that affect this trade>",
  "caution": "<if there is a serious concern, state it in one sentence. Otherwise null>"
}

Rules:
- scoreAdjustment of 0 means the rule engine got it right. Only adjust if you see something the rules missed.
- Positive adjustment = the signal is stronger than the rules suggest.
- Negative adjustment = the signal is weaker or riskier than the rules suggest.
- If whale activity contradicts the signal direction, that's worth a negative adjustment.
- If liquidation clusters align with TP targets, that's worth a positive adjustment.
- If cross-exchange divergence is high, be cautious.
- Be concrete. "Bullish momentum" is worthless. "$2.1M bid wall at 86,500 with 3:1 depth ratio" is useful.`;
}

// ─── API Call ──────────────────────────────────────────────────────────────────

const FALLBACK: AIReasoningOutput = {
  available: false,
  narrative: "",
  scoreAdjustment: 0,
  aiConfidence: 0,
  keyFactors: [],
  macroContext: "",
  caution: null,
  latencyMs: 0,
};

/**
 * Run AI reasoning on a signal. Returns the AI output or a neutral fallback.
 * Never throws — all failures are caught and logged.
 */
export async function runAIReasoning(
  signal: FinalSignal,
  snapshot: MarketSnapshot
): Promise<AIReasoningOutput> {
  if (!config.aiEnabled) {
    return FALLBACK;
  }

  if (!config.aiApiKey) {
    logger.warn("AI reasoning enabled but ANTHROPIC_API_KEY is empty — skipping");
    return FALLBACK;
  }

  const startMs = Date.now();

  try {
    const prompt = buildPrompt(signal, snapshot);

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: config.aiModel,
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          "x-api-key": config.aiApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        timeout: config.aiTimeoutMs,
      }
    );

    const latencyMs = Date.now() - startMs;

    // Extract text from response
    const textBlock = response.data?.content?.find(
      (b: any) => b.type === "text"
    );
    if (!textBlock?.text) {
      logger.warn("AI response had no text content");
      return { ...FALLBACK, latencyMs };
    }

    // Parse JSON — strip any accidental markdown fences
    const raw = textBlock.text
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn(`AI returned unparseable JSON: ${raw.slice(0, 200)}`);
      return { ...FALLBACK, latencyMs };
    }

    // Validate and clamp
    const maxAdj = config.aiMaxScoreAdjustment;
    const scoreAdjustment = clampInt(parsed.scoreAdjustment ?? 0, -maxAdj, maxAdj);
    const aiConfidence = clampFloat(parsed.aiConfidence ?? 0.5, 0, 1);

    const result: AIReasoningOutput = {
      available: true,
      narrative: String(parsed.narrative ?? "").slice(0, 500),
      scoreAdjustment,
      aiConfidence,
      keyFactors: Array.isArray(parsed.keyFactors)
        ? parsed.keyFactors.map(String).slice(0, 5)
        : [],
      macroContext: String(parsed.macroContext ?? "").slice(0, 300),
      caution: parsed.caution ? String(parsed.caution).slice(0, 300) : null,
      latencyMs,
    };

    logger.info(
      `AI reasoning: adj=${scoreAdjustment > 0 ? "+" : ""}${scoreAdjustment} ` +
        `conf=${aiConfidence.toFixed(2)} latency=${latencyMs}ms ` +
        `${result.caution ? "CAUTION: " + result.caution : ""}`
    );

    return result;
  } catch (err: any) {
    const latencyMs = Date.now() - startMs;
    const msg = err?.response?.status
      ? `HTTP ${err.response.status}`
      : err?.code === "ECONNABORTED"
        ? `timeout after ${config.aiTimeoutMs}ms`
        : err?.message ?? "unknown error";

    logger.warn(`AI reasoning failed (${msg}) — proceeding with rule-based score`);
    return { ...FALLBACK, latencyMs };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function clampInt(val: any, min: number, max: number): number {
  const n = parseInt(val, 10);
  if (isNaN(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(val: any, min: number, max: number): number {
  const n = parseFloat(val);
  if (isNaN(n)) return 0.5;
  return Math.max(min, Math.min(max, n));
}
