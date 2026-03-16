// ─────────────────────────────────────────────────────────────
// packages/api/src/routes/notifications.ts
// WebPush subscription management + VAPID public key endpoint.
// SSE lives in alerts-sse.ts — this module handles only push sub CRUD.
//
// Mount: app.use('/api/v1/notifications', authenticate, notificationsRouter)
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';

const router = Router();

// ── GET /vapid-public-key ─────────────────────────────────────

router.get('/vapid-public-key', (_req: Request, res: Response) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'WebPush not configured' });
  res.json({ publicKey: key });
});

// ── POST /subscribe (WebPush) ─────────────────────────────────

router.post('/subscribe', async (req: Request, res: Response) => {
  const prisma = (req.app.locals as any).prisma;
  const userId = (req as any).user.userId;
  const { endpoint, keys, userAgent } = req.body;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'endpoint + keys.p256dh + keys.auth required' });
  }

  await prisma.pushSubscription.upsert({
    where:  { endpoint },
    update: { p256dh: keys.p256dh, auth: keys.auth, userId, active: true, userAgent: userAgent ?? null },
    create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, userId, active: true, userAgent: userAgent ?? null },
  });

  res.json({ subscribed: true });
});

// ── DELETE /subscribe (WebPush) ───────────────────────────────

router.delete('/subscribe', async (req: Request, res: Response) => {
  const prisma = (req.app.locals as any).prisma;
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });

  await prisma.pushSubscription.updateMany({
    where: { endpoint },
    data:  { active: false },
  });
  res.json({ unsubscribed: true });
});

export default router;
