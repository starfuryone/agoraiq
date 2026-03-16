/**
 * @agoraiq/signal-engine v2 — Main Entry Point
 */

import http from "http";
import { config, validateConfig } from "./config";
import { buildMarketSnapshot } from "./snapshot-builder";
import { runAllStrategies } from "./strategies";
import { applyGlobalScoring } from "./scoring";
import { rankCandidates, selectBestCandidate, recordPublish, setActiveSymbols } from "./ranking";
import { shouldPublish, toFinalSignal, publishSignal } from "./publisher";
import { assertPublishGateIsolation } from "./ai-governance";
import { formatAlertMessage } from "./explanation";
import {
  trackSignal,
  updateTrackedSignals,
  getActiveSignalCount,
  getActiveSymbols,
  getRecentStats,
} from "./outcome-tracker";
import { nightlyFeedbackJob } from "./learning";
import { getDb, closeDb } from "./persistence/db";
import { logger } from "./services/logger";

// ─── Engine State ──────────────────────────────────────────────────────────────

let scanTimer: NodeJS.Timeout | null = null;
let learningTimer: NodeJS.Timeout | null = null;
let healthServer: http.Server | null = null;
let isRunning = false;
let scanInProgress = false;
let scanCount = 0;
let consecutiveFailures = 0;
let lastCycleResult: "ok" | "partial" | "failed" | "skipped" = "ok";
let lastCycleTimestamp: Date | null = null;

// ─── Single Scan Cycle ─────────────────────────────────────────────────────────

async function runScanCycle(): Promise<void> {
  if (scanInProgress) {
    logger.warn("Previous scan cycle still running — skipping this tick");
    lastCycleResult = "skipped";
    return;
  }

  scanInProgress = true;
  scanCount++;
  const cycleStart = Date.now();
  let published = 0;
  let scanned = 0;
  let errors = 0;

  logger.info(
    `━━━ Scan cycle #${scanCount} ━━━ symbols=[${config.symbols}] timeframes=[${config.timeframes}]`
  );

  try {
    // Feed active signals into ranking for dedup
    setActiveSymbols(getActiveSymbols());

    for (const symbol of config.symbols) {
      for (const timeframe of config.timeframes) {
        scanned++;
        try {
          const snapshot = await buildMarketSnapshot(symbol, timeframe);
          if (!snapshot) continue;

          const candidates = runAllStrategies(snapshot);
          if (candidates.length === 0) continue;

          const scoredCandidates = [];
          for (const candidate of candidates) {
            scoredCandidates.push(await applyGlobalScoring(candidate, snapshot));
          }

          const ranked = rankCandidates(scoredCandidates);
          const best = selectBestCandidate(ranked);

          if (shouldPublish(best)) {
            const signal = toFinalSignal(best!, snapshot);

            // GOVERNANCE: verify AI has not touched the score before publish gate.
            // signal.finalScore should equal best.finalScore (rule engine output).
            // If someone moves AI before this point, this throws.
            assertPublishGateIsolation(best!.finalScore, signal.finalScore);

            if (config.dryRun) {
              logger.info(
                `[DRY RUN] Would publish: ${signal.symbol} ${signal.direction} ` +
                  `${signal.strategyType} score=${signal.finalScore.toFixed(1)} R=${signal.expectedR}`
              );
              logger.info(`[DRY RUN] Alert:\n${formatAlertMessage(signal)}`);
              published++;
            } else {
              const ok = await publishSignal(signal, snapshot);
              if (ok) {
                published++;
                trackSignal(signal);
                recordPublish(signal.symbol, signal.direction);
              }
            }
          } else if (best) {
            logger.debug(
              `${symbol} ${timeframe}: best below gate ` +
                `(score=${best.finalScore.toFixed(1)} R=${best.expectedR} conf=${best.confidence})`
            );
          }
        } catch (err) {
          errors++;
          logger.error(`Error scanning ${symbol} ${timeframe}`, { err });
        }
      }
    }

    try {
      await updateTrackedSignals();
      const active = getActiveSignalCount();
      if (active > 0) {
        const stats = getRecentStats();
        logger.info(
          `Tracking: ${active} active | Recent: ${stats.count} resolved, ` +
            `WR=${(stats.winRate * 100).toFixed(0)}%, avgR=${stats.avgR.toFixed(2)}`
        );
      }
    } catch (err) {
      logger.warn("Outcome tracking update failed", { err });
    }

    if (errors === scanned && scanned > 0) {
      consecutiveFailures++;
      lastCycleResult = "failed";
      logger.error(
        `All ${scanned} scans failed. Consecutive: ${consecutiveFailures}/${config.maxConsecutiveFailures}`
      );
    } else {
      if (consecutiveFailures > 0) {
        logger.info(`Recovered after ${consecutiveFailures} failures`);
      }
      consecutiveFailures = 0;
      lastCycleResult = errors > 0 ? "partial" : "ok";
    }
  } finally {
    scanInProgress = false;
    lastCycleTimestamp = new Date();
  }

  const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
  logger.info(
    `━━━ Cycle #${scanCount}: ${scanned} scanned, ${published} published, ${errors} errors, ${elapsed}s ━━━`
  );
}

