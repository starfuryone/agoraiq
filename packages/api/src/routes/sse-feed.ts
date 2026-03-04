import { Router, Request, Response } from 'express';
import express from 'express';
import { EventEmitter } from 'events';
import { createLogger } from '@agoraiq/db';

const log = createLogger('sse-feed');
const MAX_CONNECTIONS = parseInt(process.env.SSE_MAX_CONNECTIONS || '200', 10);
const PUBLIC_THROTTLE_MS = 10_000;
const DEDUP_WINDOW_MS = 60_000;

export const signalBus = new EventEmitter();
signalBus.setMaxListeners(MAX_CONNECTIONS + 50);

let activeConnections = 0;
const publicThrottle = new Map<string, number>();
const dedupeCache = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of publicThrottle) {
    if (v < now - 120_000) publicThrottle.delete(k);
  }
  for (const [k, v] of dedupeCache) {
    if (v < now - DEDUP_WINDOW_MS) dedupeCache.delete(k);
  }
}, 300_000);

export function createSSEFeedRoutes(): Router {
  const router = Router();

  router.get('/live', (req: Request, res: Response) => {
    if (activeConnections >= MAX_CONNECTIONS) {
      res.status(503).json({ error: 'Too many connections', retryAfter: 30 });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: connected\ndata: {"status":"connected"}\n\n`);
    activeConnections++;
    const heartbeat = setInterval(() => {
      try { res.write(`: heartbeat\n\n`); } catch {}
    }, 30_000);

    const onEvent = (event: any) => {
      if (!['SIGNAL', 'HIT_TP', 'HIT_SL'].includes(event.type)) return;
      if (!event.isVerified) return;
      const dedupKey = `${event.providerId}:${event.pair}:${event.type}`;
      const now = Date.now();
      if (dedupeCache.has(dedupKey) && now - dedupeCache.get(dedupKey)! < DEDUP_WINDOW_MS) return;
      dedupeCache.set(dedupKey, now);
      const lastEmit = publicThrottle.get(event.providerId) || 0;
      if (now - lastEmit < PUBLIC_THROTTLE_MS) return;
      publicThrottle.set(event.providerId, now);
      try {
        const payload = {
          type: event.type, provider: event.providerName,
          slug: event.providerSlug, pair: event.pair,
          action: event.action, entry: event.entry,
          rMultiple: event.rMultiple, hash: event.hash,
          ts: event.timestamp,
        };
        res.write(`event: signal\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {}
    };

    signalBus.on('signal', onEvent);
    req.on('close', () => {
      activeConnections--;
      clearInterval(heartbeat);
      signalBus.off('signal', onEvent);
    });
  });

  router.get('/stats', (_req: Request, res: Response) => {
    res.json({ activeConnections, maxConnections: MAX_CONNECTIONS,
      throttleEntries: publicThrottle.size, dedupEntries: dedupeCache.size });
  });

  router.post('/emit', express.json(), (req: Request, res: Response) => {
    const { secret, ...event } = req.body;
    if (secret !== process.env.JWT_SECRET) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    signalBus.emit('signal', { ...event, timestamp: event.timestamp || new Date().toISOString() });
    res.json({ ok: true });
  });

  return router;
}
