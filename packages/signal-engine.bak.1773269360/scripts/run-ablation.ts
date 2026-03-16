#!/usr/bin/env npx tsx
/**
 * @agoraiq/signal-engine — Ablation Study CLI
 *
 * Runs backtests with each scoring factor toggled off to measure
 * whether it actually helps signal quality.
 *
 * Usage:
 *   npx tsx scripts/run-ablation.ts                      # BTC 1h 30d
 *   npx tsx scripts/run-ablation.ts --symbol=ETH --tf=4h --days=60
 */

import dotenv from "dotenv";
dotenv.config();

import { runAblationStudy, resetFactors, type AblationReport } from "../src/ablation";
import { getDb, closeDb } from "../src/persistence/db";

function parseArgs() {
  const args = process.argv.slice(2);
  let symbol = "BTC";
  let timeframe = "1h";
  let days = 30;

  for (const arg of args) {
    if (arg.startsWith("--symbol=")) symbol = arg.split("=")[1];
    else if (arg.startsWith("--tf=")) timeframe = arg.split("=")[1];
    else if (arg.startsWith("--days=")) days = parseInt(arg.split("=")[1], 10);
  }

  return { symbol, timeframe, days };
}

function printReport(report: AblationReport): void {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  Ablation Study: ${report.symbol} ${report.timeframe} | ${report.days}d | ${report.studyId}`);
  console.log(`${"═".repeat(70)}\n`);

  // Results table
  console.log("  Configuration".padEnd(28) + "Signals".padEnd(10) + "Net WR".padEnd(10) + "Net AvgR".padEnd(12) + "PF");
  console.log("  " + "─".repeat(66));

  for (const r of report.results) {
    const pf = r.summary.netProfitFactor === Infinity ? "∞" : r.summary.netProfitFactor.toFixed(2);
    console.log(
      `  ${r.label.padEnd(26)}${String(r.summary.signalsPublished).padEnd(10)}` +
        `${(r.summary.netWinRate * 100).toFixed(1).padStart(5)}%`.padEnd(10) +
        `${r.summary.netAvgR.toFixed(3).padStart(7)}`.padEnd(12) +
        pf
    );
  }

  // Contributions
  if (Object.keys(report.contributions).length > 0) {
    console.log(`\n  Factor Contributions (positive ΔR = factor helps):`);
    console.log("  " + "─".repeat(66));
    console.log("  Factor".padEnd(24) + "Verdict".padEnd(10) + "ΔWR".padEnd(10) + "ΔAvgR".padEnd(12) + "ΔPF");
    console.log("  " + "─".repeat(66));

    for (const [factor, c] of Object.entries(report.contributions)) {
      const icon = c.verdict === "HELPS" ? "✓" : c.verdict === "HURTS" ? "✗" : "─";
      console.log(
        `  ${icon} ${factor.padEnd(21)}${c.verdict.padEnd(10)}` +
          `${(c.deltaNetWinRate * 100).toFixed(1).padStart(5)}%`.padEnd(10) +
          `${c.deltaNetAvgR.toFixed(3).padStart(7)}`.padEnd(12) +
          c.deltaProfitFactor.toFixed(2)
      );
    }
  }
}

async function main(): Promise<void> {
  const { symbol, timeframe, days } = parseArgs();

  console.log("\n╔═══════════════════════════════════════════════╗");
  console.log("║   AgoraIQ Signal Engine — Factor Ablation      ║");
  console.log("╚═══════════════════════════════════════════════╝");
  console.log(`\n  Symbol: ${symbol} | Timeframe: ${timeframe} | Days: ${days}`);
  console.log("  Running 7 backtest configurations...\n");

  getDb();

  try {
    const report = await runAblationStudy(symbol, timeframe, days);
    printReport(report);
  } finally {
    resetFactors();
    closeDb();
  }

  console.log("\n  Results persisted to SQLite (ablation_results table).\n");
}

main().catch((err) => {
  console.error("Fatal:", err);
  resetFactors();
  closeDb();
  process.exit(1);
});
