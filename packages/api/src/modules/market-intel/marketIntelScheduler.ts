// ============================================================
// AgoraIQ Market Intel — Scheduler
// /scheduler/marketIntelScheduler.ts
//
// Runs volatilityEngine, arbitrageEngine, scoreRefresh on cron.
// Uses in-process mutex locks to prevent concurrent overlapping runs.
//
// Mount in your app entry-point:
//   import { startMarketIntelScheduler } from './scheduler/marketIntelScheduler.js';
//   startMarketIntelScheduler();
// ============================================================

import cron from 'node-cron';
import { runVolatilityEngine } from './volatilityEngine.js';
import { runArbitrageEngine } from './arbitrageEngine.js';
import { runScoreRefresh } from './scoreRefreshService.js';
import repo from './marketIntelRepository.js';

// ── Cron expressions from env ─────────────────────────────────
const CRON_VOLATILITY = process.env.MARKET_INTEL_CRON_VOLATILITY ?? '*/1 * * * *';
const CRON_ARBITRAGE  = process.env.MARKET_INTEL_CRON_ARBITRAGE  ?? '*/1 * * * *';
const CRON_SCORE      = process.env.MARKET_INTEL_CRON_SCORE      ?? '*/2 * * * *';

// ── In-process mutex locks ────────────────────────────────────
// Prevents a new cron tick from starting if the previous run is still in-flight.
const locks = {
  volatility: false,
  arbitrage:  false,
  score:      false,
};

function withLock<T>(
  key: keyof typeof locks,
  fn: () => Promise<T>,
): () => Promise<void> {
  return async () => {
    if (locks[key]) {
      console.warn(`[scheduler] ${key} job still running — skipping tick`);
      return;
    }
    locks[key] = true;
    try {
      await fn();
    } catch (err) {
      console.error(`[scheduler] ${key} job threw unhandled error:`, err);
    } finally {
      locks[key] = false;
    }
  };
}

// ── Wired deps ────────────────────────────────────────────────
const volatilityDeps = {
  saveSnapshot: repo.saveSnapshot.bind(repo),
  saveAlert:    repo.saveVolatilityAlert.bind(repo),
};

const arbitrageDeps = {
  saveAlert: repo.saveArbitrageAlert.bind(repo),
};

const scoreDeps = {
  saveScore:          repo.saveScore.bind(repo),
  getProviderWinRate: repo.getProviderWinRateForSymbol.bind(repo),
};

// ── Job definitions ───────────────────────────────────────────
const volatilityJob = withLock('volatility', async () => {
  await runVolatilityEngine(volatilityDeps);
});

const arbitrageJob = withLock('arbitrage', async () => {
  await runArbitrageEngine(arbitrageDeps);
});

const scoreJob = withLock('score', async () => {
  await runScoreRefresh(scoreDeps);
});

// ── Scheduler bootstrap ───────────────────────────────────────
let scheduledTasks: ReturnType<typeof cron.schedule>[] = [];

export function startMarketIntelScheduler(): void {
  if (scheduledTasks.length > 0) {
    console.warn('[scheduler] Already started — ignoring duplicate call');
    return;
  }

  console.info('[scheduler] Starting Market Intel scheduler');
  console.info(`  Volatility engine : ${CRON_VOLATILITY}`);
  console.info(`  Arbitrage engine  : ${CRON_ARBITRAGE}`);
  console.info(`  Score refresh     : ${CRON_SCORE}`);

  scheduledTasks = [
    cron.schedule(CRON_VOLATILITY, volatilityJob,  { name: 'market-intel-volatility' }),
    cron.schedule(CRON_ARBITRAGE,  arbitrageJob,   { name: 'market-intel-arbitrage'  }),
    cron.schedule(CRON_SCORE,      scoreJob,        { name: 'market-intel-score'      }),
  ];

  // Warm-start: run once immediately on boot (non-blocking)
  console.info('[scheduler] Running warm-start jobs...');
  void volatilityJob();
  void arbitrageJob();
  void scoreJob();
}

export function stopMarketIntelScheduler(): void {
  scheduledTasks.forEach(t => t.destroy());
  scheduledTasks = [];
  console.info('[scheduler] Market Intel scheduler stopped');
}

// ── Graceful shutdown ─────────────────────────────────────────
process.on('SIGTERM', () => {
  stopMarketIntelScheduler();
});

process.on('SIGINT', () => {
  stopMarketIntelScheduler();
});
