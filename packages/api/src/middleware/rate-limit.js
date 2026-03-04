"use strict";
// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Rate Limiting Middleware
// ═══════════════════════════════════════════════════════════════
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookRateLimiter = exports.proofRateLimiter = void 0;
exports.sseConnectionGuard = sseConnectionGuard;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
/** Rate limiter for public proof endpoints (IP-based) */
exports.proofRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: parseInt(process.env.RATE_LIMIT_PROOF_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_PROOF_MAX || '60', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
    keyGenerator: (req) => {
        return req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown';
    },
});
/** Rate limiter for provider webhook endpoints */
exports.webhookRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: parseInt(process.env.RATE_LIMIT_WEBHOOK_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_WEBHOOK_MAX || '120', 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'RATE_LIMITED', message: 'Webhook rate limit exceeded.' },
    keyGenerator: (req) => {
        // Key by provider token to rate-limit per provider
        return req.headers['x-agoraiq-provider-token']?.toString() || req.ip || 'unknown';
    },
});
/** SSE connection tracker */
let activeSSEConnections = 0;
const MAX_SSE = parseInt(process.env.SSE_MAX_CONNECTIONS || '100', 10);
function sseConnectionGuard(req, res, next) {
    if (activeSSEConnections >= MAX_SSE) {
        res.status(503).json({ error: 'SSE_LIMIT', message: 'Too many live connections.' });
        return;
    }
    activeSSEConnections++;
    req.on('close', () => {
        activeSSEConnections--;
    });
    next();
}
//# sourceMappingURL=rate-limit.js.map