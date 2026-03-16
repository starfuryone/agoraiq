/**
 * @agoraiq/signal-engine — Factor Ablation Framework
 *
 * Answers the question: "Does this scoring factor actually improve
 * signal quality, or is it decorative complexity?"
 *
 * USAGE
 * ─────
 *   import { runAblationStudy } from "./ablation";
 *   const report = await runAblationStudy("BTC", "1h", 30);
 *
 * WHAT IT DOES
 * ────────────
 * Runs the backtest multiple times with different scoring factor
 * combinations enabled/disabled. Each run produces net win rate,
 * net avg R, and profit factor. The report compares every combination
 * against the baseline (all factors on) and the stripped baseline
 * (technical score only).
 *
 * FACTOR MAP
 * ──────────
 *   technical_score       — always on (core, cannot be ablated)
 *   market_structure      — orderbook imbalance, OI, funding, volume
 *   news                  — CryptoPanic event score + credibility
 *   provider_history      — expectancy from learning loop
 *   risk_penalty          — ATR, liquidity, crowding, event shock
 *   alpha_intelligence    — orderbook depth, whales, liquidation clusters, cross-exchange
 *
 * Each optional factor is tested independently: "all minus this one"
 * shows the marginal contribution of each factor. If removing a factor
 * improves results, the factor is hurting — it should be disabled or
 * its implementation should be fixed.
 *
 * PERSISTENCE
 * ───────────
 * Results are stored in a dedicated SQLite table so you can query
 * historical ablation studies and track whether a factor's contribution
 * changes over time or across market conditions.
 */

import { createHash } from "crypto";
import { runBacktest, type BacktestSummary, type BacktestConfig } from "./backtest";
import { getDb } from "./persistence/db";
import { logger } from "./services/logger";

// ─── Factor Configuration ──────────────────────────────────────────────────────

export interface ScoringFactors {
  /** Market structure: OI, funding, orderbook imbalance, volume */
  marketStructure: boolean;
  /** News: CryptoPanic event score + source credibility */
  news: boolean;
  /** Provider history: expectancy from learning loop */
  providerHistory: boolean;
  /** Risk penalty: ATR, liquidity, crowding, event shock */
  riskPenalty: boolean;
  /** Alpha: orderbook depth, whales, liquidation clusters, cross-exchange */
  alphaIntelligence: boolean;
}

const ALL_ON: ScoringFactors = {
  marketStructure: true,
  news: true,
  providerHistory: true,
  riskPenalty: true,
  alphaIntelligence: true,
};

const TECHNICAL_ONLY: ScoringFactors = {
  marketStructure: false,
  news: false,
  providerHistory: false,
  riskPenalty: false,
  alphaIntelligence: false,
};

// Exported for use by the scoring engine
let _activeFactors: ScoringFactors = { ...ALL_ON };

export function getActiveFactors(): ScoringFactors {
  return _activeFactors;
}

export function setActiveFactors(factors: ScoringFactors): void {
  _activeFactors = { ...factors };
}

export function resetFactors(): void {
  _activeFactors = { ...ALL_ON };
}

// ─── Ablation Study ────────────────────────────────────────────────────────────

export interface AblationResult {
  label: string;
  factors: ScoringFactors;
  summary: BacktestSummary;
}

export interface AblationReport {
  studyId: string;
  symbol: string;
  timeframe: string;
  days: number;
  results: AblationResult[];
  /** Factor-by-factor marginal contribution (positive = factor helps) */
  contributions: Record<string, {
    deltaNetWinRate: number;
    deltaNetAvgR: number;
    deltaProfitFactor: number;
    verdict: "HELPS" | "HURTS" | "NEUTRAL";
  }>;
}

/**
 * Run a full ablation study for a symbol/timeframe.
 *
 * Runs these combinations:
 * 1. ALL_ON (baseline)
 * 2. TECHNICAL_ONLY (stripped baseline)
 * 3. ALL minus marketStructure
 * 4. ALL minus news
 * 5. ALL minus providerHistory
 * 6. ALL minus riskPenalty
 * 7. ALL minus alphaIntelligence
 *
 * Each run uses the same candle data (same runId seed) for apples-to-apples.
 */
