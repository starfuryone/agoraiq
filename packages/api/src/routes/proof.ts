// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Proof Routes (Public) — ENHANCED
//
//   GET  /api/v1/proof/stats       — Aggregate KPIs
//   GET  /api/v1/proof/monthly     — Monthly performance
//   GET  /api/v1/proof/feed        — Recent outcomes (masked)
//   GET  /api/v1/proof/anomalies   — Notable outliers
//   GET  /api/v1/proof/stream      — SSE live updates
//
// ALL public. ALL pass through safe-mode filtering.
// NEVER return: providerId, rawPayload, exact prices, TP/SL.
// ═══════════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma } from '@agoraiq/db';
import { createLogger } from '@agoraiq/db';
import { proofCache } from '../services/cache';
import {
  SAFE_MODE_CONFIG,
  safeModeFeed,
  buildProviderMask,
  assertSafe,
} from '../services/safe-mode';
import { proofRateLimiter, sseConnectionGuard } from '../middleware/rate-limit';

const log = createLogger('proof-routes');

// ── Category Filters ──────────────────────────────────────────

type Category = 'spot' | 'futures-low' | 'futures-high' | 'all';
const FUTURES_EXCHANGES = ['BINANCE_FUTURES', 'BYBIT', 'KRAKEN'];

function categoryWhere(category: Category): Prisma.TradeWhereInput {
  switch (category) {
    case 'spot':
      return { exchange: 'BINANCE_SPOT' };
    case 'futures-low':
      return {
        exchange: { in: FUTURES_EXCHANGES as any },
        OR: [{ leverage: null }, { leverage: { lte: 10 } }],
      };
    case 'futures-high':
      return {
        exchange: { in: FUTURES_EXCHANGES as any },
        leverage: { gt: 10 },
      };
    case 'all':
    default:
      return {};
  }
}

// ── Route Factory ─────────────────────────────────────────────