// ─── Health Endpoint ───────────────────────────────────────────────────────────

function startHealthServer(): void {
  healthServer = http.createServer((_req, res) => {
    const healthy =
      isRunning && consecutiveFailures < config.maxConsecutiveFailures;
    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: healthy ? "healthy" : "degraded",
        running: isRunning,
        scanCount,
        consecutiveFailures,
        lastCycleResult,
        lastCycleTimestamp: lastCycleTimestamp?.toISOString() ?? null,
        dryRun: config.dryRun,
        version: config.engineVersion,
      })
    );
  });

  healthServer.listen(config.healthPort, () => {
    logger.info(`Health endpoint listening on :${config.healthPort}/`);
  });
}

// ─── Startup Banner ────────────────────────────────────────────────────────────

function logBanner(): void {
  const lines = [
    `AgoraIQ Signal Engine v${config.engineVersion}`,
    `Symbols:    ${config.symbols.join(", ")}`,
    `Timeframes: ${config.timeframes.join(", ")}`,
    `Strategies: TREND_CONTINUATION, MEAN_REVERSION, BREAKOUT_CONFIRMATION`,
    `AI:         advisory (never blocks)`,
    `Score >=    ${config.minPublishScore}`,
    `R >=        ${config.minExpectedR}`,
    `Interval:   ${config.scanIntervalMs / 1000}s`,
    `Dry Run:    ${config.dryRun}`,
    `DB:         ${config.dbPath}`,
  ];

  logger.info("─".repeat(50));
  for (const line of lines) {
    logger.info(line);
  }
  logger.info("─".repeat(50));
}

// ─── Engine Lifecycle ──────────────────────────────────────────────────────────

export async function startEngine(): Promise<void> {
  if (isRunning) {
    logger.warn("Engine is already running");
    return;
  }

  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    for (const err of configErrors) {
      logger.error(`Config error: ${err}`);
    }
    throw new Error(`Invalid configuration: ${configErrors.length} error(s)`);
  }

  // Initialize persistence
  getDb();

  isRunning = true;
  logBanner();

  if (config.dryRun) {
    logger.warn("DRY RUN MODE — signals will be logged but NOT published");
  }

  startHealthServer();

  // Run first cycle immediately
  try {
    await runScanCycle();
  } catch (err) {
    logger.error("Initial scan cycle failed", { err });
  }

  // Schedule recurring scans
  scanTimer = setInterval(async () => {
    if (!isRunning) return;

    if (consecutiveFailures >= config.maxConsecutiveFailures) {
      logger.warn("Engine paused due to failures — resetting and retrying");
      consecutiveFailures = 0;
      return;
    }

    try {
      await runScanCycle();
    } catch (err) {
      logger.error("Scan cycle threw unhandled error", { err });
    }
  }, config.scanIntervalMs);

  // Schedule learning loop every 6 hours
  learningTimer = setInterval(async () => {
    try {
      await nightlyFeedbackJob();
    } catch (err) {
      logger.error("Learning loop failed", { err });
    }
  }, 6 * 60 * 60 * 1000);

  logger.info(
    `Engine scheduled: scan every ${config.scanIntervalMs / 1000}s, learning loop every 6h`
  );
}

export function stopEngine(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  if (learningTimer) {
    clearInterval(learningTimer);
    learningTimer = null;
  }
  if (healthServer) {
    healthServer.close();
    healthServer = null;
  }
  closeDb();
  isRunning = false;
  logger.info("Signal engine stopped");
}

export { runScanCycle as _runScanCycleForTesting };

// ─── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  process.on("SIGINT", () => {
    logger.info("SIGINT — shutting down");
    stopEngine();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    logger.info("SIGTERM — shutting down");
    stopEngine();
    process.exit(0);
  });

  startEngine().catch((err) => {
    logger.error("Fatal error starting engine", { err });
    process.exit(1);
  });
}

// Card renderer (HTML for dashboard)
export {
  renderSignalCard,
  tradeToCard,
  cornixToCard,
  type TradeRow,
  type CornixSignalLike,
} from './cardRenderer'

export { sanitizeSignalHtml } from './sanitizeHtml'

// LLM signal parser (fallback chain)
export { parseLLM, type CornixSignal, type CornixParseResult, type LLMProvider } from './parseLLM'

// LLM signal parser (fallback chain)
