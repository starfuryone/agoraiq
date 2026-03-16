// packages/db/src/alerts/webpush-adapter.ts
// ─────────────────────────────────────────────────────────────────────────────
// WebPush delivery adapter using the web-push npm package.
// Requires VAPID keys in environment.
//
// Generate keys once:
//   npx web-push generate-vapid-keys
// Add to /etc/agoraiq.env:
//   VAPID_PUBLIC_KEY=...
//   VAPID_PRIVATE_KEY=...
//   VAPID_SUBJECT=mailto:admin@agoraiq.net
// ─────────────────────────────────────────────────────────────────────────────

import webpush from 'web-push';
import { PrismaClient } from '@prisma/client';

export function initWebPush(): void {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[webpush] VAPID keys not configured — WebPush disabled');
    return;
  }
  webpush.setVapidDetails(
    VAPID_SUBJECT ?? 'mailto:admin@agoraiq.net',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
}

export function createWebPushAdapter(db: PrismaClient) {
  return async (userId: string, payload: object): Promise<void> => {
    const subs = await db.pushSubscription.findMany({
      where: { userId, active: true },
    });
    if (subs.length === 0) return;

    const data = JSON.stringify(payload);

    await Promise.allSettled(
      subs.map(async (sub: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            data,
          );
          await db.pushSubscription.update({
            where: { id: sub.id },
            data:  { lastUsedAt: new Date() },
          });
        } catch (err: any) {
          // 410 Gone = subscription expired/unsubscribed
          if (err.statusCode === 410) {
            await db.pushSubscription.update({
              where: { id: sub.id },
              data:  { active: false },
            });
          }
        }
      })
    );
  };
}
