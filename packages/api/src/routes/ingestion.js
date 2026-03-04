"use strict";
// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Signal Ingestion Routes
//
//   POST /api/v1/providers/:providerSlug/signals
//     - Token-protected via X-AgoraIQ-Provider-Token header
//     - Validates payload against versioned schema (Zod)
//     - Enforces idempotency (provider_key+symbol+timeframe+ts)
//     - Creates Signal record + derived Trade (ACTIVE)
//     - Stores raw payload for audit; never exposes raw publicly
//     - Ingestion never blocks on price fetch
// ═══════════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.createIngestionRoutes = createIngestionRoutes;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("@agoraiq/db");
const provider_auth_1 = require("../middleware/provider-auth");
const rate_limit_1 = require("../middleware/rate-limit");
const log = (0, db_1.createLogger)('signal-ingest');
// ── Payload Schema (Zod) ──────────────────────────────────────
// ITB-compatible meta schema (v1.1 extended fields)
const ItbMetaSchema = zod_1.z.object({
    source: zod_1.z.string().optional(), // "itb"
    itb_version: zod_1.z.string().optional(), // "1.0"
    description: zod_1.z.string().optional(), // ITB config description
    trade_score: zod_1.z.number().optional(), // signed score [-1,+1]
    secondary_score: zod_1.z.number().optional().nullable(),
    band_no: zod_1.z.number().optional(), // signal strength band
    band_sign: zod_1.z.string().optional(), // emoji indicator
    band_text: zod_1.z.string().optional(), // "BUY ZONE", "strong", etc.
    close_price: zod_1.z.number().optional(), // exact close price
    open: zod_1.z.number().optional().nullable(),
    high: zod_1.z.number().optional().nullable(),
    low: zod_1.z.number().optional().nullable(),
    volume: zod_1.z.number().optional().nullable(),
    transaction: zod_1.z.object({
        status: zod_1.z.string().optional(),
        price: zod_1.z.number().optional(),
        profit: zod_1.z.number().optional(),
    }).optional().nullable(),
}).passthrough(); // allow extra fields
const SignalPayloadSchema = zod_1.z.object({
    schema_version: zod_1.z.string().default('1.0'),
    provider_key: zod_1.z.string().min(1),
    symbol: zod_1.z.string().min(1).toUpperCase(),
    timeframe: zod_1.z.string().min(1),
    action: zod_1.z.enum(['BUY', 'SELL', 'HOLD']),
    score: zod_1.z.number().min(0).max(1).optional().nullable(),
    confidence: zod_1.z.number().min(0).max(1).optional().nullable(),
    ts: zod_1.z.string().datetime(),
    price: zod_1.z.number().positive().optional().nullable(),
    meta: zod_1.z.union([ItbMetaSchema, zod_1.z.record(zod_1.z.any())]).optional().nullable(),
});
// ── Route Factory ─────────────────────────────────────────────
function createIngestionRoutes(db) {
    const router = (0, express_1.Router)();
    const proofWorkspaceId = process.env.PROOF_WORKSPACE_ID || 'proof-workspace-default';
    // POST /api/v1/providers/:providerSlug/signals
    router.post('/:providerSlug/signals', rate_limit_1.webhookRateLimiter, (0, provider_auth_1.providerAuth)(db), async (req, res) => {
        const provider = req.provider;
        const providerSlug = req.params.providerSlug;
        // ── 1. Validate payload ───────────────────────────────
        const parsed = SignalPayloadSchema.safeParse(req.body);
        if (!parsed.success) {
            log.warn({ providerSlug, errors: parsed.error.issues }, 'Invalid signal payload');
            // Audit: rejected signal
            await db.auditLog.create({
                data: {
                    action: 'signal.rejected',
                    actorType: 'provider',
                    actorId: providerSlug,
                    meta: { reason: 'validation_failed', errors: parsed.error.issues },
                },
            }).catch(() => { }); // non-blocking audit
            res.status(400).json({
                error: 'VALIDATION_FAILED',
                issues: parsed.error.issues,
            });
            return;
        }
        const payload = parsed.data;
        // ── 2. Build idempotency key ──────────────────────────
        const idempotencyKey = `${payload.provider_key}:${payload.symbol}:${payload.timeframe}:${payload.ts}`;
        try {
            // ── 3. Check for duplicate (fast path) ──────────────
            const existing = await db.signal.findUnique({
                where: { idempotencyKey },
                select: { id: true },
            });
            if (existing) {
                log.info({ providerSlug, idempotencyKey }, 'Duplicate signal — skipped');
                res.status(200).json({
                    status: 'duplicate',
                    signalId: existing.id,
                    message: 'Signal already ingested (idempotent)',
                });
                return;
            }
            // ── 4. Determine trade parameters ───────────────────
            const config = provider.config;
            const direction = payload.action === 'SELL' ? 'SHORT' : 'LONG';
            const exchange = config?.defaultExchange || 'BINANCE_FUTURES';
            const defaultTpPct = config?.defaultTpPct || parseFloat(process.env.TRACKER_DEFAULT_TP_PCT || '3.0');
            const defaultSlPct = config?.defaultSlPct || parseFloat(process.env.TRACKER_DEFAULT_SL_PCT || '1.5');
            const timeoutHours = config?.defaultTimeoutHours || parseFloat(process.env.TRACKER_DEFAULT_TIMEOUT_HOURS || '72');
            const timeoutAt = new Date(new Date(payload.ts).getTime() + timeoutHours * 3600_000);
            // Compute TP/SL prices if entry price is available
            let tpPrice = null;
            let slPrice = null;
            let tp1Price = null;
            let tp2Price = null;
            let tp3Price = null;
            // Extract multi-TP from listener payload (meta.tp_prices)
            const metaObj = payload.meta;
            const tpPricesFromListener = (metaObj?.tp_prices || []).filter((p) => typeof p === 'number' && p > 0);
            if (tpPricesFromListener.length > 0 && payload.price) {
                // Sort TPs by distance from entry (ascending)
                const sorted = [...tpPricesFromListener].sort((a, b) => {
                    const distA = Math.abs(a - payload.price);
                    const distB = Math.abs(b - payload.price);
                    return distA - distB;
                });
                tp1Price = sorted[0] || null;
                tp2Price = sorted[1] || null;
                tp3Price = sorted[2] || null;
                tpPrice = tp1Price; // Primary TP = closest target
                // Use SL from listener if available, else compute from defaults
                const slFromMeta = typeof metaObj?.sl_price === 'number' && metaObj.sl_price > 0 ? metaObj.sl_price : null;
                if (slFromMeta) {
                    slPrice = slFromMeta;
                }
                else if (direction === 'LONG') {
                    slPrice = payload.price * (1 - defaultSlPct / 100);
                }
                else {
                    slPrice = payload.price * (1 + defaultSlPct / 100);
                }
            }
            else if (payload.price) {
                // Fallback to default percentage-based TP/SL
                if (direction === 'LONG') {
                    tpPrice = payload.price * (1 + defaultTpPct / 100);
                    slPrice = payload.price * (1 - defaultSlPct / 100);
                }
                else {
                    tpPrice = payload.price * (1 - defaultTpPct / 100);
                    slPrice = payload.price * (1 + defaultSlPct / 100);
                }
            }
            // ── 5. Create Signal + Trade in transaction ─────────
            const isActionable = payload.action === 'BUY' || payload.action === 'SELL';
            const result = await db.$transaction(async (tx) => {
                // Create signal (immutable)
                const signal = await tx.signal.create({
                    data: {
                        idempotencyKey,
                        schemaVersion: payload.schema_version,
                        providerKey: payload.provider_key,
                        providerId: provider.id,
                        workspaceId: proofWorkspaceId,
                        symbol: payload.symbol,
                        timeframe: payload.timeframe,
                        action: payload.action,
                        score: payload.score ?? null,
                        confidence: payload.confidence ?? null,
                        signalTs: new Date(payload.ts),
                        price: payload.price ?? null,
                        meta: (payload.meta ?? null),
                        rawPayload: req.body, // full original for audit
                    },
                });
                // Create derived paper trade for actionable signals
                let trade = null;
                if (isActionable) {
                    trade = await tx.trade.create({
                        data: {
                            signalId: signal.id,
                            providerId: provider.id,
                            workspaceId: proofWorkspaceId,
                            symbol: payload.symbol,
                            timeframe: payload.timeframe,
                            direction,
                            exchange,
                            entryPrice: payload.price ?? null,
                            enteredAt: payload.price ? new Date(payload.ts) : null,
                            tpPrice,
                            tp1Price: tp1Price,
                            tp2Price: tp2Price,
                            tp3Price: tp3Price,
                            slPrice,
                            tpPct: defaultTpPct,
                            slPct: defaultSlPct,
                            status: 'ACTIVE',
                            timeoutAt,
                        },
                    });
                }
                return { signal, trade };
            });
            // ── 6. Audit log (non-blocking) ─────────────────────
            db.auditLog.create({
                data: {
                    action: 'signal.ingested',
                    actorType: 'provider',
                    actorId: providerSlug,
                    resourceType: 'signal',
                    resourceId: result.signal.id,
                    meta: {
                        symbol: payload.symbol,
                        action: payload.action,
                        tradeId: result.trade?.id,
                        idempotencyKey,
                    },
                },
            }).catch((err) => log.error({ err }, 'Audit log write failed'));
            log.info({
                providerSlug,
                signalId: result.signal.id,
                tradeId: result.trade?.id,
                symbol: payload.symbol,
                action: payload.action,
            }, 'Signal ingested');
            // ── 7. Broadcast to Telegram subscribers (non-blocking) ─
            // Extract ITB-specific fields for rich alerts
            const meta = payload.meta || {};
            const itbData = {
                symbol: payload.symbol,
                timeframe: payload.timeframe,
                action: payload.action,
                providerSlug,
                confidence: payload.confidence,
                signalId: result.signal.id,
                tradeId: result.trade?.id ?? null,
                // ITB-specific fields for full alerts (paid users)
                price: payload.price ?? meta.close_price ?? null,
                tradeScore: meta.trade_score ?? null,
                bandNo: meta.band_no ?? null,
                bandSign: meta.band_sign ?? null,
                bandText: meta.band_text ?? null,
                ohlc: meta.open && meta.high && meta.low ? {
                    open: meta.open,
                    high: meta.high,
                    low: meta.low,
                    close: meta.close_price ?? payload.price,
                } : null,
                source: meta.source ?? null,
                description: meta.description ?? null,
            };
            // Fire-and-forget broadcast (import dynamically to avoid circular deps)
            try {
                const { broadcastSignalAlert } = require('@agoraiq/telegram');
                broadcastSignalAlert(itbData).catch(() => { });
            }
            catch { /* telegram package not loaded in this process */ }
            res.status(201).json({
                status: 'created',
                signalId: result.signal.id,
                tradeId: result.trade?.id ?? null,
            });
        }
        catch (err) {
            // Handle unique constraint violation (race condition on idempotency)
            if (err?.code === 'P2002' && err?.meta?.target?.includes('idempotencyKey')) {
                log.info({ providerSlug, idempotencyKey }, 'Duplicate signal (race) — skipped');
                res.status(200).json({
                    status: 'duplicate',
                    message: 'Signal already ingested (idempotent)',
                });
                return;
            }
            log.error({ err, providerSlug }, 'Signal ingestion failed');
            res.status(500).json({ error: 'INGESTION_FAILED' });
        }
    });
    return router;
}
//# sourceMappingURL=ingestion.js.map