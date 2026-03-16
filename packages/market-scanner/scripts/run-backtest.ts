#!/usr/bin/env npx tsx
/**
 * @agoraiq/signal-engine v2 — Backtest CLI
 *
 * Usage:
 *   npx tsx scripts/run-backtest.ts                          # BTC 1h 30d
 *   npx tsx scripts/run-backtest.ts --symbol=ETH --tf=4h --days=60
 *   npx tsx scripts/run-backtest.ts --all                    # all symbols × timeframes
 *   npx tsx scripts/run-backtest.ts --slip=10 --fee=20       # custom slippage/fees
 */

import dotenv from "dotenv";
dotenv.config();

import { runBacktest, type BacktestSummary, type BacktestConfig } from "../src/backtest";
import { getDb, closeDb } from "../src/persistence/db";

function parseArgs() {
  const args = process.argv.slice(2);
  let symbols = ["BTC"];
  let timeframes = ["1h"];
  let days = 30;
  const config: Partial<BacktestConfig> = {};

  for (const arg of args) {
    if (arg === "--all") { symbols = ["BTC", "ETH", "SOL", "XRP"]; timeframes = ["15m", "1h", "4h"]; }
    else if (arg.startsWith("--symbol=")) symbols = arg.split("=")[1].split(",");
    else if (arg.startsWith("--tf=")) timeframes = arg.split("=")[1].split(",");
    else if (arg.startsWith("--days=")) days = parseInt(arg.split("=")[1], 10);
    else if (arg.startsWith("--slip=")) config.slippageBps = parseInt(arg.split("=")[1], 10);
    else if (arg.startsWith("--fee=")) config.roundTripFeeBps = parseInt(arg.split("=")[1], 10);
  }

  return { symbols, timeframes, days, config };
}

function printSummary(s: BacktestSummary): void {
  console.log(`\n${"═".repeat(66)}`);
  console.log(`  ${s.symbol} ${s.timeframe} | ${s.days}d | Run: ${s.runId}`);
  console.log(`  Slippage: ${s.config.slippageBps}bps | Fees: ${s.config.roundTripFeeBps}bps round-trip`);
  console.log(`${"═".repeat(66)}`);
  console.log(`  Bars: ${s.totalBars} | Flagged: ${s.flaggedBars} | Generated: ${s.signalsGenerated} | Published: ${s.signalsPublished}`);
  console.log(`  Wins: ${s.wins} | Losses: ${s.losses} | Partials: ${s.partials} | Expired: ${s.expired} | Ambiguous: ${s.ambiguousCount}`);
  console.log(`  Gross: WR=${(s.grossWinRate * 100).toFixed(1)}%  avgR=${s.grossAvgR.toFixed(3)}`);
  console.log(`  Net:   WR=${(s.netWinRate * 100).toFixed(1)}%  avgR=${s.netAvgR.toFixed(3)}  PF=${s.netProfitFactor === Infinity ? "∞" : s.netProfitFactor.toFixed(2)}`);
  console.log(`  Equity Drawdown: ${s.maxEquityDrawdownR.toFixed(2)}R | Max Trade DD: ${(s.maxTradeDrawdownPct * 100).toFixed(1)}%`);

  if (s.ambiguousCount > 0) {
    console.log(`  ⚠ ${s.ambiguousCount} trades had intra-bar SL/TP ambiguity (counted as losses)`);
  }
  if (s.flaggedBars > 0) {
    console.log(`  ⚠ ${s.flaggedBars} bars flagged for data quality (zero vol or >10% gap)`);
  }

  for (const [label, data] of [["Strategy", s.byStrategy], ["Regime", s.byRegime], ["Confidence", s.byConfidence]] as const) {
    if (Object.keys(data).length > 0) {
      console.log(`\n  By ${label}:`);
      for (const [name, stats] of Object.entries(data)) {
        console.log(
          `    ${name.padEnd(22)} n=${String(stats.count).padEnd(4)} WR=${(stats.winRate * 100).toFixed(0).padStart(3)}% netR=${stats.avgR.toFixed(3)}`
        );
      }
    }
  }
}

async function main(): Promise<void> {
  const { symbols, timeframes, days, config } = parseArgs();

  console.log("\n╔═══════════════════════════════════════════════╗");
  console.log("║      AgoraIQ Signal Engine — Backtest CLI      ║");
  console.log("╚═══════════════════════════════════════════════╝");
  console.log(`\n  Symbols:    ${symbols.join(", ")}`);
  console.log(`  Timeframes: ${timeframes.join(", ")}`);
  console.log(`  Days:       ${days}`);
  console.log(`  Slippage:   ${config.slippageBps ?? 5}bps`);
  console.log(`  Fees:       ${config.roundTripFeeBps ?? 14}bps round-trip`);

  getDb();

  const summaries: BacktestSummary[] = [];

  for (const symbol of symbols) {
    for (const tf of timeframes) {
      try {
        summaries.push(await runBacktest(symbol, tf, days, config));
        printSummary(summaries[summaries.length - 1]);
      } catch (err: any) {
        console.error(`\n  ✗ ${symbol} ${tf}: ${err.message ?? err}`);
      }
    }
  }

  if (summaries.length > 1) {
    const total = summaries.reduce((s, r) => s + r.signalsPublished, 0);
    const totalNetR = summaries.reduce((s, r) => s + r.netAvgR * r.signalsPublished, 0);
    const totalWins = summaries.reduce((s, r) => s + r.wins, 0);
    const totalAmbig = summaries.reduce((s, r) => s + r.ambiguousCount, 0);

    console.log(`\n${"═".repeat(66)}`);
    console.log("  AGGREGATE");
    console.log(`${"═".repeat(66)}`);
    console.log(`  Total signals: ${total} | Wins: ${totalWins} | Ambiguous: ${totalAmbig}`);
    console.log(`  Overall net WR: ${total > 0 ? ((totalWins / total) * 100).toFixed(1) : "0"}%`);
    console.log(`  Overall net avg R: ${total > 0 ? (totalNetR / total).toFixed(3) : "0"}`);
  }

  closeDb();
  console.log("\n  Results persisted to SQLite.\n");
}

main().catch((err) => { console.error("Fatal:", err); closeDb(); process.exit(1); });
