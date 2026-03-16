// ============================================================
// AgoraIQ Market Intel — App Integration
// integration/wireMarketIntel.ts
//
// Drop-in integration example for your existing Express app.
// ============================================================

// ── Example: your existing app entry point (app.ts / server.ts)
// ──────────────────────────────────────────────────────────────
//
// BEFORE (existing):
//   import express from 'express';
//   const app = express();
//   app.use('/api/providers', providerRoutes);
//   app.listen(3000);
//
// AFTER (add these lines):

import type { Express } from 'express';

export function integrateMarketIntel(app: Express): void {
  // 1. Mount API routes
  //    ─────────────────────────────────────────────────────────
  //    INTEGRATION: Change the import path to match your repo layout.
  //    e.g. from '../../packages/api/src/modules/market-intel/routes/marketIntelRoutes'
  const { marketIntelRouter } = require('./routes/marketIntelRoutes');
  app.use('/api/market-intel', marketIntelRouter);
  console.info('[market-intel] Routes mounted at /api/market-intel');

  // 2. Start scheduler
  //    ─────────────────────────────────────────────────────────
  const { startMarketIntelScheduler } = require('./scheduler/marketIntelScheduler');
  startMarketIntelScheduler();
  console.info('[market-intel] Scheduler started');

  // 3. Serve UI pages
  //    ─────────────────────────────────────────────────────────
  //    If using static HTML (like the rest of AgoraIQ dashboard):
  //    Copy ui/market-intel.html        → /opt/agoraiq/packages/web/public/market-intel.html
  //    Copy ui/market-intel-detail.html → /opt/agoraiq/packages/web/public/market-intel-detail.html
  //
  //    For the detail page to work with dynamic symbols, add a route:
  const path = require('path');
  const publicDir = process.env.PUBLIC_DIR ?? '/opt/agoraiq/packages/web/public';

  app.get('/market-intel', (_req, res) => {
    res.sendFile(path.join(publicDir, 'market-intel.html'));
  });

  app.get('/market-intel/:symbol', (_req, res) => {
    res.sendFile(path.join(publicDir, 'market-intel-detail.html'));
  });

  console.info('[market-intel] UI routes mounted at /market-intel');
}

// ============================================================
// INTEGRATION CHECKLIST
// ============================================================
//
// Step 1: Install dependencies
//   pnpm add node-cron @types/node-cron
//   (fetch is built-in Node 18+; no node-fetch needed)
//
// Step 2: Run DB migration
//   Option A — Prisma:
//     1. Append contents of db/schema_additions.prisma to prisma/schema.prisma
//     2. pnpm prisma migrate dev --name add_market_intel_tables
//     3. pnpm prisma generate
//   Option B — Raw SQL:
//     psql $DATABASE_URL < market-intel/db/migration.sql
//
// Step 3: Copy module to your repo
//   cp -r market-intel/  /opt/agoraiq/packages/api/src/modules/market-intel/
//
// Step 4: Update Prisma client import in db/marketIntelRepository.ts
//   Change: import { PrismaClient } from '@prisma/client';
//   To:     import { prisma } from '../../lib/prisma.js';   // or wherever yours is
//
// Step 5: Update auth middleware in middleware/marketIntelEntitlement.ts
//   Replace requireAuth() with your existing JWT/session guard.
//   The plan-check logic (MARKET_INTEL_PLANS set) is self-contained.
//
// Step 6: Copy UI pages
//   cp market-intel/ui/market-intel.html        /opt/agoraiq/packages/web/public/
//   cp market-intel/ui/market-intel-detail.html /opt/agoraiq/packages/web/public/
//
// Step 7: Add env vars to your .env
//   cat market-intel/.env.example >> .env
//   # Fill in values
//
// Step 8: Wire into your Express app
//   import { integrateMarketIntel } from './modules/market-intel/integration/wireMarketIntel';
//   integrateMarketIntel(app);
//
// Step 9: Restart PM2
//   pm2 restart agoraiq-api --update-env
//
// Step 10: Test
//   See README.md test plan section.
//
// ============================================================
// EXISTING SYSTEM COMPATIBILITY
// ============================================================
//
// ✅ Does NOT modify existing routes
// ✅ Uses your existing DATABASE_URL / Prisma setup
// ✅ Uses your existing logger pattern (console.info/warn/error)
// ✅ Scheduler uses node-cron (same as existing cron jobs if applicable)
// ✅ All new DB tables are prefixed with market_intel_ (no conflicts)
// ✅ Idempotency: DB upsert for snapshots; in-memory dedup for arbi alerts
// ✅ Locking: per-engine mutex prevents overlapping cron ticks
