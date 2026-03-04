"use strict";
// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Auth Middleware
//
// JWT bearer token auth for paid endpoints.
// Subscription entitlement check for premium features.
// ═══════════════════════════════════════════════════════════════
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireSubscription = requireSubscription;
exports.requireAdmin = requireAdmin;
exports.signToken = signToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("@agoraiq/db");
const log = (0, db_1.createLogger)('auth');
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-to-a-random-64-char-string';
/** Verify JWT bearer token — rejects 401 if missing/invalid */
function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' });
        return;
    }
    const token = header.slice(7);
    try {
        const payload = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = payload;
        next();
    }
    catch (err) {
        log.warn({ err }, 'JWT verification failed');
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' });
    }
}
/** Check that the authenticated user has an active subscription */
function requireSubscription(db) {
    return async (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: 'UNAUTHORIZED' });
            return;
        }
        try {
            const sub = await db.subscription.findUnique({
                where: { userId: req.user.userId },
            });
            if (!sub || sub.status !== 'active') {
                res.status(403).json({
                    error: 'SUBSCRIPTION_REQUIRED',
                    message: 'Active subscription required to access this resource',
                });
                return;
            }
            // Attach tier info for downstream route handlers
            req.subscriptionTier = sub.tier;
            next();
        }
        catch (err) {
            log.error({ err }, 'Subscription check failed');
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    };
}
/** Check for admin role */
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
        return;
    }
    next();
}
/** Generate a JWT token */
function signToken(payload) {
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, {
        expiresIn: (process.env.JWT_EXPIRY || '7d'),
    });
}
//# sourceMappingURL=auth.js.map