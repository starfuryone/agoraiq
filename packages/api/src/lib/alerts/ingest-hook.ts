// ─────────────────────────────────────────────────────────────
// packages/api/src/lib/alerts/ingest-hook.ts
// Signal pipeline hook — publishes events to the bus
//
// After a signal is saved + scored, add ONE line:
//   import { dispatchAlerts } from '../lib/alerts/ingest-hook';
//   void dispatchAlerts(req.app, savedSignal);   // fire-and-forget
//
// The event bus worker handles evaluation + delivery asynchronously.
// ─────────────────────────────────────────────────────────────

import { Express }      from 'express';
import { PrismaClient } from '@agoraiq/db';
import { publishSignalEvent } from './producers';

export async function dispatchAlerts(
  app: Express,
  signal: {
    id:          string;
    pair:        string;
    direction:   string;
    providerId:  string;
    confidence?: number | null;
    leverage?:   number | null;
    rRatio?:     number | null;
    createdAt:   Date;
    provider?:   { name?: string } | null;
  },
): Promise<void> {
  try {
    const prisma = app.locals.prisma as PrismaClient;

    // Fetch IQ grade data if available
    const grades = await prisma.$queryRaw<any[]>`
      SELECT iq_score, truth_pass_rate, cherry_pick_risk, min_r
      FROM signal_grades
      WHERE signal_id = ${signal.id}
      LIMIT 1
    `.catch(() => []);

    const g = grades[0] ?? {};

    // Publish to event bus — worker handles evaluation + delivery
    await publishSignalEvent(signal, g);
  } catch (err) {
    // Alerts must never break signal ingestion
    console.error('[alert-hook] publish error:', err);
  }
}
