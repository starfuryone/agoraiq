#!/usr/bin/env npx tsx
/**
 * @agoraiq/signal-engine — Full Validation Suite
 *
 * Runs the complete evidence-gathering pipeline before promoting
 * any scoring factor or strategy into production defaults.
 *
 * WHAT THIS RUNS (in order):
 *
 * 1. BASELINE BACKTESTS (3 configurations)
 *    - Technical only
 *    - Technical + market structure
 *    - All factors on
 *    Compare: does adding each layer actually help?
 *
 * 2. FACTOR ABLATION (4 studies)
 *    - All minus alpha intelligence
 *    - All minus news
 *    - All minus provider history
 *    - All minus risk penalty
 *    Compare: does removing each factor hurt or help?
 *
 * 3. BREAKOUT STRATEGY COMPARISON
 *    - All factors, 2 strategies (trend + mean reversion)
 *    - All factors, 3 strategies (+ breakout)
 *    Compare: does breakout improve win rate, avg R, PF, drawdown?
 *
 * 4. AI AUDIT (from persisted data)
 *    - Query signal_analysis for AI-adjusted vs non-adjusted outcomes
 *    - Report: avg R, win rate, score delta by AI action
 *    (Only meaningful if AI has been running and signals have resolved.
 *     If no data, this section reports "insufficient data".)
 *
 * OUTPUT:
 *    Console report + all results persisted to SQLite.
 *    Run time: ~10-20 minutes depending on exchange API speed.
 *
 * USAGE:
 *    npx tsx scripts/run-validation.ts
 *    npx tsx scripts/run-validation.ts --symbol=ETH --days=60
 *    npx tsx scripts/run-validation.ts --all   # BTC,ETH,SOL,XRP × 1h,4h
 */

import dotenv from "dotenv";
dotenv.config();

import { runBacktest, type BacktestSummary, type BacktestConfig } from "../src/backtest";
import { setActiveFactors, resetFactors, type ScoringFactors } from "../src/ablation";
import { getDb, closeDb } from "../src/persistence/db";

// ─── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let symbols = ["BTC"];
  let timeframes = ["1h"];
  let days = 30;

  for (const arg of args) {
    if (arg === "--all") {
      symbols = ["BTC", "ETH", "SOL", "XRP"];
      timeframes = ["1h", "4h"];
    } else if (arg.startsWith("--symbol=")) {
      symbols = arg.split("=")[1].split(",");
    } else if (arg.startsWith("--tf=")) {
      timeframes = arg.split("=")[1].split(",");
    } else if (arg.startsWith("--days=")) {
      days = parseInt(arg.split("=")[1], 10);
    }
  }

  return { symbols, timeframes, days };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const SEP = "═".repeat(72);
const THIN = "─".repeat(72);

