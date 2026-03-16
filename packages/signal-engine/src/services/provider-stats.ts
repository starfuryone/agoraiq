/**
 * @agoraiq/signal-engine — Provider Stats Service
 *
 * Looks up historical strategy expectancy for the provider_score component.
 * Now backed by SQLite (strategy_expectancy table) instead of returning
 * null stubs. Returns null when no data exists (scoring defaults to 50).
 */

import type { StrategyExpectancy } from "../types";
import { getExpectancy } from "../persistence/db";
import { logger } from "./logger";

/**
 * Get historical expectancy for a specific strategy/symbol/timeframe/regime combo.
 * Returns null if no data exists (engine defaults to neutral score of 50).
 */
export async function getSetupExpectancy(
  symbol: string,
  timeframe: string,
  strategyType: string,
  regime: string
): Promise<StrategyExpectancy | null> {
  try {
    const result = getExpectancy(strategyType, symbol, timeframe, regime);

    if (result) {
      logger.debug(
        `Expectancy hit: ${strategyType}/${symbol}/${timeframe}/${regime} → ` +
          `WR=${(result.winRate * 100).toFixed(0)}% avgR=${result.avgR.toFixed(2)} n=${result.sampleSize}`
      );
    }

    return result;
  } catch (err) {
    logger.warn("Expectancy lookup failed", { err });
    return null;
  }
}
