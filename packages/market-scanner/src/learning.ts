/**
 * @agoraiq/signal-engine v2 — Learning Loop
 *
 * Aggregates closed signal performance from the signal_analysis table
 * and updates strategy_expectancy rows. This feeds back into the
 * provider_score component of the scoring engine.
 *
 * Runs on a schedule (nightly or after enough signals resolve).
 * Can also be triggered manually via CLI.
 */

import { getResolvedSignals, upsertExpectancy } from "./persistence/db";
import type { StrategyExpectancy, SignalAnalysisRow } from "./types";
import { logger } from "./services/logger";

interface GroupKey {
  strategyType: string;
  symbol: string;
  timeframe: string;
  regime: string;
}

interface GroupStats {
  wins: number;
  losses: number;
  totalR: number;
  count: number;
}

/**
 * Run the learning feedback job.
 * Reads resolved signals from the last N days, groups by strategy/symbol/tf/regime,
 * computes win rate and avg R, and upserts into strategy_expectancy.
 */
export async function runLearningLoop(lastDays = 30): Promise<number> {
  logger.info(`Learning loop: aggregating resolved signals from last ${lastDays} days`);

  const resolved = getResolvedSignals(lastDays);

  if (resolved.length === 0) {
    logger.info("Learning loop: no resolved signals to process");
    return 0;
  }

  // Group by strategy/symbol/timeframe/regime
  const groups = new Map<string, { key: GroupKey; stats: GroupStats }>();

  for (const row of resolved) {
    if (!row.outcome_label || row.outcome_label === "EXPIRED" || row.outcome_label === "INVALIDATED") {
      continue; // skip non-actionable outcomes
    }

    const groupKey = `${row.strategy_type}|${row.symbol}|${row.timeframe}|${row.regime}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: {
          strategyType: row.strategy_type,
          symbol: row.symbol,
          timeframe: row.timeframe,
          regime: row.regime,
        },
        stats: { wins: 0, losses: 0, totalR: 0, count: 0 },
      });
    }

    const group = groups.get(groupKey)!;
    group.stats.count++;
    group.stats.totalR += row.realized_r ?? 0;

    if (row.outcome_label === "WIN" || row.outcome_label === "PARTIAL") {
      group.stats.wins++;
    } else if (row.outcome_label === "LOSS") {
      group.stats.losses++;
    }
  }

  // Upsert expectancy for each group
  let updated = 0;

  for (const { key, stats } of groups.values()) {
    if (stats.count < 3) {
      // Need minimum sample size to be meaningful
      continue;
    }

    const expectancy: StrategyExpectancy = {
      strategyType: key.strategyType,
      symbol: key.symbol,
      timeframe: key.timeframe,
      regime: key.regime,
      winRate: stats.count > 0 ? stats.wins / stats.count : 0,
      avgR: stats.count > 0 ? stats.totalR / stats.count : 0,
      sampleSize: stats.count,
    };

    try {
      upsertExpectancy(expectancy);
      updated++;

      logger.debug(
        `Expectancy updated: ${key.strategyType}/${key.symbol}/${key.timeframe}/${key.regime} → ` +
          `WR=${(expectancy.winRate * 100).toFixed(0)}% avgR=${expectancy.avgR.toFixed(2)} n=${expectancy.sampleSize}`
      );
    } catch (err) {
      logger.warn(`Failed to upsert expectancy for ${key.strategyType}/${key.symbol}`, { err });
    }
  }

  logger.info(
    `Learning loop complete: ${resolved.length} resolved signals → ${groups.size} groups → ${updated} expectancies updated`
  );

  return updated;
}

/**
 * Nightly feedback job entry point.
 * Called by the scheduler or manually.
 */
export async function nightlyFeedbackJob(): Promise<void> {
  try {
    await runLearningLoop(30);
  } catch (err) {
    logger.error("Nightly feedback job failed", { err });
  }
}
