import { Router, Request, Response } from 'express';
import { PrismaClient } from '@agoraiq/db';
import { z } from 'zod';
import { createLogger } from '@agoraiq/db';
import { requireBotAuth, requireWorkerAuth } from '../middleware/bot-auth';
import { requireAuth } from '../middleware/auth';
import { createLinkCode, confirmLinkCode, unlinkAccount } from '../services/telegram-linking';
import { generateInvite, revokeTelegramInviteLink } from '../services/telegram-invite';
import { getUserTier, tierSatisfies } from '../services/telegram-entitlement';

const log = createLogger('telegram-routes');
const WEB_BASE_URL = process.env.WEB_BASE_URL || 'https://app.agoraiq.net';

const linkStartSchema = z.object({ telegramId: z.string().min(1), chatId: z.string().min(1), username: z.string().optional() });
const linkConfirmSchema = z.object({ code: z.string().length(8), chatId: z.string().min(1), username: z.string().optional() });
const inviteSchema = z.object({ telegramId: z.string().min(1), userId: z.string().min(1), sourceId: z.string().min(1) });
const prefsSchema = z.object({ telegramId: z.string().min(1), digestEnabled: z.boolean().optional(), muteAll: z.boolean().optional() });

export function createTelegramRoutes(db: PrismaClient): Router {
  const router = Router();
  router.use(requireBotAuth);

  router.post('/link/start', async (req: Request, res: Response) => {
    try {
      const body = linkStartSchema.parse(req.body);
      const result = await createLinkCode(db, body.telegramId);
      if ('error' in result) { res.status(result.error === 'RATE_LIMITED' ? 429 : result.error === 'ALREADY_LINKED' ? 409 : 400).json(result); return; }
      res.json({ code: result.code, linkUrl: `${WEB_BASE_URL}/link-telegram?code=${result.code}`, expiresAt: result.expiresAt.toISOString() });
    } catch (err) {
      if (err instanceof z.ZodError) { res.status(400).json({ error: 'VALIDATION_ERROR', details: err.errors }); return; }
      log.error({ err }, 'Link start failed'); res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  router.post('/link/confirm', requireAuth, async (req: Request, res: Response) => {
    try {
      const body = linkConfirmSchema.parse(req.body);
      const result = await confirmLinkCode(db, body.code, req.user!.userId, body.chatId, body.username);
      if ('error' in result) { res.status(result.error === 'CODE_EXPIRED' ? 410 : 409).json(result); return; }
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) { res.status(400).json({ error: 'VALIDATION_ERROR', details: err.errors }); return; }
      log.error({ err }, 'Link confirm failed'); res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  router.get('/me', async (req: Request, res: Response) => {
    try {
      const telegramId = String(req.query.telegramId || '');
      if (!telegramId) { res.status(400).json({ error: 'VALIDATION_ERROR', message: 'telegramId required' }); return; }
      const tgUser = await db.telegramUser.findUnique({ where: { telegramId }, include: { user: { include: { subscription: true } } } });
      if (!tgUser) { res.json({ linked: false }); return; }
      await db.telegramUser.update({ where: { telegramId }, data: { updatedAt: new Date() } });
      const sub = tgUser.user.subscription;
      res.json({ linked: true, userId: tgUser.userId, tier: sub?.tier || sub?.planTier || 'FREE', subscriptionStatus: sub?.status || sub?.subscriptionStatus || 'inactive', expiresAt: sub?.endsAt || sub?.currentPeriodEnd || null, preferences: { digestEnabled: tgUser.digestEnabled, muteAll: tgUser.muteAll } });
    } catch (err) { log.error({ err }, 'Get /me failed'); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
  });

  router.get('/sources', async (req: Request, res: Response) => {
    try {
      const category = req.query.category as string | undefined;
      const userId = req.query.userId as string | undefined;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(20, parseInt(req.query.limit as string, 10) || 10);
      const where: any = { status: 'active' };
      if (category) where.category = category;
      const [sources, total] = await Promise.all([
        db.telegramSource.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], skip: (page - 1) * limit, take: limit }),
        db.telegramSource.count({ where }),
      ]);
      let userTier = 'FREE';
      if (userId) userTier = await getUserTier(db, userId);
      res.json({ sources: sources.map(s => ({ id: s.id, name: s.name, category: s.category, tierMin: s.tierMin, description: s.description, memberCount: s.memberCount, locked: !tierSatisfies(userTier, s.tierMin) })), total, page, pages: Math.ceil(total / limit) });
    } catch (err) { log.error({ err }, 'Get /sources failed'); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
  });

  router.post('/invite', async (req: Request, res: Response) => {
    try {
      const body = inviteSchema.parse(req.body);
      const result = await generateInvite(db, body.userId, body.telegramId, body.sourceId);
      if ('error' in result) { res.status(result.error === 'RATE_LIMITED' ? 429 : result.error === 'SOURCE_LOCKED' ? 403 : 400).json(result); return; }
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) { res.status(400).json({ error: 'VALIDATION_ERROR', details: err.errors }); return; }
      log.error({ err }, 'Invite failed'); res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  router.get('/signals/latest', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;
      const limit = Math.min(10, parseInt(req.query.limit as string, 10) || 5);
      const where: any = {};
      if (userId) { const u = await db.user.findUnique({ where: { id: userId } }); if (u) where.workspaceId = u.workspaceId; }
      const signals = await db.signal.findMany({ where, orderBy: { signalTs: 'desc' }, take: limit, select: { id: true, symbol: true, action: true, score: true, confidence: true, signalTs: true, providerKey: true, price: true, trade: { select: { status: true, direction: true, pnlPct: true, entryPrice: true, tpPrice: true, slPrice: true, tp1Price: true, tp2Price: true, tp3Price: true, tpHitCount: true } } } });
      res.json({ signals });
    } catch (err) { log.error({ err }, 'Get signals failed'); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
  });

  router.get('/signals/:id/card', async (req: Request, res: Response) => {
    try {
      const signal: any = await db.signal.findUnique({ where: { id: String(req.params.id) }, include: { trade: true, provider: { select: { name: true, slug: true } } } });
      if (!signal) { res.status(404).json({ error: 'SIGNAL_NOT_FOUND' }); return; }
      res.json({ id: signal.id, symbol: signal.symbol, action: signal.action, score: signal.score, confidence: signal.confidence, price: signal.price, signalTs: signal.signalTs, provider: signal.provider, trade: signal.trade, proofUrl: `${WEB_BASE_URL}/proof/${signal.id}`, analyticsUrl: `${WEB_BASE_URL}/dashboard/signals/${signal.id}` });
    } catch (err) { log.error({ err }, 'Get signal card failed'); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
  });

  router.get('/providers/:id/summary', async (req: Request, res: Response) => {
    try {
      const find = async (where: any) => (db.provider as any).findUnique({ where, include: { monthlyStats: { orderBy: { month: 'desc' }, take: 6 }, statsSnapshots: { orderBy: { createdAt: 'desc' }, take: 1 } } });
      let provider = await find({ id: req.params.id }) || await find({ slug: req.params.id });
      if (!provider) { res.status(404).json({ error: 'PROVIDER_NOT_FOUND' }); return; }
      res.json({ id: provider.id, slug: provider.slug, name: provider.name, description: provider.description, marketType: provider.marketType, tradingStyle: provider.tradingStyle, isVerified: provider.isVerified, trackedSince: provider.trackedSince, stats: provider.statsSnapshots?.[0] || null, monthlyBreakdown: provider.monthlyStats || [] });
    } catch (err) { log.error({ err }, 'Get provider failed'); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
  });

  router.post('/prefs', async (req: Request, res: Response) => {
    try {
      const body = prefsSchema.parse(req.body);
      const tgUser = await db.telegramUser.findUnique({ where: { telegramId: body.telegramId } });
      if (!tgUser) { res.status(404).json({ error: 'NOT_LINKED' }); return; }
      const update: any = {};
      if (body.digestEnabled !== undefined) update.digestEnabled = body.digestEnabled;
      if (body.muteAll !== undefined) update.muteAll = body.muteAll;
      await db.telegramUser.update({ where: { telegramId: body.telegramId }, data: update });
      res.json({ updated: true });
    } catch (err) {
      if (err instanceof z.ZodError) { res.status(400).json({ error: 'VALIDATION_ERROR', details: err.errors }); return; }
      log.error({ err }, 'Prefs failed'); res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  router.post('/unlink', async (req: Request, res: Response) => {
    try {
      const { telegramId } = req.body;
      if (!telegramId) { res.status(400).json({ error: 'VALIDATION_ERROR' }); return; }
      const result = await unlinkAccount(db, telegramId);
      if ('error' in result) { res.status(404).json(result); return; }
      res.json(result);
    } catch (err) { log.error({ err }, 'Unlink failed'); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
  });

  return router;
}

export function createTelegramWorkerRoutes(db: PrismaClient): Router {
  const router = Router();
  router.use(requireWorkerAuth);

  router.post('/reconcile', async (req: Request, res: Response) => {
    try {
      const { userId } = req.body;
      if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
      const tgUser = await db.telegramUser.findUnique({ where: { userId }, include: { user: { include: { subscription: true } } } });
      if (!tgUser) { res.json({ actions: [] }); return; }
      const userTier = tgUser.user.subscription?.tier || tgUser.user.subscription?.planTier || 'FREE';
      const actions: string[] = [];
      const memberships = await db.telegramMembership.findMany({ where: { userId, status: 'active' }, include: { source: true } });
      for (const m of memberships) {
        if (!tierSatisfies(userTier, m.source.tierMin)) {
          await db.telegramMembership.update({ where: { id: m.id }, data: { status: 'removed', removedAt: new Date(), removalReason: 'entitlement_expired' } });
          await db.telegramAuditLog.create({ data: { action: 'membership_removed', telegramId: tgUser.telegramId, userId, sourceId: m.sourceId, metadata: { reason: 'entitlement_expired' } } });
          actions.push(`Removed from ${m.source.name}`);
        }
      }
      res.json({ actions });
    } catch (err) { log.error({ err }, 'Reconcile failed'); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
  });

  router.post('/revokeExpired', async (req: Request, res: Response) => {
    try {
      const expired = await db.telegramInvite.findMany({ where: { expiresAt: { lt: new Date() }, revokedAt: null, usedAt: null }, include: { source: true } });
      let revokedCount = 0;
      for (const inv of expired) {
        if (await revokeTelegramInviteLink(inv.source.telegramChatId, inv.inviteLink)) {
          await db.telegramInvite.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
          revokedCount++;
        }
      }
      res.json({ revokedCount, total: expired.length });
    } catch (err) { log.error({ err }, 'Revoke expired failed'); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
  });

  router.post('/resyncMemberships', async (req: Request, res: Response) => {
    try {
      const memberships = await db.telegramMembership.findMany({ where: { status: 'active' }, include: { user: { include: { subscription: true } }, source: true } });
      let synced = 0, removed = 0; const errors: string[] = [];
      for (const m of memberships) {
        try {
          const tgUser = await db.telegramUser.findUnique({ where: { userId: m.userId } });
          if (!tgUser) { await db.telegramMembership.update({ where: { id: m.id }, data: { status: 'removed', removedAt: new Date(), removalReason: 'user_unlinked' } }); removed++; continue; }
          const userTier = m.user.subscription?.tier || m.user.subscription?.planTier || 'FREE';
          if (!tierSatisfies(userTier, m.source.tierMin)) {
            await db.telegramMembership.update({ where: { id: m.id }, data: { status: 'removed', removedAt: new Date(), removalReason: 'entitlement_expired' } });
            await db.telegramAuditLog.create({ data: { action: 'membership_removed', telegramId: tgUser.telegramId, userId: m.userId, sourceId: m.sourceId, metadata: { reason: 'nightly_reconcile' } } });
            removed++;
          } else { synced++; }
        } catch (err) { errors.push(`${m.id}: ${(err as Error).message}`); }
      }
      log.info({ synced, removed, errors: errors.length }, 'Nightly resync complete');
      res.json({ synced, removed, errors });
    } catch (err) { log.error({ err }, 'Resync failed'); res.status(500).json({ error: 'INTERNAL_ERROR' }); }
  });

  return router;
}