export async function runAblationStudy(
  symbol: string,
  timeframe: string,
  days = 30,
  backtestConfig: Partial<BacktestConfig> = {}
): Promise<AblationReport> {
  const studyId = createHash("sha256")
    .update(`ablation-${symbol}-${timeframe}-${days}-${Date.now()}`)
    .digest("hex")
    .slice(0, 16);

  logger.info(`Ablation study [${studyId}]: ${symbol} ${timeframe} ${days}d`);

  const factorNames: (keyof ScoringFactors)[] = [
    "marketStructure", "news", "providerHistory", "riskPenalty", "alphaIntelligence",
  ];

  // Build test configurations
  const configs: Array<{ label: string; factors: ScoringFactors }> = [
    { label: "ALL_ON", factors: { ...ALL_ON } },
    { label: "TECHNICAL_ONLY", factors: { ...TECHNICAL_ONLY } },
  ];

  for (const factor of factorNames) {
    const minus = { ...ALL_ON, [factor]: false };
    configs.push({ label: `ALL_MINUS_${factor}`, factors: minus });
  }

  // Run backtests
  const results: AblationResult[] = [];

  for (const { label, factors } of configs) {
    logger.info(`  Running: ${label}`);
    setActiveFactors(factors);

    try {
      const summary = await runBacktest(symbol, timeframe, days, backtestConfig);
      results.push({ label, factors, summary });
    } catch (err: any) {
      logger.error(`  Failed: ${label} — ${err.message ?? err}`);
    }
  }

  // Reset to normal
  resetFactors();

  // Compute contributions
  const baseline = results.find((r) => r.label === "ALL_ON");
  const contributions: AblationReport["contributions"] = {};

  if (baseline) {
    for (const factor of factorNames) {
      const without = results.find((r) => r.label === `ALL_MINUS_${factor}`);
      if (!without) continue;

      // Positive delta = factor helps (removing it makes things worse)
      const deltaWR = baseline.summary.netWinRate - without.summary.netWinRate;
      const deltaR = baseline.summary.netAvgR - without.summary.netAvgR;
      const deltaPF =
        (baseline.summary.netProfitFactor === Infinity ? 999 : baseline.summary.netProfitFactor) -
        (without.summary.netProfitFactor === Infinity ? 999 : without.summary.netProfitFactor);

      // Verdict: if removing the factor improves results, it's hurting
      let verdict: "HELPS" | "HURTS" | "NEUTRAL" = "NEUTRAL";
      if (deltaR > 0.05) verdict = "HELPS";
      if (deltaR < -0.05) verdict = "HURTS";

      contributions[factor] = {
        deltaNetWinRate: deltaWR,
        deltaNetAvgR: deltaR,
        deltaProfitFactor: deltaPF,
        verdict,
      };
    }
  }

  // Persist
  try {
    ensureAblationTable();
    const db = getDb();
    for (const r of results) {
      db.prepare(`
        INSERT INTO ablation_results (
          study_id, symbol, timeframe, days, label,
          factors_json, net_win_rate, net_avg_r, net_profit_factor,
          signals_published, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        studyId, symbol, timeframe, days, r.label,
        JSON.stringify(r.factors),
        r.summary.netWinRate, r.summary.netAvgR,
        r.summary.netProfitFactor === Infinity ? 999 : r.summary.netProfitFactor,
        r.summary.signalsPublished
      );
    }
  } catch (err) {
    logger.warn("Failed to persist ablation results", { err });
  }

  const report: AblationReport = { studyId, symbol, timeframe, days, results, contributions };

  // Log summary
  logger.info(`\nAblation study [${studyId}] complete:`);
  if (baseline) {
    logger.info(`  Baseline (ALL_ON): WR=${(baseline.summary.netWinRate * 100).toFixed(1)}% avgR=${baseline.summary.netAvgR.toFixed(3)} n=${baseline.summary.signalsPublished}`);
  }
  for (const [factor, c] of Object.entries(contributions)) {
    logger.info(
      `  ${factor.padEnd(20)} ${c.verdict.padEnd(8)} ΔWR=${(c.deltaNetWinRate * 100).toFixed(1)}% ΔR=${c.deltaNetAvgR.toFixed(3)} ΔPF=${c.deltaProfitFactor.toFixed(2)}`
    );
  }

  return report;
}

// ─── Persistence ───────────────────────────────────────────────────────────────

let tableReady = false;

function ensureAblationTable(): void {
  if (tableReady) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ablation_results (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      study_id            TEXT NOT NULL,
      symbol              TEXT NOT NULL,
      timeframe           TEXT NOT NULL,
      days                INTEGER NOT NULL,
      label               TEXT NOT NULL,
      factors_json        TEXT NOT NULL,
      net_win_rate        REAL NOT NULL,
      net_avg_r           REAL NOT NULL,
      net_profit_factor   REAL NOT NULL,
      signals_published   INTEGER NOT NULL,
      created_at          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_abl_study ON ablation_results(study_id);
  `);
  tableReady = true;
}
