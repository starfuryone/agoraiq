/**
 * ══════════════════════════════════════════════════════
 * AgoraIQ — Dashboard API Routes (PATCHED)
 * ══════════════════════════════════════════════════════
 *
 * FIXES:
 * - /signals: pair→symbol, direction→action, entryPrice→price, outcome from trades
 * - /top-providers: uses trades.status for win rate (not signals.action)
 * - /win-rate-trend: uses trades table for outcomes
 * - /intelligence: unchanged (helpers fixed separately)
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import {
  getMarketRegime,
  getMarketBreadth,
  getTopProvider,
  getMarketPulseData,
  generateExplainers,
  flushDashboardCache,
} from '../lib/dashboard-helpers';

const router: Router = Router();
router.use(requireAuth);

// ─────────────────────────────
// GET /intelligence
// Top-strip: regime, actionable signals, top provider, breadth
// ─────────────────────────────
router.get('/intelligence', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86_400_000);
    const twoDaysAgo = new Date(now.getTime() - 172_800_000);

    const [regime, breadth, topProvider, totalProviders, actionableToday, actionableYesterday] =
      await Promise.all([
        getMarketRegime(),
        getMarketBreadth(),
        getTopProvider('7d'),
        prisma.provider.count({ where: { isActive: true } }),
        prisma.signal.count({
          where: { confidence: { gte: 75 }, createdAt: { gte: yesterday } },
        }),
        prisma.signal.count({
          where: { confidence: { gte: 75 }, createdAt: { gte: twoDaysAgo, lt: yesterday } },
        }),
      ]);

    res.json({
      regime: {
        label: regime.label,
        confidence: regime.confidence,
        changedAgo: regime.changedAgo,
      },
      actionableCount: actionableToday,
      actionableDelta: actionableToday - actionableYesterday,
      topProvider: topProvider
        ? { name: topProvider.name, winRate: topProvider.winRate, avgR: topProvider.avgR }
        : null,
      breadth,
      totalProviders,
      updatedAt: now.toISOString(),
    });
  } catch (err) {
    console.error('[Dashboard] /intelligence error:', err);
    res.status(500).json({ error: 'Failed to load intelligence data' });
  }
});

// ─────────────────────────────
// GET /signals?limit=20
// FIXED: uses actual column names (symbol, action, price) + joins trades for outcome
// ─────────────────────────────
router.get('/signals', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const rows: any[] = await prisma.$queryRaw`
      SELECT
        s.id, s.symbol, s.action, s.price,
        s.confidence, s.score, s."createdAt", s.meta,
        p.name  AS "providerName",
        p.id    AS "providerId",
        t.status    AS "tradeStatus",
        t."rMultiple"
      FROM signals s
      LEFT JOIN providers p ON p.id = s."providerId"
      LEFT JOIN trades   t ON t."signalId" = s.id
      WHERE COALESCE(s.was_deleted, false) = false
      ORDER BY s."createdAt" DESC
      LIMIT ${limit}
    `;

    res.json({
      signals: rows.map((s: any) => ({
        id: s.id,
        pair: s.symbol,
        direction: s.action,                       // LONG / SHORT / BUY / SELL
        entry: s.price,
        confidence: s.confidence,
        score: s.score,
        provider: s.providerName || '—',
        providerName: s.providerName || '—',
        providerId: s.providerId,
        outcome: s.tradeStatus || null,             // TP_HIT / SL_HIT / ACTIVE / null
        status: s.tradeStatus || 'active',
        createdAt: s.createdAt,
        rMultiple: s.rMultiple || null,
      })),
    });
  } catch (err) {
    console.error('[Dashboard] /signals error:', err);
    res.status(500).json({ error: 'Failed to load signals' });
  }
});

// ─────────────────────────────
// GET /top-providers?range=7d&limit=8
// FIXED: queries trades table for win rate (signals.action = direction, not outcome)
// ─────────────────────────────
router.get('/top-providers', async (req: Request, res: Response) => {
  try {
    const range = req.query.range === '30d' ? 30 : 7;
    const limit = Math.min(parseInt(req.query.limit as string) || 8, 20);
    const since = new Date(Date.now() - range * 86_400_000);

    const providers: any[] = await prisma.$queryRaw`
      SELECT
        p.id, p.name,
        COUNT(t.id)::int AS "signalCount",
        ROUND(100.0 * COUNT(CASE WHEN t.status = 'HIT_TP' THEN 1 END) /
          NULLIF(COUNT(CASE WHEN t.status IN ('HIT_TP','HIT_SL') THEN 1 END), 0), 1)::float AS "winRate",
        ROUND(AVG(
          CASE WHEN t.status IN ('HIT_TP','HIT_SL') THEN t."rMultiple" END
        )::numeric, 2)::float AS "avgR"
      FROM providers p
      JOIN trades t ON t."providerId" = p.id
      WHERE COALESCE(t."exitedAt", t."updatedAt") >= ${since}
        AND p."isActive" = true
        AND t.status IN ('HIT_TP','HIT_SL')
      GROUP BY p.id, p.name
      HAVING COUNT(CASE WHEN t.status IN ('HIT_TP','HIT_SL') THEN 1 END) >= 3
      ORDER BY "winRate" DESC NULLS LAST
      LIMIT ${limit}
    `;

    res.json({
      providers: providers.map((p, i) => ({
        id: p.id,
        name: p.name,
        rank: i + 1,
        winRate: p.winRate || 0,
        avgR: p.avgR || 0,
        signalCount: p.signalCount,
      })),
    });
  } catch (err) {
    console.error('[Dashboard] /top-providers error:', err);
    res.status(500).json({ error: 'Failed to load providers' });
  }
});

// ─────────────────────────────
// GET /explainers
// ─────────────────────────────
router.get('/explainers', async (_req: Request, res: Response) => {
  try {
    const items = await generateExplainers();
    res.json({ items });
  } catch (err) {
    console.error('[Dashboard] /explainers error:', err);
    res.status(500).json({ error: 'Failed to load explainers' });
  }
});

// ─────────────────────────────
// GET /activity?days=30
// Bar chart: signal count per day (uses signals table — this was correct)
// ─────────────────────────────
router.get('/activity', async (req: Request, res: Response) => {
  try {
    const numDays = Math.min(parseInt(req.query.days as string) || 30, 90);
    const since = new Date(Date.now() - numDays * 86_400_000);

    const rows: any[] = await prisma.$queryRaw`
      SELECT DATE("createdAt") AS day, COUNT(*)::int AS count
      FROM signals WHERE "createdAt" >= ${since}
      GROUP BY DATE("createdAt") ORDER BY day ASC
    `;

    const dayMap = new Map(rows.map((r) => [new Date(r.day).toISOString().split('T')[0], r.count]));
    const days: number[] = [];
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().split('T')[0];
      days.push(dayMap.get(d) || 0);
    }

    res.json({ days });
  } catch (err) {
    console.error('[Dashboard] /activity error:', err);
    res.status(500).json({ error: 'Failed to load activity' });
  }
});

// ─────────────────────────────
// GET /win-rate-trend?days=30
// FIXED: queries trades table (outcomes), not signals.action
// ─────────────────────────────
router.get('/win-rate-trend', async (req: Request, res: Response) => {
  try {
    const numDays = Math.min(parseInt(req.query.days as string) || 30, 90);
    const since = new Date(Date.now() - numDays * 86_400_000);

    const rows: any[] = await prisma.$queryRaw`
      SELECT
        DATE(COALESCE(t."exitedAt", t."updatedAt")) AS day,
        COUNT(CASE WHEN t.status IN ('HIT_TP','HIT_SL') THEN 1 END)::int AS resolved,
        ROUND(
          100.0 * COUNT(CASE WHEN t.status = 'HIT_TP' THEN 1 END) /
          NULLIF(COUNT(CASE WHEN t.status IN ('HIT_TP','HIT_SL') THEN 1 END), 0), 1
        )::float AS "winRate"
      FROM trades t
      WHERE COALESCE(t."exitedAt", t."updatedAt") >= ${since}
        AND t.status IN ('HIT_TP','HIT_SL')
      GROUP BY DATE(COALESCE(t."exitedAt", t."updatedAt"))
      ORDER BY day ASC
    `;

    const rowMap = new Map(
      rows.map((r) => [
        new Date(r.day).toISOString().split('T')[0],
        { winRate: r.winRate || 0, resolved: r.resolved || 0 },
      ])
    );

    const trend: { date: string; winRate: number; resolved: number }[] = [];
    let lastWR = 0;
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().split('T')[0];
      const entry = rowMap.get(d);
      if (entry && entry.resolved > 0) {
        lastWR = entry.winRate;
        trend.push({ date: d, winRate: entry.winRate, resolved: entry.resolved });
      } else {
        trend.push({ date: d, winRate: lastWR, resolved: 0 });
      }
    }

    res.json({ trend });
  } catch (err) {
    console.error('[Dashboard] /win-rate-trend error:', err);
    res.status(500).json({ error: 'Failed to load win rate trend' });
  }
});

// ─────────────────────────────
// GET /market-pulse
// ─────────────────────────────
router.get('/market-pulse', async (_req: Request, res: Response) => {
  try {
    const pairs = await getMarketPulseData();

    const movers = pairs
      .filter((p) => Math.abs(p.change24h) >= 4)
      .map((p) => `${p.pair} ${p.change24h >= 0 ? '+' : ''}${p.change24h}%`);

    const breakouts = pairs
      .filter((p) => p.trend === 'Uptrend' && p.volumeStatus === 'Spike')
      .map((p) => p.pair);

    const freshSignals = pairs
      .filter((p) => p.signalCount > 0)
      .map((p) => p.pair);

    const overextended = pairs
      .filter((p) => Math.abs(p.change24h) >= 8 || p.volatility === 'High')
      .map((p) => p.pair);

    res.json({
      pairs,
      movers: movers.slice(0, 3),
      breakouts: breakouts.slice(0, 3),
      freshSignals: freshSignals.slice(0, 4),
      overextended: overextended.slice(0, 2),
    });
  } catch (err) {
    console.error('[Dashboard] /market-pulse error:', err);
    res.status(500).json({ error: 'Failed to load market pulse' });
  }
});

// ─────────────────────────────
// POST /flush-cache (admin only)
// ─────────────────────────────
router.post('/flush-cache', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (userId !== 'cmm3nh44400012xfntoh7dzqm') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  flushDashboardCache();
  res.json({ ok: true, message: 'Dashboard cache flushed' });
});

export default router;

export function createDashboardRoutes(db?: any): Router { return router; }
