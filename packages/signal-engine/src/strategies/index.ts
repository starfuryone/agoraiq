/**
 * @agoraiq/signal-engine v2 — Strategy Runner
 *
 * Three strategies covering three regimes:
 *   1. TREND_CONTINUATION — fires in TRENDING_BULL / TRENDING_BEAR
 *   2. MEAN_REVERSION    — fires in RANGE_CHOP (and extreme UNKNOWN)
 *   3. BREAKOUT_CONFIRMATION — fires in the transition zone where
 *      RANGE_CHOP or UNKNOWN is shifting to TRENDING, using real
 *      level detection from swing point clustering.
 *
 * Together these cover trending, ranging, and transitional regimes.
 * The only blind spot is HIGH_VOL_EVENT and LOW_LIQUIDITY, which are
 * intentionally excluded — those are risk regimes, not opportunity regimes.
 */

import type { MarketSnapshot, StrategySignalCandidate, StrategyFn } from "../types";
import { runTrendContinuation } from "./trend-continuation";
import { runMeanReversion } from "./mean-reversion";
import { runBreakout } from "./breakout";
import { logger } from "../services/logger";

const STRATEGIES: Array<{ name: string; fn: StrategyFn }> = [
  { name: "TREND_CONTINUATION", fn: runTrendContinuation },
  { name: "MEAN_REVERSION", fn: runMeanReversion },
  { name: "BREAKOUT_CONFIRMATION", fn: runBreakout },
];

export function runAllStrategies(
  snapshot: MarketSnapshot
): StrategySignalCandidate[] {
  const candidates: StrategySignalCandidate[] = [];

  for (const { name, fn } of STRATEGIES) {
    try {
      const candidate = fn(snapshot);
      if (candidate) {
        logger.debug(
          `Strategy ${name} fired for ${snapshot.symbol} ${snapshot.timeframe}: ${candidate.direction}`
        );
        candidates.push(candidate);
      }
    } catch (err) {
      logger.error(`Strategy ${name} threw for ${snapshot.symbol}`, { err });
    }
  }

  logger.info(
    `${snapshot.symbol} ${snapshot.timeframe}: ${candidates.length} candidate(s) from ${STRATEGIES.length} strategies`
  );

  return candidates;
}
