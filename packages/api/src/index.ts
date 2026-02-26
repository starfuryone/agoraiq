// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Express Server Entry Point
//
// Routes:
//   /api/v1/health              — Health check (public)
//   /api/v1/auth/*              — Auth routes (public)
//   /api/v1/proof/*             — Public proof endpoints (rate-limited)
//   /api/v1/providers/*         — Provider webhook ingestion (token-auth)
//   /api/v1/dashboard/*         — Paid dashboard endpoints (JWT + subscription)
// ═══════════════════════════════════════════════════════════════

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { db, createLogger } from '@agoraiq/db';

import { createHealthRoutes } from './routes/health';
import { createAuthRoutes } from './routes/auth';
import { createProofRoutes } from './routes/proof';
import { createIngestionRoutes } from './routes/ingestion';
import { createDashboardRoutes } from './routes/dashboard';
import { createBillingRoutes } from './routes/billing';
import { createSignalPublishRoutes } from './routes/signal-publish';
import { createParserRoutes } from './routes/parser';

const log = createLogger('server');

const PORT = parseInt(process.env.API_PORT || '4000', 10);
const HOST = process.env.API_HOST || '0.0.0.0';
const PROOF_WORKSPACE_ID = process.env.PROOF_WORKSPACE_ID || 'proof-workspace-default';

const app: express.Express = express();

// Stripe webhook raw body capture (MUST be before express.json)
app.use('/api/v1/billing/webhook', express.raw({ type: 'application/json' }));

// ── Global Middleware ──────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// Trust proxy for rate limiting behind Nginx/Caddy
app.set('trust proxy', 1);

// ── Routes ────────────────────────────────────────────────────
app.use('/api/v1',            createHealthRoutes(db));
app.use('/api/v1/auth',       createAuthRoutes(db));
app.use('/api/v1/proof',      createProofRoutes(db, PROOF_WORKSPACE_ID));
app.use('/api/v1/providers',  createIngestionRoutes(db));
app.use('/api/v1/dashboard',  createDashboardRoutes(db));
app.use('/api/v1/billing',    createBillingRoutes(db));
app.use('/api/v1/signal-publish', createSignalPublishRoutes(db));
app.use('/api/v1/parser',       createParserRoutes());

// ── 404 Handler ───────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'NOT_FOUND' });
});

// ── Error Handler ─────────────────────────────────────────────
app.use((err: any, _req: any, res: any, _next: any) => {
  log.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
  log.info({ port: PORT, host: HOST }, '🚀 AgoraIQ API running');
});

export { app };
