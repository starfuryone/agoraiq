// ============================================================
// AgoraIQ Market Intel — API Routes
// /routes/marketIntelRoutes.ts
//
// Mount in your Express app:
//   app.use('/api/market-intel', marketIntelRouter);
// ============================================================

import { Router, type Request, type Response } from 'express';
import { marketIntelGuard, adminGuard } from './marketIntelEntitlement.js';
import repo from './marketIntelRepository.js';
import { runVolatilityEngine } from './volatilityEngine.js';
import { runArbitrageEngine } from './arbitrageEngine.js';
import { runScoreRefresh } from './scoreRefreshService.js';
import type { AlertType } from './index.js';

// ── Deps wired to repository ──────────────────────────────────
const volatilityDeps = {
  saveSnapshot: repo.saveSnapshot,
  saveAlert:    repo.saveVolatilityAlert,
};

const arbitrageDeps = {
  saveAlert: repo.saveArbitrageAlert,
};

const scoreDeps = {
  saveScore:          repo.saveScore,
  getProviderWinRate: repo.getProviderWinRateForSymbol,
};

// ── Router ────────────────────────────────────────────────────
export const marketIntelRouter: import("express").Router = Router();

// ── GET /api/market-intel/overview ───────────────────────────
/**
 * Returns top scored opportunities sorted by score desc.
 * Query params:
 *   limit  - number of results (default 20, max 50)
 */
marketIntelRouter.get(
  '/overview',
  ...marketIntelGuard,
  async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10), 50);
      const scores = await repo.getTopScores(limit);

      res.json({
        ok:   true,
        data: scores,
        meta: {
          count:       scores.length,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[marketIntel] /overview error:', err);
      res.status(500).json({ ok: false, error: 'Failed to fetch overview' });
    }
  },
);

// ── GET /api/market-intel/scores ─────────────────────────────
/**
 * Returns recent score history for a specific symbol.
 * Query params:
 *   symbol  - required (e.g. BTCUSDT)
 *   limit   - optional (default 50, max 200)
 */
marketIntelRouter.get(
  '/scores',
  ...marketIntelGuard,
  async (req: Request, res: Response) => {
    const symbol = String(req.query.symbol ?? '').toUpperCase();
    if (!symbol) {
      res.status(400).json({ ok: false, error: 'symbol query param required' });
      return;
    }

    try {
      const limit  = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 200);
      const scores = await repo.getScoreHistory(symbol, limit);

      res.json({
        ok:   true,
        data: scores,
        meta: {
          symbol,
          count: scores.length,
        },
      });
    } catch (err) {
      console.error('[marketIntel] /scores error:', err);
      res.status(500).json({ ok: false, error: 'Failed to fetch scores' });
    }
  },
);

// ── GET /api/market-intel/alerts ─────────────────────────────
/**
 * Returns recent alerts stream.
 * Query params:
 *   type   - 'volatility' | 'arbitrage' | 'all' (default all)
 *   limit  - optional (default 50, max 200)
 *   since  - optional ISO datetime filter
 */
marketIntelRouter.get(
  '/alerts',
  ...marketIntelGuard,
  async (req: Request, res: Response) => {
    const type  = String(req.query.type ?? 'all') as AlertType | 'all';
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 200);
    const since = req.query.since ? new Date(String(req.query.since)) : undefined;

    const validTypes = ['volatility', 'arbitrage', 'regime', 'all'];
    if (!validTypes.includes(type)) {
      res.status(400).json({
        ok:    false,
        error: `type must be one of: ${validTypes.join(', ')}`,
      });
      return;
    }

    try {
      const alerts = await repo.getAlerts(type, limit, since);
      res.json({
        ok:   true,
        data: alerts,
        meta: { type, count: alerts.length },
      });
    } catch (err) {
      console.error('[marketIntel] /alerts error:', err);
      res.status(500).json({ ok: false, error: 'Failed to fetch alerts' });
    }
  },
);

// ── POST /api/market-intel/admin/recompute ────────────────────
/**
 * Manual trigger for all engines (admin only, for testing).
 * Body (optional):
 *   { engines: ['volatility', 'arbitrage', 'scores'] }
 */
marketIntelRouter.post(
  '/admin/recompute',
  ...adminGuard,
  async (req: Request, res: Response) => {
    const engines: string[] = req.body?.engines ?? ['volatility', 'arbitrage', 'scores'];
    const results: Record<string, unknown> = {};

    try {
      if (engines.includes('volatility')) {
        const alerts = await runVolatilityEngine(volatilityDeps);
        results.volatility = { alertsTriggered: alerts.length };
      }

      if (engines.includes('arbitrage')) {
        const alerts = await runArbitrageEngine(arbitrageDeps);
        results.arbitrage = { alertsTriggered: alerts.length };
      }

      if (engines.includes('scores')) {
        const scores = await runScoreRefresh(scoreDeps);
        results.scores = {
          computed: scores.length,
          top: scores[0] ?? null,
        };
      }

      res.json({ ok: true, results, triggeredAt: new Date().toISOString() });
    } catch (err) {
      console.error('[marketIntel] /admin/recompute error:', err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  },
);

export default marketIntelRouter;
