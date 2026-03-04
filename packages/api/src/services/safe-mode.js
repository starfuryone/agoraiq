"use strict";
// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Safe Mode Service
//
// Centralized public-mode filtering. Every proof endpoint MUST
// pass data through these functions before responding.
//
// Rules enforced:
//   1. Delay: active trades delayed by PROOF_ACTIVE_DELAY_MINUTES
//   2. Redaction: no prices, no TP/SL, no raw payload, no provider IDs
//   3. Masking: top 3 providers by rank revealed; rest = "Provider D/E/F…"
//   4. Caps: max items, max months, max days of stats
//   5. Never return: providerId, providerKey, rawPayload, entryPrice,
//      exitPrice, tpPrice, slPrice, notes, userId, telegramId
// ═══════════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFE_MODE_CONFIG = void 0;
exports.redactObject = redactObject;
exports.filterByDelay = filterByDelay;
exports.buildProviderMask = buildProviderMask;
exports.safeModeFeed = safeModeFeed;
exports.safeModeProviders = safeModeProviders;
exports.assertSafe = assertSafe;
exports.isSafeMode = isSafeMode;
const db_1 = require("@agoraiq/db");
const log = (0, db_1.createLogger)('safe-mode');
// ── Configuration ─────────────────────────────────────────────
exports.SAFE_MODE_CONFIG = {
    activeDelayMinutes: parseInt(process.env.PROOF_ACTIVE_DELAY_MINUTES || '15', 10),
    maxFeedItems: parseInt(process.env.PROOF_MAX_FEED_ITEMS || '25', 10),
    maxMonths: parseInt(process.env.PROOF_MAX_MONTHS || '12', 10),
    maxStatsDays: 30,
    maxRevealedProviders: 3,
    cacheTtlMs: 60_000,
};
// ── Redaction: Strip all sensitive fields ──────────────────────
const FORBIDDEN_FIELDS = new Set([
    'providerId',
    'providerKey',
    'providerSlug',
    'rawPayload',
    'entryPrice',
    'exitPrice',
    'tpPrice',
    'slPrice',
    'tpPct',
    'slPct',
    'notes',
    'userId',
    'telegramId',
    'chatId',
    'workspaceId',
    'signalId',
    'meta',
    'config',
    'passwordHash',
    'price',
]);
function redactObject(obj) {
    const clean = {};
    for (const [key, value] of Object.entries(obj)) {
        if (FORBIDDEN_FIELDS.has(key))
            continue;
        clean[key] = value;
    }
    return clean;
}
// ── Delay: Filter active trades that are too recent ───────────
function filterByDelay(items) {
    const cutoff = new Date(Date.now() - exports.SAFE_MODE_CONFIG.activeDelayMinutes * 60_000);
    return items.filter((item) => {
        if (item.status === 'ACTIVE') {
            const created = new Date(item.createdAt);
            // Only show active trades older than delay threshold
            return created < cutoff;
        }
        // Closed trades: show immediately
        return true;
    });
}
// ── Masking: Provider name masking ────────────────────────────
const MASK_LABELS = ['Provider D', 'Provider E', 'Provider F', 'Provider G',
    'Provider H', 'Provider I', 'Provider J', 'Provider K'];
/**
 * Given a ranked list of providers, returns a map from providerId to display name.
 * Top N providers keep their real name; rest are masked.
 */
function buildProviderMask(rankings) {
    const mask = new Map();
    const sorted = [...rankings].sort((a, b) => a.rank - b.rank);
    let maskIdx = 0;
    for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i];
        if (i < exports.SAFE_MODE_CONFIG.maxRevealedProviders) {
            mask.set(p.providerId, p.name);
        }
        else {
            mask.set(p.providerId, MASK_LABELS[maskIdx % MASK_LABELS.length]);
            maskIdx++;
        }
    }
    return mask;
}
// ── Apply Safe Mode to Feed Items ─────────────────────────────
function safeModeFeed(items, providerMask) {
    // 1. Apply delay filter
    const delayed = filterByDelay(items);
    // 2. Cap items
    const capped = delayed.slice(0, exports.SAFE_MODE_CONFIG.maxFeedItems);
    // 3. Redact + mask
    return capped.map((item) => {
        // Extract partial ITB metadata (safe for public)
        const meta = item.meta;
        const itbMeta = meta && typeof meta === 'object' ? meta : null;
        // Public proof shows: signal strength label + band emoji only
        // NEVER: exact trade_score, prices, secondary_score, OHLC, profit
        const strength = itbMeta?.band_text
            ? { label: itbMeta.band_text, indicator: itbMeta.band_sign || '' }
            : null;
        return {
            id: item.id,
            symbol: item.symbol,
            timeframe: item.timeframe,
            direction: item.direction,
            status: item.status,
            // Only show R-multiple and P&L for closed trades
            rMultiple: item.status !== 'ACTIVE' ? (item.rMultiple ?? null) : null,
            pnlPct: item.status !== 'ACTIVE' ? (item.pnlPct ?? null) : null,
            provider: providerMask.get(item.providerId) || 'Unknown Provider',
            // Partial ITB data: strength label only (no score, no price)
            strength,
            source: itbMeta?.source || null,
            createdAt: new Date(item.createdAt).toISOString(),
            exitedAt: item.exitedAt ? new Date(item.exitedAt).toISOString() : null,
        };
    });
}
// ── Apply Safe Mode to Provider Rankings ──────────────────────
function safeModeProviders(rankings) {
    const mask = buildProviderMask(rankings);
    return rankings.map((p) => {
        const safe = {
            rank: p.rank,
            name: mask.get(p.providerId) || 'Unknown Provider',
        };
        // Copy safe numeric stats
        if (p.winRate !== undefined)
            safe.winRate = p.winRate;
        if (p.avgRR !== undefined)
            safe.avgRR = p.avgRR;
        if (p.totalTrades !== undefined)
            safe.totalTrades = p.totalTrades;
        return safe;
    });
}
// ── Validate Safe Mode Response ───────────────────────────────
// Defense-in-depth: scan response JSON for any leaked forbidden fields
function assertSafe(data) {
    const json = JSON.stringify(data);
    for (const field of FORBIDDEN_FIELDS) {
        // Check for key presence in serialized JSON (fast sanity check)
        if (json.includes(`"${field}":`)) {
            log.error({ field }, 'SAFE MODE VIOLATION: forbidden field in public response');
            throw new Error(`Safe mode violation: "${field}" leaked in public response`);
        }
    }
}
// ── Middleware: Attach safe-mode flag to request ───────────────
function isSafeMode(query) {
    return query.public === '1' || query.public === 'true';
}
//# sourceMappingURL=safe-mode.js.map