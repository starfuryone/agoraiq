"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const db_1 = require("@agoraiq/db");
const health_1 = require("./routes/health");
const auth_1 = require("./routes/auth");
const proof_1 = require("./routes/proof");
const ingestion_1 = require("./routes/ingestion");
const dashboard_1 = require("./routes/dashboard");
const billing_1 = require("./routes/billing");
const signal_publish_1 = require("./routes/signal-publish");
const parser_1 = require("./routes/parser");
const markets_1 = require("./routes/markets");
const marketplace_1 = require("./routes/marketplace");
const sse_feed_1 = require("./routes/sse-feed");
const log = (0, db_1.createLogger)('server');
const PORT = parseInt(process.env.API_PORT || '4000', 10);
const HOST = process.env.API_HOST || '0.0.0.0';
const PROOF_WORKSPACE_ID = process.env.PROOF_WORKSPACE_ID || 'proof-workspace-default';
const app = (0, express_1.default)();
exports.app = app;
// Stripe webhook raw body capture (MUST be before express.json)
app.use('/api/v1/billing/webhook', express_1.default.raw({ type: 'application/json' }));
// ── Global Middleware ──────────────────────────────────────────
app.use((0, helmet_1.default)({ contentSecurityPolicy: false }));
app.use((0, cors_1.default)({
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
    credentials: true,
}));
app.use(express_1.default.json({ limit: '1mb' }));
// Trust proxy for rate limiting behind Nginx/Caddy
app.set('trust proxy', 1);
// ── Routes ────────────────────────────────────────────────────
app.use('/api/v1', (0, health_1.createHealthRoutes)(db_1.db));
app.use('/api/v1/auth', (0, auth_1.createAuthRoutes)(db_1.db));
app.use('/api/v1/proof', (0, proof_1.createProofRoutes)(db_1.db, PROOF_WORKSPACE_ID));
app.use('/api/v1/providers', (0, ingestion_1.createIngestionRoutes)(db_1.db));
app.use('/api/v1/dashboard', (0, dashboard_1.createDashboardRoutes)(db_1.db));
app.use('/api/v1/billing', (0, billing_1.createBillingRoutes)(db_1.db));
app.use('/api/v1/signal-publish', (0, signal_publish_1.createSignalPublishRoutes)(db_1.db));
app.use('/api/v1/parser', (0, parser_1.createParserRoutes)());
app.use('/api/v1/markets', (0, markets_1.createMarketsRoutes)(db_1.db));
app.use('/api/v1/marketplace', (0, marketplace_1.createMarketplaceRoutes)(db_1.db));
app.use('/api/v1/feed', (0, sse_feed_1.createSSEFeedRoutes)());
// ── 404 Handler ───────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' });
});
// ── Error Handler ─────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    log.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
});
// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
    log.info({ port: PORT, host: HOST }, '🚀 AgoraIQ API running');
});
//# sourceMappingURL=index.js.map