export function createProofRoutes(
  db: PrismaClient,
  defaultWorkspaceId: string,
): Router {
  const router = Router();

  // Apply rate limiting to ALL proof endpoints
  router.use(proofRateLimiter);

  // ── GET /stats ──────────────────────────────────────────────
  router.get('/stats', async (req: Request, res: Response) => {
    try {
      const category = (req.query.category as Category) || 'all';
      const cacheKey = `proof:stats:${category}`;
      const cached = proofCache.get<any>(cacheKey);
      if (cached) { res.json(cached); return; }

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600_000);
      const baseWhere: Prisma.TradeWhereInput = {
        workspaceId: defaultWorkspaceId,
        ...categoryWhere(category),
      };
      const closedStatuses = ['HIT_SL', 'HIT_TP', 'EXPIRED'] as any[];

      const [totalSignals, activeTrades, closedTrades30d, tradeData30d] = await Promise.all([
        db.trade.count({ where: { workspaceId: defaultWorkspaceId, ...categoryWhere(category) } }),
        db.trade.count({ where: { ...baseWhere, status: 'ACTIVE' } }),
        db.trade.count({
          where: { ...baseWhere, status: { in: closedStatuses }, exitedAt: { gte: thirtyDaysAgo } },
        }),
        db.trade.findMany({
          where: {
            ...baseWhere, status: { in: closedStatuses },
            exitedAt: { gte: thirtyDaysAgo }, rMultiple: { not: null },
          },
          select: { rMultiple: true, pnlPct: true, status: true, exitedAt: true },
          orderBy: { exitedAt: 'asc' },
        }),
      ]);

      let winRate30d = 0, avgRR30d = 0, maxDrawdown30d = 0;
      if (tradeData30d.length > 0) {
        const wins = tradeData30d.filter(t => (t.rMultiple || 0) > 0).length;
        winRate30d = parseFloat(((wins / tradeData30d.length) * 100).toFixed(1));
        const rValues = tradeData30d.map(t => t.rMultiple || 0);
        const positiveR = rValues.filter(r => r > 0);
        const negativeR = rValues.filter(r => r < 0);
        avgRR30d = negativeR.length > 0 && positiveR.length > 0
          ? parseFloat(((positiveR.reduce((a, b) => a + b, 0) / positiveR.length) /
              Math.abs(negativeR.reduce((a, b) => a + b, 0) / negativeR.length)).toFixed(2))
          : 0;
        let equity = 100, peak = 100, maxDD = 0;
        for (const trade of tradeData30d) {
          const r = trade.rMultiple || 0;
          equity += r * 1;
          if (equity > peak) peak = equity;
          const dd = ((equity - peak) / peak) * 100;
          if (dd < maxDD) maxDD = dd;
        }
        maxDrawdown30d = parseFloat(maxDD.toFixed(1));
      }

      const stats = {
        signalsTracked: totalSignals,
        winRate30d, avgRR30d, maxDrawdown30d,
        activeTrades, closedTrades30d,
        lastUpdated: now.toISOString(),
      };

      // Safe-mode assertion: no forbidden fields
      assertSafe(stats);
      proofCache.set(cacheKey, stats);
      res.json(stats);
    } catch (err) {
      log.error({ err }, 'proof stats failed');
      res.status(500).json({ error: 'PROOF_STATS_FAILED' });
    }
  });

  // ── GET /monthly ────────────────────────────────────────────
  router.get('/monthly', async (req: Request, res: Response) => {
    try {
      const category = (req.query.category as Category) || 'all';
      const monthsBack = Math.min(
        parseInt(req.query.months as string, 10) || 6,
        SAFE_MODE_CONFIG.maxMonths, // enforce cap
      );
      const cacheKey = `proof:monthly:${category}:${monthsBack}`;
      const cached = proofCache.get<any>(cacheKey);
      if (cached) { res.json(cached); return; }

      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
      const closedStatuses = ['HIT_SL', 'HIT_TP', 'EXPIRED'] as any[];

      const trades = await db.trade.findMany({
        where: {
          workspaceId: defaultWorkspaceId, ...categoryWhere(category),
          status: { in: closedStatuses }, exitedAt: { gte: startDate },
          rMultiple: { not: null },
        },
        select: { rMultiple: true, pnlPct: true, status: true, exitedAt: true },
        orderBy: { exitedAt: 'desc' },
      });

      const monthMap = new Map<string, typeof trades>();
      for (const trade of trades) {
        if (!trade.exitedAt) continue;
        const d = new Date(trade.exitedAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthMap.has(key)) monthMap.set(key, []);
        monthMap.get(key)!.push(trade);
      }

      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const rows = [...monthMap.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([key, mt]) => {
          const [year, month] = key.split('-').map(Number);
          const wins = mt.filter(t => (t.rMultiple || 0) > 0).length;
          const losses = mt.filter(t => t.status === 'HIT_SL').length;
          const expired = mt.filter(t => t.status === 'EXPIRED').length;
          const totalPnl = mt.reduce((s, t) => s + (t.pnlPct || 0), 0);
          const eligible = mt.filter(t => t.status !== 'EXPIRED').length;
          const winRate = eligible > 0 ? (wins / eligible) * 100 : 0;
          const rVals = mt.map(t => t.rMultiple || 0);
          const posR = rVals.filter(r => r > 0);
          const negR = rVals.filter(r => r < 0);
          const avgRR = posR.length > 0 && negR.length > 0
            ? (posR.reduce((a,b)=>a+b,0)/posR.length)/Math.abs(negR.reduce((a,b)=>a+b,0)/negR.length)
            : posR.length > 0 ? posR.reduce((a,b)=>a+b,0)/posR.length : 0;
          return {
            month: `${monthNames[month-1]} ${year}`,
            signals: mt.length, wins, losses, expired,
            winRate: parseFloat(winRate.toFixed(1)),
            avgRR: parseFloat(avgRR.toFixed(2)),
            totalReturn: `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(1)}%`,
          };
        });

      const result = { months: rows, category };
      assertSafe(result);
      proofCache.set(cacheKey, result);
      res.json(result);
    } catch (err) {
      log.error({ err }, 'proof monthly failed');
      res.status(500).json({ error: 'PROOF_MONTHLY_FAILED' });
    }
  });

  // ── GET /feed ───────────────────────────────────────────────
  // Recent outcomes, masked providers, redacted prices, capped
  router.get('/feed', async (req: Request, res: Response) => {
    try {
      const category = (req.query.category as Category) || 'all';
      const cacheKey = `proof:feed:${category}`;
      const cached = proofCache.get<any>(cacheKey);
      if (cached) { res.json(cached); return; }

      // Fetch recent trades with signal meta for ITB enrichment
      const trades = await db.trade.findMany({
        where: {
          workspaceId: defaultWorkspaceId,
          ...categoryWhere(category),
        },
        select: {
          id: true, symbol: true, timeframe: true, direction: true,
          status: true, entryPrice: true, exitPrice: true, tpPrice: true, slPrice: true,
          rMultiple: true, pnlPct: true, providerId: true,
          createdAt: true, exitedAt: true,
          // Include signal meta for partial ITB data in proof feed
          signal: {
            select: { meta: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50, // fetch more than cap, safe-mode will trim
      });

      // Flatten signal.meta onto trade objects for safe-mode processing
      const tradesWithMeta = trades.map(t => ({
        ...t,
        meta: (t.signal as any)?.meta ?? null,
        signal: undefined, // remove nested signal object
      }));

      // Build provider mask from rankings
      const providerStats = await db.trade.groupBy({
        by: ['providerId'],
        where: {
          workspaceId: defaultWorkspaceId,
          status: { in: ['HIT_TP', 'HIT_SL'] },
          rMultiple: { not: null },
        },
        _count: true,
        _avg: { rMultiple: true },
      });

      const providers = await db.provider.findMany({
        where: { id: { in: providerStats.map(p => p.providerId) } },
        select: { id: true, slug: true, name: true },
      });

      const rankings = providerStats
        .map((ps, idx) => ({
          providerId: ps.providerId,
          slug: providers.find(p => p.id === ps.providerId)?.slug || 'unknown',
          name: providers.find(p => p.id === ps.providerId)?.name || 'Unknown',
          rank: idx + 1,
          avgRR: ps._avg?.rMultiple || 0,
        }))
        .sort((a, b) => (b.avgRR as number) - (a.avgRR as number))
        .map((p, i) => ({ ...p, rank: i + 1 }));

      const providerMask = buildProviderMask(rankings);

      // Apply safe-mode feed transformation
      const safeFeed = safeModeFeed(
        tradesWithMeta.map(t => ({ ...t, createdAt: t.createdAt })),
        providerMask,
      );

      const result = { feed: safeFeed, category };
      assertSafe(result);
      proofCache.set(cacheKey, result);
      res.json(result);
    } catch (err) {
      log.error({ err }, 'proof feed failed');
      res.status(500).json({ error: 'PROOF_FEED_FAILED' });
    }
  });

  // ── GET /anomalies ──────────────────────────────────────────
  // Notable outlier trades (highest R-multiple, biggest losses)
  router.get('/anomalies', async (req: Request, res: Response) => {
    try {
      const category = (req.query.category as Category) || 'all';
      const cacheKey = `proof:anomalies:${category}`;
      const cached = proofCache.get<any>(cacheKey);
      if (cached) { res.json(cached); return; }

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600_000);

      // Top wins
      const topWins = await db.trade.findMany({
        where: {
          workspaceId: defaultWorkspaceId, ...categoryWhere(category),
          status: 'HIT_TP', exitedAt: { gte: thirtyDaysAgo },
          rMultiple: { not: null },
        },
        select: { id: true, symbol: true, timeframe: true, direction: true,
          status: true, rMultiple: true, pnlPct: true, createdAt: true, exitedAt: true },
        orderBy: { rMultiple: 'desc' },
        take: 5,
      });

      // Top losses
      const topLosses = await db.trade.findMany({
        where: {
          workspaceId: defaultWorkspaceId, ...categoryWhere(category),
          status: 'HIT_SL', exitedAt: { gte: thirtyDaysAgo },
          rMultiple: { not: null },
        },
        select: { id: true, symbol: true, timeframe: true, direction: true,
          status: true, rMultiple: true, pnlPct: true, createdAt: true, exitedAt: true },
        orderBy: { rMultiple: 'asc' },
        take: 5,
      });

      // Redact: no prices, no provider info
      const redact = (t: any) => ({
        id: t.id, symbol: t.symbol, timeframe: t.timeframe,
        direction: t.direction, status: t.status,
        rMultiple: t.rMultiple, pnlPct: t.pnlPct,
        createdAt: t.createdAt, exitedAt: t.exitedAt,
      });

      const result = {
        topWins: topWins.map(redact),
        topLosses: topLosses.map(redact),
        category,
      };
      assertSafe(result);
      proofCache.set(cacheKey, result);
      res.json(result);
    } catch (err) {
      log.error({ err }, 'proof anomalies failed');
      res.status(500).json({ error: 'PROOF_ANOMALIES_FAILED' });
    }
  });

  // ── GET /stream ─────────────────────────────────────────────
  // SSE for live KPI updates (stats + closed outcomes only)
  router.get('/stream', sseConnectionGuard, (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('event: connected\ndata: {"status":"ok"}\n\n');

    const sendStats = async () => {
      try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600_000);
        const closedStatuses = ['HIT_SL', 'HIT_TP', 'EXPIRED'] as any[];

        const [totalSignals, activeTrades, recentTrades] = await Promise.all([
          db.trade.count({ where: { workspaceId: defaultWorkspaceId } }),
          db.trade.count({ where: { workspaceId: defaultWorkspaceId, status: 'ACTIVE' } }),
          db.trade.findMany({
            where: {
              workspaceId: defaultWorkspaceId,
              status: { in: closedStatuses },
              exitedAt: { gte: thirtyDaysAgo },
              rMultiple: { not: null },
            },
            select: { rMultiple: true, pnlPct: true, status: true },
          }),
        ]);

        const wins = recentTrades.filter(t => (t.rMultiple || 0) > 0).length;
        const winRate = recentTrades.length > 0
          ? parseFloat(((wins / recentTrades.length) * 100).toFixed(1)) : 0;
        const rValues = recentTrades.map(t => t.rMultiple || 0);
        const positiveR = rValues.filter(r => r > 0);
        const negativeR = rValues.filter(r => r < 0);
        const avgRR = negativeR.length > 0 && positiveR.length > 0
          ? parseFloat(((positiveR.reduce((a,b)=>a+b,0)/positiveR.length) /
              Math.abs(negativeR.reduce((a,b)=>a+b,0)/negativeR.length)).toFixed(2))
          : 0;

        const payload = {
          signalsTracked: totalSignals, winRate30d: winRate, avgRR30d: avgRR,
          activeTrades, closedTrades30d: recentTrades.length,
          lastUpdated: now.toISOString(),
        };

        res.write(`event: stats\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch (err) {
        log.error({ err }, 'SSE stats push failed');
        res.write(`event: error\ndata: {"error":"STATS_FETCH_FAILED"}\n\n`);
      }
    };

    sendStats();
    const interval = setInterval(sendStats, 30_000);
    const heartbeat = setInterval(() => { res.write(': heartbeat\n\n'); }, 15_000);
    req.on('close', () => { clearInterval(interval); clearInterval(heartbeat); });
  });

  return router;
}
