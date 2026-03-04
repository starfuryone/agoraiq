"use strict";
// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Provider Webhook Auth Middleware
//
// Validates X-AgoraIQ-Provider-Token header against the
// provider's stored webhookSecret in config JSON.
// Optionally checks IP allowlist.
// ═══════════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerAuth = providerAuth;
const db_1 = require("@agoraiq/db");
const log = (0, db_1.createLogger)('provider-auth');
function providerAuth(db) {
    return async (req, res, next) => {
        const token = req.headers['x-agoraiq-provider-token'];
        const providerSlug = req.params.providerSlug;
        if (!token) {
            log.warn({ providerSlug }, 'Missing provider token');
            res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing X-AgoraIQ-Provider-Token header' });
            return;
        }
        try {
            const provider = await db.provider.findUnique({
                where: { slug: providerSlug },
            });
            if (!provider || !provider.isActive) {
                log.warn({ providerSlug }, 'Provider not found or inactive');
                res.status(404).json({ error: 'PROVIDER_NOT_FOUND' });
                return;
            }
            const config = provider.config;
            const expectedToken = config?.webhookSecret;
            if (!expectedToken || token !== expectedToken) {
                log.warn({ providerSlug }, 'Invalid provider token');
                res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid provider token' });
                return;
            }
            // Optional IP allowlist check
            const ipAllowlist = config?.ipAllowlist || [];
            if (ipAllowlist.length > 0) {
                // Extract the real client IP:
                // X-Forwarded-For: <client>, <proxy1>, <proxy2>
                // We want the leftmost (original client) IP only.
                // req.ip may already be set by Express trust proxy.
                const xff = req.headers['x-forwarded-for']?.toString() || '';
                const clientIp = (req.ip || xff.split(',')[0] || '').trim();
                // Exact match only — never substring
                if (!ipAllowlist.includes(clientIp)) {
                    log.warn({ providerSlug, clientIp, allowlist: ipAllowlist }, 'IP not in allowlist');
                    res.status(403).json({ error: 'FORBIDDEN', message: 'IP not allowed' });
                    return;
                }
            }
            // Attach provider to request for downstream handlers
            req.provider = provider;
            next();
        }
        catch (err) {
            log.error({ err, providerSlug }, 'Provider auth error');
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    };
}
//# sourceMappingURL=provider-auth.js.map