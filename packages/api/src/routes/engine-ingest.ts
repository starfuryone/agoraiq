/**
 * Engine Signal Ingestion Route
 *
 * POST /api/v1/engine/ingest
 * GET  /api/v1/engine/health
 *
 * Creates Signal + Trade records from the engine's payload.
 * Maps engine field names (stopLoss, takeProfit1) to Prisma
 * field names (slPrice, tp1Price).
 *
 * DROP INTO: /opt/agoraiq/packages/api/src/routes/engine-ingest.ts
 */

import { Router, Request, Response } from 'express';

export function createEngineIngestRoutes(db: any) {
  const router = Router();

  // ── Auth ─────────────────────────────────────────────────────────────────
  function requireToken(req: Request, res: Response, next: Function) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Bearer token' });
    }
    const expected = process.env.ENGINE_INGEST_TOKEN;
    if (!expected) {
      return res.status(500).json({ error: 'ENGINE_INGEST_TOKEN not set' });
    }
    if (auth.slice(7) !== expected) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    next();
  }

  // ── POST /ingest ─────────────────────────────────────────────────────────
  router.post('/ingest', requireToken, async (req: Request, res: Response) => {
    try {
      const b = req.body;

      if (!b.action || !b.symbol || !b.price || !b.stopLoss || !b.takeProfit1) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const engineSignalId = b.meta?.signalId || `eng-${Date.now()}`;

      // Find provider
      const provider = await db.provider.findFirst({
        where: { slug: 'agoraiq-engine' },
      });
      if (!provider) {
        return res.status(404).json({ error: 'Provider agoraiq-engine not found' });
      }

      // Workspace
      const workspaceId = provider.workspaceId
        || process.env.DEFAULT_WORKSPACE_ID
        || process.env.PROOF_WORKSPACE_ID;
      if (!workspaceId) {
        return res.status(500).json({ error: 'No workspace ID available' });
      }

      // Dedup by checking X-Signal-Id header or meta.signalId
      const signalIdHeader = req.headers['x-signal-id'] as string;
      const dedupId = signalIdHeader || engineSignalId;

      try {
        const existing = await db.signal.findFirst({
          where: { providerKey: 'agoraiq-engine', externalId: dedupId },
        });
        if (existing) {
          return res.status(409).json({ error: 'Already ingested', signalId: existing.id });
        }
      } catch {
        // externalId field may not exist — skip dedup
      }

      const direction = b.action === 'BUY' ? 'LONG' : 'SHORT';
      const expiryHours: Record<string, number> = { '15m': 1, '1h': 4, '4h': 16, '1d': 72 };
      const expiresAt = new Date(Date.now() + (expiryHours[b.timeframe] || 4) * 3600_000);

      // Build signal data — include fields that exist, skip those that don't
      const signalData: Record<string, any> = {
        workspaceId,
        providerId: provider.id,
        providerKey: 'agoraiq-engine',
        symbol: b.symbol,
        action: b.action,
        score: typeof b.score === 'number' ? b.score : parseFloat(b.score) || 0,
        confidence: b.confidence || 'MEDIUM',
        signalTs: new Date(b.signalTs || Date.now()),
        price: typeof b.price === 'number' ? b.price : parseFloat(b.price) || 0,
        meta: b.meta || {},
      };

      // Optional Signal fields — add if they exist in schema
      if (b.timeframe) signalData.timeframe = b.timeframe;
      signalData.externalId = dedupId;
      if (b.rawPayload) signalData.rawPayload = b.rawPayload;

      // Build trade data
      const tradeData: Record<string, any> = {
        workspaceId,
        providerId: provider.id,
        symbol: b.symbol,
        direction,
        exchange: 'BINANCE_FUTURES',
        entryPrice: b.price,
        slPrice: b.stopLoss,
        tpPrice: b.takeProfit1,
        tp1Price: b.takeProfit1,
        tp2Price: b.takeProfit2 || null,
        tp3Price: null,
        status: 'ACTIVE',
        confirmedAt: new Date(),
        entryFilledAt: new Date(),
        entryFilledPrice: b.price,
        expiresAt,
        notes: [
          b.meta?.strategyType,
          b.meta?.regime,
          b.confidence,
          `R=${b.meta?.expectedR ?? '?'}`,
        ].filter(Boolean).join(' | '),
      };

      if (b.timeframe) tradeData.timeframe = b.timeframe;

      const result = await db.$transaction(async (tx: any) => {
        const signal = await tx.signal.create({ data: signalData });
        const trade = await tx.trade.create({
          data: { ...tradeData, signalId: signal.id },
        });
        return { signal, trade };
      });

      console.log(
        `[engine] ${b.symbol} ${b.action} ${b.meta?.strategyType || '?'} ` +
        `score=${b.score} → s=${result.signal.id} t=${result.trade.id}`
      );

      return res.status(201).json({
        ok: true,
        signalId: result.signal.id,
        tradeId: result.trade.id,
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'Duplicate' });
      }
      console.error('[engine-ingest]', err.message || err);
      return res.status(500).json({ error: err.message || 'Internal error' });
    }
  });

  // ── Health ───────────────────────────────────────────────────────────────
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  return router;
}