function fmt(n: number, decimals = 3): string {
  return n.toFixed(decimals);
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function fmtPF(n: number): string {
  return n === Infinity ? "∞" : n.toFixed(2);
}

interface CompactResult {
  label: string;
  signals: number;
  wins: number;
  losses: number;
  netWR: string;
  netAvgR: string;
  pf: string;
  eqDD: string;
  ambiguous: number;
}

function toCompact(label: string, s: BacktestSummary): CompactResult {
  return {
    label,
    signals: s.signalsPublished,
    wins: s.wins,
    losses: s.losses,
    netWR: fmtPct(s.netWinRate),
    netAvgR: fmt(s.netAvgR),
    pf: fmtPF(s.netProfitFactor),
    eqDD: fmt(s.maxEquityDrawdownR) + "R",
    ambiguous: s.ambiguousCount,
  };
}

function printTable(title: string, rows: CompactResult[]): void {
  console.log(`\n${SEP}`);
  console.log(`  ${title}`);
  console.log(SEP);
  console.log(
    "  " +
      "Config".padEnd(30) +
      "Sig".padEnd(6) +
      "W/L".padEnd(8) +
      "WR".padEnd(8) +
      "AvgR".padEnd(10) +
      "PF".padEnd(8) +
      "EqDD".padEnd(8) +
      "Amb"
  );
  console.log("  " + THIN.slice(2));

  for (const r of rows) {
    console.log(
      "  " +
        r.label.padEnd(30) +
        String(r.signals).padEnd(6) +
        `${r.wins}/${r.losses}`.padEnd(8) +
        r.netWR.padEnd(8) +
        r.netAvgR.padEnd(10) +
        r.pf.padEnd(8) +
        r.eqDD.padEnd(8) +
        String(r.ambiguous)
    );
  }
}

// ─── Phase 1: Baseline Backtests ───────────────────────────────────────────────

async function runBaselines(
  symbol: string,
  timeframe: string,
  days: number,
  cfg: Partial<BacktestConfig>
): Promise<CompactResult[]> {
  const results: CompactResult[] = [];

  // 1a. Technical only
  setActiveFactors({
    marketStructure: false,
    news: false,
    providerHistory: false,
    riskPenalty: false,
    alphaIntelligence: false,
  });
  const techOnly = await runBacktest(symbol, timeframe, days, cfg);
  results.push(toCompact("TECHNICAL_ONLY", techOnly));

  // 1b. Technical + market structure
  setActiveFactors({
    marketStructure: true,
    news: false,
    providerHistory: false,
    riskPenalty: true, // risk penalty is part of market awareness
    alphaIntelligence: false,
  });
  const techMkt = await runBacktest(symbol, timeframe, days, cfg);
  results.push(toCompact("TECH + MKT_STRUCTURE", techMkt));

  // 1c. All factors on
  resetFactors();
  const allOn = await runBacktest(symbol, timeframe, days, cfg);
  results.push(toCompact("ALL_FACTORS_ON", allOn));

  return results;
}

// ─── Phase 2: Factor Ablation ──────────────────────────────────────────────────

async function runAblation(
  symbol: string,
  timeframe: string,
  days: number,
  cfg: Partial<BacktestConfig>
): Promise<CompactResult[]> {
  const results: CompactResult[] = [];

  // Baseline (all on)
  resetFactors();
  const baseline = await runBacktest(symbol, timeframe, days, cfg);
  results.push(toCompact("BASELINE (all on)", baseline));

  const factors: Array<{ name: string; key: keyof ScoringFactors }> = [
    { name: "ALL minus alpha", key: "alphaIntelligence" },
    { name: "ALL minus news", key: "news" },
    { name: "ALL minus provider", key: "providerHistory" },
    { name: "ALL minus risk_penalty", key: "riskPenalty" },
  ];

  for (const f of factors) {
    const toggled: ScoringFactors = {
      marketStructure: true,
      news: true,
      providerHistory: true,
      riskPenalty: true,
      alphaIntelligence: true,
      [f.key]: false,
    };
    setActiveFactors(toggled);
    const result = await runBacktest(symbol, timeframe, days, cfg);
    results.push(toCompact(f.name, result));
  }

  resetFactors();
  return results;
}

// ─── Phase 3: Breakout Strategy Comparison ─────────────────────────────────────
//
// This is trickier — we can't toggle strategies through the ablation framework
// because strategies are registered in strategies/index.ts. But we CAN compare
// by looking at the byStrategy breakdown in the backtest results.
//
// The approach: run one backtest with all 3 strategies, then look at
// byStrategy to see breakout's isolated contribution.

async function runBreakoutComparison(
  symbol: string,
  timeframe: string,
  days: number,
  cfg: Partial<BacktestConfig>
): Promise<void> {
  resetFactors();
  const result = await runBacktest(symbol, timeframe, days, cfg);

  console.log(`\n${SEP}`);
  console.log(`  BREAKOUT STRATEGY IMPACT: ${symbol} ${timeframe} ${days}d`);
  console.log(SEP);

  const strategies = result.byStrategy;
  const stratNames = Object.keys(strategies);

  if (stratNames.length === 0) {
    console.log("  No signals generated — insufficient data or all filtered.\n");
    return;
  }

  console.log(
    "  " +
      "Strategy".padEnd(28) +
      "Sig".padEnd(6) +
      "W/L".padEnd(8) +
      "WR".padEnd(8) +
      "AvgR"
  );
  console.log("  " + THIN.slice(2));

  for (const [name, stats] of Object.entries(strategies)) {
    console.log(
      "  " +
        name.padEnd(28) +
        String(stats.count).padEnd(6) +
        `${stats.wins}/${stats.losses}`.padEnd(8) +
        fmtPct(stats.winRate).padEnd(8) +
        fmt(stats.avgR)
    );
  }

  const breakout = strategies["BREAKOUT_CONFIRMATION"];
  const nonBreakout = Object.entries(strategies)
    .filter(([k]) => k !== "BREAKOUT_CONFIRMATION")
    .reduce(
      (acc, [, s]) => ({
        count: acc.count + s.count,
        wins: acc.wins + s.wins,
        losses: acc.losses + s.losses,
        totalR: acc.totalR + s.avgR * s.count,
      }),
      { count: 0, wins: 0, losses: 0, totalR: 0 }
    );

  console.log("\n  Summary:");

  if (breakout && breakout.count > 0) {
    const nbAvgR = nonBreakout.count > 0 ? nonBreakout.totalR / nonBreakout.count : 0;
    const nbWR = nonBreakout.count > 0 ? nonBreakout.wins / nonBreakout.count : 0;

    console.log(`    Without breakout: ${nonBreakout.count} signals, WR=${fmtPct(nbWR)}, avgR=${fmt(nbAvgR)}`);
    console.log(`    Breakout only:    ${breakout.count} signals, WR=${fmtPct(breakout.winRate)}, avgR=${fmt(breakout.avgR)}`);
    console.log(`    Combined:         ${result.signalsPublished} signals, WR=${fmtPct(result.netWinRate)}, avgR=${fmt(result.netAvgR)}`);

    const rDelta = breakout.avgR - nbAvgR;
    console.log(
      `\n    Breakout ΔavgR vs others: ${rDelta > 0 ? "+" : ""}${fmt(rDelta)} ` +
        `(${rDelta > 0.05 ? "HELPS" : rDelta < -0.05 ? "HURTS" : "NEUTRAL"})`
    );
  } else {
    console.log("    Breakout strategy did not fire during this period.");
    console.log("    This may mean no qualifying levels were detected, or");
    console.log("    all breakout signals were filtered by volume/RSI/MACD gates.");
  }

  // Regime breakdown — shows where breakout vs others contribute
  console.log("\n  By Regime:");
  console.log(
    "  " +
      "Regime".padEnd(22) +
      "Sig".padEnd(6) +
      "W/L".padEnd(8) +
      "WR".padEnd(8) +
      "AvgR"
  );
  console.log("  " + THIN.slice(2));

  for (const [name, stats] of Object.entries(result.byRegime)) {
    console.log(
      "  " +
        name.padEnd(22) +
        String(stats.count).padEnd(6) +
        `${stats.wins}/${stats.losses}`.padEnd(8) +
        fmtPct(stats.winRate).padEnd(8) +
        fmt(stats.avgR)
    );
  }
}

// ─── Phase 4: AI Audit ─────────────────────────────────────────────────────────

function runAIAudit(): void {
  console.log(`\n${SEP}`);
  console.log("  AI REASONING AUDIT (from persisted signal_analysis)");
  console.log(SEP);

  const db = getDb();

  // Check if we have any resolved signals with AI data
  const total = db
    .prepare("SELECT count(*) as n FROM signal_analysis WHERE outcome_label IS NOT NULL")
    .get() as { n: number } | undefined;

  if (!total || total.n < 5) {
    console.log(`\n  Insufficient data: only ${total?.n ?? 0} resolved signals in DB.`);
    console.log("  AI audit requires signals to have been published, tracked,");
    console.log("  and resolved. Run the engine live for a few days first.\n");
    return;
  }

  console.log(`\n  Total resolved signals: ${total.n}`);

  // AI enabled vs disabled
  const byEnabled = db
    .prepare(`
      SELECT
        ai_enabled,
        count(*) as n,
        avg(realized_r) as avg_r,
        avg(CASE WHEN outcome_label IN ('WIN', 'PARTIAL') THEN 1.0 ELSE 0.0 END) as win_rate,
        avg(base_final_score) as avg_base,
        avg(post_ai_final_score) as avg_post
      FROM signal_analysis
      WHERE outcome_label IS NOT NULL
      GROUP BY ai_enabled
    `)
    .all() as Array<{
    ai_enabled: number;
    n: number;
    avg_r: number;
    win_rate: number;
    avg_base: number;
    avg_post: number;
  }>;

  if (byEnabled.length > 0) {
    console.log("\n  AI Enabled vs Disabled:");
    console.log("  " + THIN.slice(2));
    for (const row of byEnabled) {
      const label = row.ai_enabled ? "AI ON" : "AI OFF";
      console.log(
        `    ${label.padEnd(10)} n=${String(row.n).padEnd(5)} ` +
          `avgR=${fmt(row.avg_r ?? 0)} WR=${fmtPct(row.win_rate ?? 0)} ` +
          `baseScore=${fmt(row.avg_base ?? 0, 1)} postAI=${fmt(row.avg_post ?? 0, 1)}`
      );
    }
  }

  // AI action breakdown (boosted / reduced / unchanged)
  const byAction = db
    .prepare(`
      SELECT
        CASE
          WHEN (post_ai_final_score - base_final_score) > 0.5 THEN 'BOOSTED'
          WHEN (post_ai_final_score - base_final_score) < -0.5 THEN 'REDUCED'
          ELSE 'UNCHANGED'
        END as ai_action,
        count(*) as n,
        avg(realized_r) as avg_r,
        avg(CASE WHEN outcome_label IN ('WIN', 'PARTIAL') THEN 1.0 ELSE 0.0 END) as win_rate,
        avg(post_ai_final_score - base_final_score) as avg_delta
      FROM signal_analysis
      WHERE outcome_label IS NOT NULL AND ai_enabled = 1
      GROUP BY ai_action
    `)
    .all() as Array<{
    ai_action: string;
    n: number;
    avg_r: number;
    win_rate: number;
    avg_delta: number;
  }>;

  if (byAction.length > 0) {
    console.log("\n  AI Action Breakdown (AI-enabled signals only):");
    console.log("  " + THIN.slice(2));
    for (const row of byAction) {
      console.log(
        `    ${row.ai_action.padEnd(12)} n=${String(row.n).padEnd(5)} ` +
          `avgR=${fmt(row.avg_r ?? 0)} WR=${fmtPct(row.win_rate ?? 0)} ` +
          `avgΔscore=${(row.avg_delta ?? 0) > 0 ? "+" : ""}${fmt(row.avg_delta ?? 0, 1)}`
      );
    }
  }

  // Model version comparison
  const byModel = db
    .prepare(`
      SELECT
        ai_model_version,
        count(*) as n,
        avg(realized_r) as avg_r,
        avg(ai_reasoning_latency_ms) as avg_latency
      FROM signal_analysis
      WHERE outcome_label IS NOT NULL AND ai_enabled = 1 AND ai_model_version != ''
      GROUP BY ai_model_version
    `)
    .all() as Array<{
    ai_model_version: string;
    n: number;
    avg_r: number;
    avg_latency: number;
  }>;

  if (byModel.length > 0) {
    console.log("\n  By AI Model Version:");
    console.log("  " + THIN.slice(2));
    for (const row of byModel) {
      console.log(
        `    ${(row.ai_model_version || "unknown").padEnd(30)} n=${String(row.n).padEnd(5)} ` +
          `avgR=${fmt(row.avg_r ?? 0)} latency=${Math.round(row.avg_latency ?? 0)}ms`
      );
    }
  }

  console.log("");
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { symbols, timeframes, days } = parseArgs();
  const cfg: Partial<BacktestConfig> = { slippageBps: 5, roundTripFeeBps: 14 };

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║         AgoraIQ Signal Engine — Full Validation Suite          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`\n  Symbols:    ${symbols.join(", ")}`);
  console.log(`  Timeframes: ${timeframes.join(", ")}`);
  console.log(`  Days:       ${days}`);
  console.log(`  Slippage:   ${cfg.slippageBps}bps | Fees: ${cfg.roundTripFeeBps}bps`);
  console.log(`  Phases:     baseline → ablation → breakout → AI audit`);

  getDb();

  for (const symbol of symbols) {
    for (const tf of timeframes) {
      console.log(`\n\n${"▓".repeat(72)}`);
      console.log(`  ${symbol} ${tf} — ${days} days`);
      console.log(`${"▓".repeat(72)}`);

      // Phase 1: Baselines
      console.log("\n  Phase 1: Baseline Backtests");
      const baselines = await runBaselines(symbol, tf, days, cfg);
      printTable(`BASELINES: ${symbol} ${tf}`, baselines);

      // Phase 2: Ablation
      console.log("\n  Phase 2: Factor Ablation");
      const ablation = await runAblation(symbol, tf, days, cfg);
      printTable(`ABLATION: ${symbol} ${tf}`, ablation);

      // Compute and print verdicts
      const baselineAllOn = ablation[0]; // first row is baseline
      console.log("\n  Factor Verdicts:");
      for (let i = 1; i < ablation.length; i++) {
        const row = ablation[i];
        const baseR = parseFloat(baselineAllOn.netAvgR);
        const thisR = parseFloat(row.netAvgR);
        const delta = baseR - thisR;
        const verdict = delta > 0.05 ? "HELPS" : delta < -0.05 ? "HURTS" : "NEUTRAL";
        const icon = verdict === "HELPS" ? "✓" : verdict === "HURTS" ? "✗" : "─";
        console.log(
          `    ${icon} ${row.label.padEnd(26)} ΔavgR=${delta > 0 ? "+" : ""}${fmt(delta)}  ${verdict}`
        );
      }

      // Phase 3: Breakout comparison
      console.log("\n  Phase 3: Breakout Strategy Impact");
      await runBreakoutComparison(symbol, tf, days, cfg);
    }
  }

  // Phase 4: AI audit (global, not per-symbol)
  console.log("\n  Phase 4: AI Audit");
  runAIAudit();

  // Final reset
  resetFactors();
  closeDb();

  console.log(`\n${"═".repeat(72)}`);
  console.log("  Validation complete. All results persisted to SQLite.");
  console.log("  Review data/signal-engine.db for detailed analysis.");
  console.log(`${"═".repeat(72)}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  resetFactors();
  closeDb();
  process.exit(1);
});
