// ─────────────────────────────────────────────────────────────
// packages/api/src/routes/alerts-sse.ts
// Server-Sent Events — powers the notification bell.
// Push-based: dispatcher calls pushAlertToUser() directly.
//
// Mount:
//   import alertSseRouter, { pushAlertToUser } from './routes/alerts-sse';
//   app.use('/api/v1/alerts', authenticate, alertSseRouter);
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';

const router = Router();

// In-memory SSE registry: userId → Set<Response>
const connections = new Map<string, Set<Response>>();

// ── GET /stream — register SSE connection ─────────────────────

router.get('/stream', (req: Request, res: Response) => {
  const uid = (req as any).user?.userId as string;
  if (!uid) { res.status(401).end(); return; }

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Register
  if (!connections.has(uid)) connections.set(uid, new Set());
  connections.get(uid)!.add(res);

  // Heartbeat every 25s to keep alive through proxies/Caddy
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    connections.get(uid)?.delete(res);
    if (connections.get(uid)?.size === 0) connections.delete(uid);
  });
});

// ── Push a notification to a user (called from dispatcher) ────

export function pushAlertToUser(userId: string, payload: object): void {
  const sinks = connections.get(userId);
  if (!sinks || sinks.size === 0) return;

  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sinks) {
    try { res.write(data); } catch { sinks.delete(res); }
  }
}

// ── GET /unread-count — for bell badge on page load ───────────

router.get('/unread-count', async (req: Request, res: Response) => {
  const prisma = (req.app.locals as any).prisma;
  const uid    = (req as any).user?.userId as string;

  const count = await prisma.alertEvent.count({
    where: {
      userId:         uid,
      status:         'FIRED',
      acknowledgedAt: null,
      firedAt:        { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });

  res.json({ count });
});

// ── Debug: active connection count ────────────────────────────

export function getConnectionCount(): number {
  let total = 0;
  for (const set of connections.values()) total += set.size;
  return total;
}

export default router;
