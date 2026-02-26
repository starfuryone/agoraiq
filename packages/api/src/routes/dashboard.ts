// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Dashboard Routes (Paid)
//
//   GET  /api/v1/dashboard/signals         — Signal inbox (paginated, filtered)
//   GET  /api/v1/dashboard/signals/:id     — Signal detail + trade outcome
//   GET  /api/v1/dashboard/providers       — Provider leaderboard
//   GET  /api/v1/dashboard/providers/:slug — Provider detail + recent signals
//   GET  /api/v1/dashboard/watchlists      — User watchlists
//   POST /api/v1/dashboard/watchlists      — Add watchlist item
//   DELETE /api/v1/dashboard/watchlists/:id— Remove watchlist item
//   GET  /api/v1/dashboard/exports/csv     — Export signals as CSV
//
// ALL require auth + active subscription.
// Queries scoped to user's workspace.
// ═══════════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma } from '@agoraiq/db';
import { z } from 'zod';
import { createLogger } from '@agoraiq/db';
import { requireAuth, requireSubscription } from '../middleware/auth';
import { dashboardCache } from '../services/cache';

const log = createLogger('dashboard-routes');

export function createDashboardRoutes(db: PrismaClient): Router {
  const router = Router();

  // All dashboard routes require auth + subscription
  router.use(requireAuth);
  router.use(requireSubscription(db));

  // ── GET /signals ────────────────────────────────────────────
  // Signal inbox with server-side pagination and filtering
  router.get('/signals', async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.SignalWhereInput = {
        workspaceId: req.user!.workspaceId,
      };

      // Filters
      if (req.query.provider) where.providerKey = req.query.provider as string;
      if (req.query.symbol) where.symbol = (req.query.symbol as string).toUpperCase();
      if (req.query.timeframe) where.timeframe = req.query.timeframe as string;
      if (req.query.action) where.action = req.query.action as string;
      if (req.query.minConfidence) {
        where.confidence = { gte: parseFloat(req.query.minConfidence as string) };
      }

      const [signals, total] = await Promise.all([
        db.signal.findMany({
          where, skip, take: limit,
          orderBy: { signalTs: 'desc' },
          select: {
            id: true, symbol: true, timeframe: true, action: true,
            score: true, confidence: true, signalTs: true, providerKey: true,
            price: true, meta: true,
            trade: {
              select: { id: true, status: true, direction: true, rMultiple: true, pnlPct: true, entryPrice: true, exitPrice: true, tpPrice: true, slPrice: true, tp1Price: true, tp2Price: true, tp3Price: true, tp1HitAt: true, tp2HitAt: true, tp3HitAt: true, tpHitCount: true },
            },
          },
        }),
        db.signal.count({ where }),
      ]);

      // Enrich signals with ITB metadata for paid display
      const enrichedSignals = signals.map(s => {
        const meta = (s.meta && typeof s.meta === 'object') ? s.meta as Record<string, any> : {};
        return {
          id: s.id,
          symbol: s.symbol,
          timeframe: s.timeframe,
          action: s.action,
          score: s.score,
          confidence: s.confidence,
          price: s.price,
          signalTs: s.signalTs,
          providerKey: s.providerKey,
          trade: s.trade,
          // ITB-specific fields for rich dashboard display
          tradeScore: meta.trade_score ?? null,
          bandNo: meta.band_no ?? null,
          bandSign: meta.band_sign ?? null,
          bandText: meta.band_text ?? null,
          source: meta.source ?? null,
        };
      });

      res.json({
        signals: enrichedSignals,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (err) {
      log.error({ err }, 'Signal inbox query failed');
      res.status(500).json({ error: 'SIGNALS_QUERY_FAILED' });
    }
  });

  // ── GET /signals/:id ───────────────────────────────────────
  router.get('/signals/:id', async (req: Request, res: Response) => {
    try {
      const signal = await db.signal.findFirst({
        where: { id: req.params.id as string, workspaceId: req.user!.workspaceId },
        include: {
          trade: true,
          provider: { select: { slug: true, name: true } },
        },
      });

      if (!signal) {
        res.status(404).json({ error: 'SIGNAL_NOT_FOUND' });
        return;
      }

      // Remove rawPayload from response (audit only)
      // Extract ITB metadata for enriched display
      const { rawPayload, meta, ...safeSignal } = signal;
      const itbMeta = (meta && typeof meta === 'object') ? meta as Record<string, any> : {};

      // Build enriched response with ITB-specific fields promoted to top level
      const enriched = {
        ...safeSignal,
        // ITB signal scoring (full data for paid users)
        tradeScore: itbMeta.trade_score ?? null,
        secondaryScore: itbMeta.secondary_score ?? null,
        bandNo: itbMeta.band_no ?? null,
        bandSign: itbMeta.band_sign ?? null,
        bandText: itbMeta.band_text ?? null,
        // OHLC candle data
        ohlc: itbMeta.open ? {
          open: itbMeta.open,
          high: itbMeta.high,
          low: itbMeta.low,
          close: itbMeta.close_price ?? signal.price,
          volume: itbMeta.volume ?? null,
        } : null,
        // Provider description
        itbDescription: itbMeta.description ?? null,
        // Transaction profit (if available)
        transaction: itbMeta.transaction ?? null,
        // Source identifier
        source: itbMeta.source ?? 'unknown',
      };

      res.json(enriched);
    } catch (err) {
      log.error({ err }, 'Signal detail query failed');
      res.status(500).json({ error: 'SIGNAL_DETAIL_FAILED' });
    }
  });

  // ── GET /providers ──────────────────────────────────────────
  // Provider leaderboard with 7d/30d/90d metrics
  router.get('/providers', async (req: Request, res: Response) => {
    try {
      const period = (req.query.period as string) || '30d';
      const cacheKey = `dash:providers:${req.user!.workspaceId}:${period}`;
      const cached = dashboardCache.get<any>(cacheKey);
      if (cached) { res.json(cached); return; }

      const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
      const days = daysMap[period] || 30;
      const since = new Date(Date.now() - days * 24 * 3600_000);

      const providers = await db.provider.findMany({
        where: { isActive: true },
        select: { id: true, slug: true, name: true, proofCategory: true },
      });

      const leaderboard = await Promise.all(
        providers.map(async (p) => {
          const trades = await db.trade.findMany({
            where: {
              providerId: p.id,
              workspaceId: req.user!.workspaceId,
              status: { in: ['HIT_TP', 'HIT_SL', 'EXPIRED'] },
              exitedAt: { gte: since },
              rMultiple: { not: null },
            },
            select: { rMultiple: true, pnlPct: true, status: true },
          });

          const total = trades.length;
          const wins = trades.filter(t => (t.rMultiple || 0) > 0).length;
          const winRate = total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0;
          const avgR = total > 0
            ? parseFloat((trades.reduce((s, t) => s + (t.rMultiple || 0), 0) / total).toFixed(2))
            : 0;
          const totalPnl = trades.reduce((s, t) => s + (t.pnlPct || 0), 0);

          return {
            slug: p.slug, name: p.name, category: p.proofCategory,
            totalTrades: total, wins, winRate, avgR,
            totalReturn: parseFloat(totalPnl.toFixed(2)),
          };
        }),
      );

      leaderboard.sort((a, b) => b.avgR - a.avgR);

      const result = { leaderboard, period };
      dashboardCache.set(cacheKey, result);
      res.json(result);
    } catch (err) {
      log.error({ err }, 'Provider leaderboard failed');
      res.status(500).json({ error: 'PROVIDERS_QUERY_FAILED' });
    }
  });

  // ── GET /providers/:slug ───────────────────────────────────
  router.get('/providers/:slug', async (req: Request, res: Response) => {
    try {
      const provider = await db.provider.findUnique({
        where: { slug: req.params.slug as string },
        select: { id: true, slug: true, name: true, description: true, proofCategory: true },
      });
      if (!provider) { res.status(404).json({ error: 'PROVIDER_NOT_FOUND' }); return; }

      const recentSignals = await db.signal.findMany({
        where: { providerId: provider.id, workspaceId: req.user!.workspaceId },
        orderBy: { signalTs: 'desc' },
        take: 20,
        select: {
          id: true, symbol: true, timeframe: true, action: true,
          score: true, confidence: true, signalTs: true,
          trade: { select: { status: true, rMultiple: true, pnlPct: true } },
        },
      });

      res.json({ provider, recentSignals });
    } catch (err) {
      log.error({ err }, 'Provider detail failed');
      res.status(500).json({ error: 'PROVIDER_DETAIL_FAILED' });
    }
  });

  // ── GET /watchlists ─────────────────────────────────────────
  router.get('/watchlists', async (req: Request, res: Response) => {
    try {
      const watchlists = await db.watchlist.findMany({
        where: { userId: req.user!.userId, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ watchlists });
    } catch (err) {
      log.error({ err }, 'Watchlist query failed');
      res.status(500).json({ error: 'WATCHLIST_QUERY_FAILED' });
    }
  });

  // ── POST /watchlists ────────────────────────────────────────
  const WatchlistSchema = z.object({
    type: z.enum(['symbol', 'provider']),
    value: z.string().min(1),
  });

  router.post('/watchlists', async (req: Request, res: Response) => {
    const parsed = WatchlistSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_FAILED', issues: parsed.error.issues });
      return;
    }

    try {
      const watchlist = await db.watchlist.upsert({
        where: {
          userId_type_value: {
            userId: req.user!.userId,
            type: parsed.data.type,
            value: parsed.data.value.toUpperCase(),
          },
        },
        update: { isActive: true },
        create: {
          userId: req.user!.userId,
          type: parsed.data.type,
          value: parsed.data.value.toUpperCase(),
        },
      });
      res.status(201).json({ watchlist });
    } catch (err) {
      log.error({ err }, 'Watchlist add failed');
      res.status(500).json({ error: 'WATCHLIST_ADD_FAILED' });
    }
  });

  // ── DELETE /watchlists/:id ──────────────────────────────────
  router.delete('/watchlists/:id', async (req: Request, res: Response) => {
    try {
      await db.watchlist.updateMany({
        where: { id: req.params.id as string, userId: req.user!.userId },
        data: { isActive: false },
      });
      res.json({ status: 'removed' });
    } catch (err) {
      log.error({ err }, 'Watchlist remove failed');
      res.status(500).json({ error: 'WATCHLIST_REMOVE_FAILED' });
    }
  });

  // ── GET /exports/csv ────────────────────────────────────────
  router.get('/exports/csv', async (req: Request, res: Response) => {
    try {
      const signals = await db.signal.findMany({
        where: { workspaceId: req.user!.workspaceId },
        orderBy: { signalTs: 'desc' },
        take: 5000,
        include: {
          trade: { select: { status: true, rMultiple: true, pnlPct: true, direction: true } },
          provider: { select: { slug: true, name: true } },
        },
      });

      const header = 'timestamp,provider,symbol,timeframe,action,confidence,score,direction,status,rMultiple,pnlPct\n';
      const rows = signals.map((s) => {
        const t = s.trade;
        return [
          s.signalTs.toISOString(), s.provider.slug, s.symbol, s.timeframe,
          s.action, s.confidence ?? '', s.score ?? '',
          t?.direction ?? '', t?.status ?? '', t?.rMultiple ?? '', t?.pnlPct ?? '',
        ].join(',');
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=agoraiq-signals-${new Date().toISOString().split('T')[0]}.csv`);
      res.send(header + rows.join('\n'));
    } catch (err) {
      log.error({ err }, 'CSV export failed');
      res.status(500).json({ error: 'EXPORT_FAILED' });
    }
  });


  // ── GET /performance ────────────────────────────────────────
  // Performance analytics with equity curve, drawdown, period stats
  router.get('/performance', async (req: Request, res: Response) => {
    try {
      const period = (req.query.period as string) || 'all';
      const providerSlug = req.query.provider as string | undefined;

      let since: Date | undefined;
      const now = new Date();
      if (period === 'today') {
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (period === '7d') {
        since = new Date(Date.now() - 7 * 24 * 3600_000);
      } else if (period === '30d') {
        since = new Date(Date.now() - 30 * 24 * 3600_000);
      } else if (period === '90d') {
        since = new Date(Date.now() - 90 * 24 * 3600_000);
      }

      const where: any = {
        workspaceId: req.user!.workspaceId,
        status: { in: ['HIT_TP', 'HIT_SL', 'EXPIRED', 'CLOSED'] },
        exitedAt: { not: null },
      };
      if (since) where.exitedAt = { ...where.exitedAt, gte: since };
      if (providerSlug) {
        const prov = await db.provider.findUnique({ where: { slug: providerSlug } });
        if (prov) where.providerId = prov.id;
      }

      const trades = await db.trade.findMany({
        where,
        orderBy: { exitedAt: 'asc' },
        select: {
          id: true, symbol: true, direction: true, status: true,
          entryPrice: true, exitPrice: true, rMultiple: true, pnlPct: true,
          leverage: true, enteredAt: true, exitedAt: true, providerId: true,
        },
      });

      const total = trades.length;
      const wins = trades.filter(t => t.status === 'HIT_TP').length;
      const losses = trades.filter(t => t.status === 'HIT_SL').length;
      const expired = trades.filter(t => t.status === 'EXPIRED' || t.status === 'CLOSED').length;
      const winRate = total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0;

      const rValues = trades.filter(t => t.rMultiple != null).map(t => t.rMultiple!);
      const avgR = rValues.length > 0 ? parseFloat((rValues.reduce((a, b) => a + b, 0) / rValues.length).toFixed(3)) : 0;
      const bestR = rValues.length > 0 ? parseFloat(Math.max(...rValues).toFixed(3)) : 0;
      const worstR = rValues.length > 0 ? parseFloat(Math.min(...rValues).toFixed(3)) : 0;

      const totalPnl = trades.reduce((s, t) => s + (t.pnlPct || 0), 0);
      const avgPnl = total > 0 ? totalPnl / total : 0;

      let cumPnl = 0; let peak = 0; let maxDrawdown = 0; let currentDrawdown = 0;
      const equityCurve: any[] = [];
      for (const t of trades) {
        cumPnl += (t.pnlPct || 0);
        if (cumPnl > peak) peak = cumPnl;
        currentDrawdown = peak - cumPnl;
        if (currentDrawdown > maxDrawdown) maxDrawdown = currentDrawdown;
        equityCurve.push({
          date: t.exitedAt!.toISOString(), cumPnl: parseFloat(cumPnl.toFixed(2)),
          drawdown: parseFloat((-currentDrawdown).toFixed(2)),
          symbol: t.symbol, status: t.status,
          rMultiple: t.rMultiple ? parseFloat(t.rMultiple.toFixed(3)) : null,
          pnlPct: t.pnlPct ? parseFloat(t.pnlPct.toFixed(2)) : null,
        });
      }

      let maxWinStreak = 0; let maxLoseStreak = 0; let tempWin = 0; let tempLose = 0;
      for (const t of trades) {
        if (t.status === 'HIT_TP') { tempWin++; tempLose = 0; if (tempWin > maxWinStreak) maxWinStreak = tempWin; }
        else if (t.status === 'HIT_SL') { tempLose++; tempWin = 0; if (tempLose > maxLoseStreak) maxLoseStreak = tempLose; }
      }

      const dailyMap = new Map<string, { pnl: number; trades: number; wins: number }>();
      for (const t of trades) {
        const day = t.exitedAt!.toISOString().split('T')[0];
        const existing = dailyMap.get(day) || { pnl: 0, trades: 0, wins: 0 };
        existing.pnl += (t.pnlPct || 0); existing.trades++;
        if (t.status === 'HIT_TP') existing.wins++;
        dailyMap.set(day, existing);
      }
      const dailyPnl = Array.from(dailyMap.entries()).map(([date, d]) => ({
        date, pnl: parseFloat(d.pnl.toFixed(2)), trades: d.trades,
        winRate: d.trades > 0 ? parseFloat(((d.wins / d.trades) * 100).toFixed(1)) : 0,
      }));

      const rBuckets: Record<string, number> = { '< -2R': 0, '-2R to -1R': 0, '-1R to 0R': 0, '0R to 1R': 0, '1R to 2R': 0, '2R to 3R': 0, '> 3R': 0 };
      for (const r of rValues) {
        if (r < -2) rBuckets['< -2R']++; else if (r < -1) rBuckets['-2R to -1R']++;
        else if (r < 0) rBuckets['-1R to 0R']++; else if (r < 1) rBuckets['0R to 1R']++;
        else if (r < 2) rBuckets['1R to 2R']++; else if (r < 3) rBuckets['2R to 3R']++;
        else rBuckets['> 3R']++;
      }

      const symbolMap = new Map<string, { pnl: number; trades: number; wins: number }>();
      for (const t of trades) {
        const existing = symbolMap.get(t.symbol) || { pnl: 0, trades: 0, wins: 0 };
        existing.pnl += (t.pnlPct || 0); existing.trades++;
        if (t.status === 'HIT_TP') existing.wins++;
        symbolMap.set(t.symbol, existing);
      }
      const topSymbols = Array.from(symbolMap.entries())
        .map(([symbol, d]) => ({ symbol, pnl: parseFloat(d.pnl.toFixed(2)), trades: d.trades,
          winRate: d.trades > 0 ? parseFloat(((d.wins / d.trades) * 100).toFixed(1)) : 0 }))
        .sort((a, b) => b.trades - a.trades).slice(0, 10);


      // ── Monthly Breakdown ─────────────────────────────────────
      const monthlyMap = new Map<string, { trades: number; wins: number; losses: number; pnl: number }>();
      for (const t of trades) {
        const d = new Date(t.exitedAt as Date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const existing = monthlyMap.get(key) || { trades: 0, wins: 0, losses: 0, pnl: 0 };
        existing.trades++;
        if (t.status === 'HIT_TP') existing.wins++;
        if (t.status === 'HIT_SL') existing.losses++;
        existing.pnl += t.pnlPct || 0;
        monthlyMap.set(key, existing);
      }
      const monthlyBreakdown = Array.from(monthlyMap.entries())
        .map(([month, d]) => ({
          month,
          trades: d.trades,
          wins: d.wins,
          losses: d.losses,
          pnl: parseFloat(d.pnl.toFixed(2)),
          winRate: d.trades > 0 ? parseFloat(((d.wins / d.trades) * 100).toFixed(1)) : 0,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));

      // ── Duration Analytics ────────────────────────────────────
      const durations: number[] = [];
      const tpDurations: number[] = [];
      const slDurations: number[] = [];
      for (const t of trades) {
        if (t.enteredAt && t.exitedAt) {
          const ms = new Date(t.exitedAt).getTime() - new Date(t.enteredAt).getTime();
          if (ms > 0) {
            const hrs = ms / 3600_000;
            durations.push(hrs);
            if (t.status === 'HIT_TP') tpDurations.push(hrs);
            if (t.status === 'HIT_SL') slDurations.push(hrs);
          }
        }
      }
      const avg = (arr: number[]) => arr.length > 0 ? parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2)) : 0;
      const median = (arr: number[]) => {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return parseFloat((sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
      };
      // Bucket durations: <1h, 1-4h, 4-12h, 12-24h, 1-3d, 3-7d, 7d+
      const durationBuckets = [
        { label: '<1h', min: 0, max: 1 },
        { label: '1-4h', min: 1, max: 4 },
        { label: '4-12h', min: 4, max: 12 },
        { label: '12-24h', min: 12, max: 24 },
        { label: '1-3d', min: 24, max: 72 },
        { label: '3-7d', min: 72, max: 168 },
        { label: '7d+', min: 168, max: Infinity },
      ].map(b => ({ label: b.label, count: durations.filter(d => d >= b.min && d < b.max).length }));

      const durationAnalytics = {
        avgDuration: avg(durations),
        medianDuration: median(durations),
        avgTimeToTP: avg(tpDurations),
        avgTimeToSL: avg(slDurations),
        medianTimeToTP: median(tpDurations),
        medianTimeToSL: median(slDurations),
        totalWithDuration: durations.length,
        distribution: durationBuckets,
      };

      res.json({
        period,
        summary: { totalTrades: total, wins, losses, expired, winRate, avgR, bestR, worstR,
          totalPnl: parseFloat(totalPnl.toFixed(2)), avgPnl: parseFloat(avgPnl.toFixed(2)),
          maxDrawdown: parseFloat(maxDrawdown.toFixed(2)), maxWinStreak, maxLoseStreak,
          profitFactor: losses > 0 ? parseFloat((trades.filter(t => (t.pnlPct || 0) > 0).reduce((s, t) => s + (t.pnlPct || 0), 0) / Math.abs(trades.filter(t => (t.pnlPct || 0) < 0).reduce((s, t) => s + (t.pnlPct || 0), 0) || 1)).toFixed(2)) : 0,
        },
        equityCurve, dailyPnl, rDistribution: rBuckets, topSymbols, monthlyBreakdown, durationAnalytics,
      });
    } catch (err) {
      log.error({ err }, 'Performance query failed');
      res.status(500).json({ error: 'PERFORMANCE_QUERY_FAILED' });
    }
  });

  return router;
}
