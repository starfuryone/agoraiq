// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Marketplace Routes
//
//   GET  /providers            — Browse marketplace (public)
//   GET  /providers/:slug      — Provider detail
//   GET  /providers/:slug/monthly   — Monthly breakdown
//   GET  /providers/:slug/timeline  — Edit/delete audit log
//   GET  /verify/:hash         — SHA-256 hash verification
//   POST /import               — Import provider (JWT required)
// ═══════════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@agoraiq/db';
import { createLogger } from '@agoraiq/db';

const log = createLogger('marketplace');

export function createMarketplaceRoutes(db: PrismaClient): Router {
  const router = Router();

  // ── GET /providers ────────────────────────────────────────
  router.get('/providers', async (req: Request, res: Response) => {
    try {
      const {
        market, style, leverage, exchange, language,
        sort = 'volAdj', minTrades = '0',
        limit = '50', offset = '0',
      } = req.query as Record<string, string>;

      // Build filter
      const where: any = {
        marketplaceVisible: true,
        isActive: true,
        marketplaceTier: { in: ['VERIFIED', 'BETA'] },
      };
      const tierFilter = (req.query.tier as string) || 'all';
      if (tierFilter === 'VERIFIED') where.marketplaceTier = 'VERIFIED';
      else if (tierFilter === 'BETA') where.marketplaceTier = 'BETA';
      else if (tierFilter === 'PENDING') where.marketplaceTier = 'PENDING';
      else where.marketplaceTier = { in: ['VERIFIED', 'BETA', 'PENDING', 'ELITE'] };
      // Search filter
      const search = (req.query.search as string) || '';
      if (search.length >= 2) {
        where.name = { contains: search, mode: 'insensitive' };
      }
      const typeFilter = (req.query.type as string) || 'all';
      if (typeFilter === 'SIGNAL') where.providerType = 'SIGNAL';
      if (typeFilter === 'TOOL') where.providerType = 'TOOL';
      if (typeFilter === 'ALERT') where.providerType = 'ALERT';
      if (market && market !== 'All') where.marketType = market;
      if (style && style !== 'All') where.tradingStyle = style;
      if (leverage && leverage !== 'All') where.leverageBand = leverage;
      if (exchange && exchange !== 'All') where.exchangeFocus = exchange;
      if (language && language !== 'All') where.language = language;

      const providers = await db.provider.findMany({
        where,
        include: {
          statsSnapshots: {
            where: { period: '30d' },
            take: 1,
          },
        },
      });

      // Apply minTrades filter + sort
      const minT = parseInt(minTrades) || 0;
      const sorted = providers
        .filter(p => {
          const snap = p.statsSnapshots[0];
          return !snap || (snap.tradeCount || 0) >= minT;
        })
        .sort((a, b) => {
          const sa = a.statsSnapshots[0];
          const sb = b.statsSnapshots[0];
          if (!sa && !sb) return 0;
          if (!sa) return 1;
          if (!sb) return -1;
          switch (sort) {
            case 'volAdj':
              return (sb.volAdjExpectancy ?? -99) - (sa.volAdjExpectancy ?? -99);
            case 'expectancy':
              return (sb.expectancyR ?? 0) - (sa.expectancyR ?? 0);
            case 'winrate':
              return (sb.winRate ?? 0) - (sa.winRate ?? 0);
            case 'maxdd':
              return (sb.maxDrawdownPct ?? -999) - (sa.maxDrawdownPct ?? -999);
            case 'completeness':
              return (sb.dataCompleteness ?? 0) - (sa.dataCompleteness ?? 0);
            case 'trades':
              return (sb.tradeCount ?? 0) - (sa.tradeCount ?? 0);
            case 'recent':
              return new Date(b.trackedSince || 0).getTime() - new Date(a.trackedSince || 0).getTime();
            default:
              return (sb.volAdjExpectancy ?? -99) - (sa.volAdjExpectancy ?? -99);
          }
        })
        .slice(parseInt(offset), parseInt(offset) + parseInt(limit));

      res.json({
        providers: sorted.map(p => {
          const s = p.statsSnapshots[0];
          return {
            id: p.id,
            slug: p.slug,
            name: p.name,
            description: p.description,
            tier: p.marketplaceTier,
            isRanked: p.marketplaceTier === 'VERIFIED',
            providerType: p.providerType,
            category: p.category,
            chain: p.chain,
            analyticsEligible: p.analyticsEligible,
            tags: {
              market: p.marketType,
              style: p.tradingStyle,
              leverageBand: p.leverageBand,
              exchange: p.exchangeFocus,
            },
            language: p.language,
            channelType: p.channelType,
            isVerified: p.isVerified,
            subscriberCount: p.subscriberCount,
            trackedSince: p.trackedSince,
            stats30d: s ? {
              winRate: s.winRate,
              expectancyR: s.expectancyR,
              volAdjExpectancy: s.volAdjExpectancy,
              rStddev: s.rStddev,
              maxDD: s.maxDrawdownPct,
              trades: s.tradeCount,
              dataCompleteness: s.dataCompleteness,
              sampleConfidence: s.sampleConfidence,
              cherryPickScore: s.cherryPickScore,
              cherryLabel: cherryLabel(s.cherryPickScore),
              lifecycle: {
                withEntry: s.pctWithEntry,
                withSL: s.pctWithSl,
                withTP: s.pctWithTp,
                withOutcome: s.pctWithOutcome,
              },
            } : null,
          };
        }),
        total: providers.length,
      });
    } catch (err) {
      log.error({ err }, 'marketplace browse failed');
      res.status(500).json({ error: 'MARKETPLACE_BROWSE_FAILED' });
    }
  });

  // ── GET /providers/:slug ──────────────────────────────────
  router.get('/providers/:slug', async (req: Request, res: Response) => {
    try {
      const provider = await db.provider.findUnique({
        where: { slug: String(req.params.slug) },
        include: {
          statsSnapshots: true,
        },
      });

      if (!provider || !provider.marketplaceVisible) {
        res.status(404).json({ error: 'PROVIDER_NOT_FOUND' });
        return;
      }

      // Organize stats by period
      const stats: Record<string, any> = {};
      for (const snap of provider.statsSnapshots) {
        stats[snap.period] = {
          winRate: snap.winRate,
          expectancyR: snap.expectancyR,
          volAdjExpectancy: snap.volAdjExpectancy,
          rStddev: snap.rStddev,
          maxDD: snap.maxDrawdownPct,
          trades: snap.tradeCount,
          profitFactor: snap.profitFactor,
          dataCompleteness: snap.dataCompleteness,
          sampleConfidence: snap.sampleConfidence,
          cherryPickScore: snap.cherryPickScore,
          cherryLabel: cherryLabel(snap.cherryPickScore),
          cherry: {
            deleteRate: snap.cherryDeleteRate,
            editRate: snap.cherryEditRate,
            unresolvedRate: snap.cherryUnresolvedRate,
            announceRatio: snap.cherryAnnounceRatio,
            confidence: snap.cherryConfidence,
          },
          lifecycle: {
            withEntry: snap.pctWithEntry,
            withSL: snap.pctWithSl,
            withTP: snap.pctWithTp,
            withOutcome: snap.pctWithOutcome,
            fullCycle: snap.pctFullCycle,
          },
          computedAt: snap.computedAt,
        };
      }

      // Recent signals with hashes (last 10)
      const recentSignals = await db.signal.findMany({
        where: {
          providerId: provider.id,
          originalHash: { not: null },
        },
        include: {
          trade: true,
        },
        orderBy: { signalTs: 'desc' },
        take: 10,
      }) as any[];

      const { statsSnapshots, marketplaceVisible, isActive, ...providerData } = provider;

      res.json({
        provider: providerData,
        stats,
        recentSignals: recentSignals.map(s => ({
          symbol: s.symbol,
          action: s.action,
          timestamp: s.signalTs,
          hash: s.originalHash,
          hashShort: s.originalHash?.slice(0, 8),
          wasEdited: s.wasEdited,
          wasDeleted: s.wasDeleted,
          outcome: s.trade?.status || 'ACTIVE',
          rMultiple: s.trade?.rMultiple,
        })),
      });
    } catch (err) {
      log.error({ err }, 'marketplace detail failed');
      res.status(500).json({ error: 'MARKETPLACE_DETAIL_FAILED' });
    }
  });

  // ── GET /providers/:slug/monthly ──────────────────────────
  router.get('/providers/:slug/monthly', async (req: Request, res: Response) => {
    try {
      const provider = await db.provider.findUnique({
        where: { slug: String(req.params.slug) },
        select: { id: true, marketplaceVisible: true },
      });
      if (!provider || !provider.marketplaceVisible) {
        res.status(404).json({ error: 'PROVIDER_NOT_FOUND' });
        return;
      }

      const months = await (db as any).providerMonthlyStats.findMany({
        where: { providerId: provider.id },
        orderBy: { month: 'desc' },
        take: parseInt(String(req.query.limit || "50")) || 12,
      });

      res.json({
        providerId: provider.id,
        months: months.map((m: any) => ({
          month: m.month,
          winRate: m.winRate,
          expectancyR: m.expectancyR,
          volAdjExpectancy: m.volAdjExpectancy,
          rStddev: m.rStddev,
          maxDD: m.maxDrawdownPct,
          trades: m.tradeCount,
          dataCompleteness: m.dataCompleteness,
          cherryPickScore: m.cherryPickScore,
          sampleConfidence: m.sampleConfidence,
        })),
      });
    } catch (err) {
      log.error({ err }, 'marketplace monthly failed');
      res.status(500).json({ error: 'MARKETPLACE_MONTHLY_FAILED' });
    }
  });

  // ── GET /providers/:slug/timeline ─────────────────────────
  router.get('/providers/:slug/timeline', async (req: Request, res: Response) => {
    try {
      const provider = await db.provider.findUnique({
        where: { slug: String(req.params.slug) },
        select: { id: true, marketplaceVisible: true },
      });
      if (!provider || !provider.marketplaceVisible) {
        res.status(404).json({ error: 'PROVIDER_NOT_FOUND' });
        return;
      }

      const limit = Math.min(parseInt(String(req.query.limit || "50")) || 50, 100);
      const offset = parseInt(String(req.query.offset || "0")) || 0;

      // Merge signals + audit events into unified timeline
      const [auditEvents, recentTrades] = await Promise.all([
        (db as any).signalAuditEvent.findMany({
          where: { providerId: provider.id },
          orderBy: { detectedAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        db.trade.findMany({
          where: {
            providerId: provider.id,
            status: { in: ['HIT_TP', 'HIT_SL'] },
          },
          select: {
            id: true, symbol: true, direction: true, status: true,
            rMultiple: true, pnlPct: true, exitedAt: true,
            signal: {
              select: { originalHash: true },
            },
          },
          orderBy: { exitedAt: 'desc' },
          take: limit,
        }),
      ]);

      // Build unified timeline
      const timeline = [
        ...auditEvents.map((e: any) => ({
          type: e.eventType,              // EDIT | DELETE
          timestamp: e.detectedAt,
          signalId: e.signalId,
          data: e.eventData,
        })),
        ...recentTrades.map((t: any) => ({
          type: t.status,                 // HIT_TP | HIT_SL
          timestamp: t.exitedAt,
          symbol: t.symbol,
          direction: t.direction,
          rMultiple: t.rMultiple,
          pnlPct: t.pnlPct,
          hash: t.signal?.originalHash?.slice(0, 8),
        })),
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
       .slice(0, limit);

      res.json({ timeline });
    } catch (err) {
      log.error({ err }, 'marketplace timeline failed');
      res.status(500).json({ error: 'MARKETPLACE_TIMELINE_FAILED' });
    }
  });

  // ── GET /verify/:hash ─────────────────────────────────────
  router.get('/verify/:hash', async (req: Request, res: Response) => {
    try {
      const hash = req.params.hash;

      const signal = await db.signal.findFirst({
        where: { originalHash: String(hash) },
        include: {
          provider: true,
          trade: true,
        },
      }) as any;

      if (!signal) {
        res.json({ verified: false, hash });
        return;
      }

      res.json({
        verified: true,
        hash,
        details: {
          provider: signal.provider.name,
          providerSlug: signal.provider.slug,
          isVerified: signal.provider.isVerified,
          pair: signal.symbol,
          action: signal.action,
          timestamp: signal.signalTs,
          wasEdited: signal.wasEdited,
          wasDeleted: signal.wasDeleted,
          outcome: signal.trade?.status || 'ACTIVE',
          rMultiple: signal.trade?.rMultiple,
          pnlPct: signal.trade?.pnlPct,
          proofUrl: `https://agoraiq.net/proof/${signal.provider.slug}/timeline`,
        },
      });
    } catch (err) {
      log.error({ err }, 'hash verify failed');
      res.status(500).json({ error: 'VERIFY_FAILED' });
    }
  });

  // ── POST /import ──────────────────────────────────────────
  // JWT required — imports a provider into user's workspace
  router.post('/import', async (req: Request, res: Response) => {
    try {
      // Extract user from JWT (assumes auth middleware sets req.user)
      const user = (req as any).user;
      if (!user) {
        res.status(401).json({ error: 'AUTH_REQUIRED' });
        return;
      }

      const { providerId, acknowledged } = req.body;
      if (!providerId) {
        res.status(400).json({ error: 'PROVIDER_ID_REQUIRED' });
        return;
      }

      // Check provider exists and is visible
      const provider = await db.provider.findUnique({
        where: { id: providerId },
        select: { id: true, marketplaceVisible: true, isVerified: true, name: true },
      });
      if (!provider || !provider.marketplaceVisible) {
        res.status(404).json({ error: 'PROVIDER_NOT_FOUND' });
        return;
      }

      // Check tier limits
      const sub = await db.subscription.findUnique({
        where: { userId: user.id },
      });
      const tier = sub?.tier || 'starter';
      const maxImports = tier === 'elite' ? 999 : tier === 'pro' ? 20 : 3;

      const currentImports = await (db as any).workspaceProviderImport.count({
        where: { workspaceId: user.workspaceId, isActive: true },
      });

      if (currentImports >= maxImports) {
        res.status(403).json({
          error: 'IMPORT_LIMIT_REACHED',
          limit: maxImports,
          tier,
          current: currentImports,
        });
        return;
      }

      // Require acknowledgement for unverified providers
      if (!provider.isVerified && !acknowledged) {
        res.status(400).json({ error: 'ACKNOWLEDGEMENT_REQUIRED' });
        return;
      }

      // Upsert import
      const imported = await (db as any).workspaceProviderImport.upsert({
        where: {
          workspaceId_providerId: {
            workspaceId: user.workspaceId,
            providerId: provider.id,
          },
        },
        update: { isActive: true },
        create: {
          workspaceId: user.workspaceId,
          providerId: provider.id,
          userId: user.id,
          isActive: true,
        },
      });

      // Audit
      await db.auditLog.create({
        data: {
          action: 'marketplace.import',
          actorType: 'user',
          actorId: user.id,
          resourceType: 'provider',
          resourceId: provider.id,
          meta: { providerName: provider.name, tier },
        },
      });

      res.json({ imported: true, id: imported.id });
    } catch (err) {
      log.error({ err }, 'marketplace import failed');
      res.status(500).json({ error: 'IMPORT_FAILED' });
    }
  });

  // ── POST /submit — Suggest a provider (public, auth optional) ──
  router.post('/submit', async (req: Request, res: Response) => {
    try {
      const { channelName, channelUrl, channelType, email, description, marketType, tradingStyle, subscriberCount } = req.body;
      if (!channelName || !channelUrl) {
        res.status(400).json({ error: 'CHANNEL_NAME_AND_URL_REQUIRED' });
        return;
      }
      // Dedupe check
      const existing = await (db as any).providerSubmission.findFirst({
        where: { channelUrl, status: { in: ['PENDING', 'APPROVED'] } },
      });
      if (existing) {
        res.status(409).json({ error: 'ALREADY_SUBMITTED', id: existing.id });
        return;
      }
      const user = (req as any).user;
      const submission = await (db as any).providerSubmission.create({
        data: {
          channelName,
          channelUrl,
          channelType: channelType || 'telegram',
          submitterEmail: email || null,
          submitterUserId: user?.id || null,
          description: description || null,
          marketType: marketType || null,
          tradingStyle: tradingStyle || null,
          subscriberCount: subscriberCount ? parseInt(subscriberCount) : null,
        },
      });
      res.status(201).json({ submitted: true, id: submission.id });
    } catch (err) {
      log.error({ err }, 'submission failed');
      res.status(500).json({ error: 'SUBMISSION_FAILED' });
    }
  });

  // ── GET /submit/pending — Admin: list pending submissions ──
  router.get('/submit/pending', async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user) { res.status(401).json({ error: 'AUTH_REQUIRED' }); return; }
      const submissions = await (db as any).providerSubmission.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      res.json({ submissions });
    } catch (err) {
      log.error({ err }, 'list submissions failed');
      res.status(500).json({ error: 'LIST_FAILED' });
    }
  });

  // ── GET /tiers/summary — Public tier counts ──
  router.get('/tiers/summary', async (_req: Request, res: Response) => {
    try {
      const [verified, beta, pending] = await Promise.all([
        db.provider.count({ where: { marketplaceTier: 'VERIFIED', isActive: true } }),
        db.provider.count({ where: { marketplaceTier: 'BETA', isActive: true } }),
        (db as any).providerSubmission.count({ where: { status: 'PENDING' } }),
      ]);
      res.json({ verified, beta, pendingSubmissions: pending, total: verified + beta });
    } catch (err) {
      res.status(500).json({ error: 'TIER_SUMMARY_FAILED' });
    }
  });

  // ── GET /summary — Lightweight hero stats ──
  router.get('/summary', async (_req: Request, res: Response) => {
    try {
      const [verified, beta, pending] = await Promise.all([
        db.provider.count({ where: { marketplaceTier: 'VERIFIED', isActive: true, marketplaceVisible: true } }),
        db.provider.count({ where: { marketplaceTier: 'BETA', isActive: true, marketplaceVisible: true } }),
        db.provider.count({ where: { marketplaceTier: 'PENDING', isActive: true } }),
      ]);
      const [signals, tools, alerts] = await Promise.all([
        db.provider.count({ where: { providerType: 'SIGNAL', isActive: true, marketplaceVisible: true } }),
        db.provider.count({ where: { providerType: 'TOOL', isActive: true, marketplaceVisible: true } }),
        db.provider.count({ where: { providerType: 'ALERT', isActive: true, marketplaceVisible: true } }),
      ]);
      const trades30d = await db.$queryRawUnsafe(
        `SELECT COALESCE(SUM(trade_count),0)::int AS total FROM provider_stats_snapshot WHERE period = '30d'`
      ) as any[];
      const tradesAll = await db.$queryRawUnsafe(
        `SELECT COALESCE(SUM(trade_count),0)::int AS total FROM provider_stats_snapshot WHERE period = 'all'`
      ) as any[];
      res.json({
        total: verified + beta + pending,
        tracked: verified + beta,
        verified, beta, pending,
        signals, tools, alerts,
        totalResolvedTrades30d: trades30d[0]?.total || 0,
        totalResolvedTradesAllTime: tradesAll[0]?.total || 0,
      });
    } catch (err) {
      log.error({ err }, 'summary failed');
      res.status(500).json({ error: 'SUMMARY_FAILED' });
    }
  });

  return router;
}

// ── Helpers ─────────────────────────────────────────────────

function cherryLabel(score: number | null | undefined): string {
  if (score == null) return 'Unknown';
  if (score < 0.15) return 'Clean';
  if (score < 0.35) return 'Caution';
  if (score < 0.55) return 'Suspect';
  return 'High Risk';
}
