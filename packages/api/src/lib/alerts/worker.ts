// ─────────────────────────────────────────────────────────────
// packages/api/src/lib/alerts/worker.ts
// Alert Engine Worker — boots the event bus consumer
//
// Can run as:
//   1. In-process: call startAlertWorker(prisma, redis) from your API index.ts
//   2. Standalone:  node dist/lib/alerts/worker.js  (via PM2 as separate process)
//
// Architecture:
//   BullMQ Queue ← [events from all producers]
//     ↓
//   This worker (N concurrent)
//     ↓
//   AlertDispatcher.processEvent()
//     ↓
//   Evaluate rules → Dedup → Score → Deliver
// ─────────────────────────────────────────────────────────────

import { PrismaClient } from '@agoraiq/db';
import { Redis }        from 'ioredis';
import type { Worker }  from 'bullmq';
import { createAlertWorker, shutdownEventBus, getRedis } from '@agoraiq/db';
import { AlertDispatcher, type AlertDeliveryAdapters }     from '@agoraiq/db';
import { createWebPushAdapter, initWebPush }               from '@agoraiq/db';
import { pushAlertToUser }                                  from '../../routes/alerts-sse';

let _worker: Worker | null = null;

export function startAlertWorker(
  prisma:   PrismaClient,
  redis?:   Redis,
  adapters?: Partial<AlertDeliveryAdapters>,
): Worker {
  if (_worker) return _worker;

  const redisConn = redis ?? getRedis();

  // Build delivery adapters
  const deliveryAdapters = buildAdapters(prisma, adapters);

  // Create dispatcher
  const dispatcher = new AlertDispatcher(prisma, redisConn, deliveryAdapters);

  // Start BullMQ worker
  _worker = createAlertWorker(
    async (event) => {
      const results = await dispatcher.processEvent(event);

      // Log summary
      const fired    = results.filter(r => r.status === 'FIRED').length;
      const blocked  = results.filter(r => r.status === 'BLOCKED').length;
      const throttled = results.filter(r => r.status === 'THROTTLED' || r.status === 'DEDUPED').length;

      if (fired > 0 || blocked > 0) {
        console.log(
          `[alert-engine] ${event.category} ${event.asset}: ` +
          `${fired} fired, ${blocked} blocked, ${throttled} throttled ` +
          `(${results.length} rules evaluated)`,
        );
      }
    },
    { concurrency: 5 },
  );

  console.log('[alert-engine] Worker started (concurrency=5)');
  return _worker;
}

export async function stopAlertWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
  await shutdownEventBus();
  console.log('[alert-engine] Worker stopped');
}

// ── Build delivery adapters ───────────────────────────────────

function buildAdapters(
  prisma: PrismaClient,
  overrides?: Partial<AlertDeliveryAdapters>,
): AlertDeliveryAdapters {
  const adapters: AlertDeliveryAdapters = {};

  // Web (SSE push — always available)
  adapters.web = async (userId: string, payload: object) => {
    pushAlertToUser(userId, payload);
  };

  // Telegram
  try {
    const { sendTelegramToUser } = require('../telegram/notify');
    adapters.telegram = sendTelegramToUser;
  } catch {
    // Fallback: direct bot API
    adapters.telegram = async (userId: string, message: string) => {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) return;
      const links = await prisma.telegramLink.findMany({ where: { userId } });
      for (const link of links) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ chat_id: link.chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true }),
        }).catch(console.error);
      }
    };
  }

  // Email
  try {
    const { sendTransactionalEmail } = require('../email/brevo');
    adapters.email = sendTransactionalEmail;
  } catch {
    adapters.email = async (userId: string, subject: string, html: string) => {
      const apiKey = process.env.BREVO_API_KEY;
      if (!apiKey) return;
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!user?.email) return;
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body:    JSON.stringify({
          sender:  { name: 'AgoraIQ Alerts', email: 'alerts@agoraiq.net' },
          to:      [{ email: user.email }],
          subject,
          htmlContent: html,
        }),
      }).catch(console.error);
    };
  }

  // Discord
  adapters.discord = async (webhookUrl: string, embed: object) => {
    await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(embed),
    });
  };

  // WebPush
  initWebPush();
  adapters.webpush = createWebPushAdapter(prisma);

  // Apply overrides
  return { ...adapters, ...overrides };
}

// ── Standalone mode ───────────────────────────────────────────
// Run with: node dist/lib/alerts/worker.js

if (require.main === module) {
  const prisma = new PrismaClient();

  startAlertWorker(prisma);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[alert-engine] Shutting down…');
    await stopAlertWorker();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
