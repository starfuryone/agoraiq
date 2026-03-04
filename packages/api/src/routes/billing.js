"use strict";
// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Billing Routes (Stripe Integration)
//
//   POST /api/v1/billing/checkout   — Create Stripe Checkout session
//   POST /api/v1/billing/webhook    — Stripe webhook handler (no auth)
//   GET  /api/v1/billing/status     — Current subscription status
//   GET  /api/v1/billing/portal     — Stripe Customer Portal link
// ═══════════════════════════════════════════════════════════════
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBillingRoutes = createBillingRoutes;
const express_1 = require("express");
const stripe_1 = __importDefault(require("stripe"));
const db_1 = require("@agoraiq/db");
const auth_1 = require("../middleware/auth");
const log = (0, db_1.createLogger)('billing-routes');
// Plan → env var mapping
const PLAN_PRICES = {
    PRO: 'STRIPE_PRICE_ID_PRO',
    ELITE: 'STRIPE_PRICE_ID_ELITE',
};
function getPriceId(planKey) {
    const envKey = PLAN_PRICES[planKey];
    return envKey ? (process.env[envKey] || null) : null;
}
function getPlanKeyFromPriceId(priceId) {
    for (const [plan, envKey] of Object.entries(PLAN_PRICES)) {
        if (process.env[envKey] === priceId)
            return plan;
    }
    return 'PRO';
}
function createBillingRoutes(db) {
    const router = (0, express_1.Router)();
    const stripeKey = process.env.STRIPE_SECRET_KEY || '';
    if (!stripeKey) {
        log.warn('STRIPE_SECRET_KEY not set — billing endpoints will fail');
    }
    const stripe = stripeKey ? new stripe_1.default(stripeKey, { apiVersion: '2024-12-18' }) : null;
    // ── POST /checkout ────────────────────────────────────────────
    router.post('/checkout', auth_1.requireAuth, async (req, res) => {
        try {
            const { planKey } = req.body;
            const userId = req.user.userId;
            if (!planKey || !PLAN_PRICES[planKey]) {
                res.status(400).json({ error: 'INVALID_PLAN', message: `planKey must be: ${Object.keys(PLAN_PRICES).join(', ')}` });
                return;
            }
            const priceId = getPriceId(planKey);
            if (!priceId) {
                log.error({ planKey }, 'Stripe Price ID not configured');
                res.status(500).json({ error: 'PLAN_NOT_CONFIGURED' });
                return;
            }
            // Get or create subscription record
            let sub = await db.subscription.findUnique({ where: { userId } });
            if (!sub) {
                sub = await db.subscription.create({
                    data: { userId, tier: 'free', status: 'inactive', planTier: 'FREE', subscriptionStatus: 'inactive' },
                });
            }
            // Get or create Stripe customer
            let customerId = sub.stripeCustomerId;
            if (!customerId) {
                const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
                const customer = await stripe.customers.create({
                    email: user?.email || undefined,
                    name: user?.name || undefined,
                    metadata: { userId },
                });
                customerId = customer.id;
                await db.subscription.update({ where: { id: sub.id }, data: { stripeCustomerId: customerId } });
            }
            const session = await stripe.checkout.sessions.create({
                customer: customerId,
                mode: 'subscription',
                payment_method_types: ['card'],
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: `${process.env.STRIPE_SUCCESS_URL || 'https://app.agoraiq.net/dashboard'}?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: process.env.STRIPE_CANCEL_URL || 'https://agoraiq.net/pricing',
                metadata: { userId, planKey },
            });
            log.info({ sessionId: session.id, userId, planKey }, 'Checkout session created');
            res.json({ url: session.url });
        }
        catch (err) {
            log.error({ err }, 'Checkout error');
            res.status(500).json({ error: 'CHECKOUT_FAILED' });
        }
    });
    // ── POST /webhook ─────────────────────────────────────────────
    // No auth — Stripe signature verification instead.
    // Must receive raw body (see index.ts setup).
    router.post('/webhook', async (req, res) => {
        const sig = req.headers['stripe-signature'];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!sig) {
            res.status(400).json({ error: 'MISSING_SIGNATURE' });
            return;
        }
        if (!webhookSecret) {
            log.error('STRIPE_WEBHOOK_SECRET not configured');
            res.status(500).json({ error: 'WEBHOOK_NOT_CONFIGURED' });
            return;
        }
        let event;
        try {
            // rawBody is set by express.raw() middleware on this path
            const rawBody = req.rawBody || req.body;
            if (!rawBody) {
                log.error('rawBody missing — check express.raw() middleware order');
                res.status(500).json({ error: 'SERVER_MISCONFIGURATION' });
                return;
            }
            event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
        }
        catch (err) {
            log.warn({ err: err.message }, 'Webhook signature verification failed');
            res.status(400).json({ error: 'INVALID_SIGNATURE' });
            return;
        }
        // Acknowledge immediately
        res.json({ received: true });
        // Process async
        processWebhookEvent(db, stripe, event).catch((err) => {
            log.error({ err, eventId: event.id }, 'Webhook processing failed');
        });
    });
    // ── GET /status ───────────────────────────────────────────────
    router.get('/status', auth_1.requireAuth, async (req, res) => {
        try {
            const userId = req.user.userId;
            const sub = await db.subscription.findUnique({ where: { userId } });
            if (!sub) {
                res.json({ planTier: 'FREE', subscriptionStatus: 'inactive', currentPeriodEnd: null, cancelAtPeriodEnd: false });
                return;
            }
            const now = new Date();
            let effectiveTier = sub.planTier;
            let effectiveStatus = sub.subscriptionStatus;
            if (sub.subscriptionStatus === 'canceled' && sub.currentPeriodEnd && now > sub.currentPeriodEnd) {
                effectiveTier = 'FREE';
                effectiveStatus = 'inactive';
            }
            res.json({
                planTier: effectiveTier,
                subscriptionStatus: effectiveStatus,
                currentPeriodEnd: sub.currentPeriodEnd,
                cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            });
        }
        catch (err) {
            log.error({ err }, 'Status check error');
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    });
    // ── GET /portal ───────────────────────────────────────────────
    router.get('/portal', auth_1.requireAuth, async (req, res) => {
        try {
            const userId = req.user.userId;
            const sub = await db.subscription.findUnique({ where: { userId } });
            if (!sub?.stripeCustomerId) {
                res.status(400).json({ error: 'NO_SUBSCRIPTION', message: 'Subscribe first to access billing portal.' });
                return;
            }
            const session = await stripe.billingPortal.sessions.create({
                customer: sub.stripeCustomerId,
                return_url: process.env.STRIPE_SUCCESS_URL || 'https://app.agoraiq.net/dashboard',
            });
            res.json({ url: session.url });
        }
        catch (err) {
            log.error({ err }, 'Portal session error');
            res.status(500).json({ error: 'PORTAL_FAILED' });
        }
    });
    return router;
}
// ═══════════════════════════════════════════════════════════════
// Webhook Event Processing (idempotent)
// ═══════════════════════════════════════════════════════════════
async function processWebhookEvent(db, stripe, event) {
    // Idempotency check
    const existing = await db.webhookEvent.findUnique({ where: { stripeEventId: event.id } });
    if (existing?.processed) {
        log.info({ eventId: event.id }, 'Already processed, skipping');
        return;
    }
    const webhookRecord = await db.webhookEvent.upsert({
        where: { stripeEventId: event.id },
        update: {},
        create: {
            stripeEventId: event.id,
            eventType: event.type,
            payload: event.data,
            customerId: event.data.object?.customer || null,
        },
    });
    try {
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutCompleted(db, stripe, event.data.object);
                break;
            case 'invoice.paid':
                await handleInvoicePaid(db, event.data.object);
                break;
            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(db, event.data.object);
                break;
            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(db, event.data.object);
                break;
            case 'invoice.payment_failed':
                await handlePaymentFailed(db, event.data.object);
                break;
            default:
                log.debug({ eventType: event.type }, 'Unhandled event type');
        }
        await db.webhookEvent.update({
            where: { id: webhookRecord.id },
            data: { processed: true, processedAt: new Date() },
        });
        log.info({ eventType: event.type, eventId: event.id }, 'Webhook processed');
    }
    catch (err) {
        log.error({ err, eventType: event.type }, 'Event handler failed');
        await db.webhookEvent.update({
            where: { id: webhookRecord.id },
            data: { processed: true, processingError: String(err), processedAt: new Date() },
        });
    }
}
async function handleCheckoutCompleted(db, stripe, session) {
    const customerId = session.customer;
    const subscriptionId = session.subscription;
    const userId = session.metadata?.userId;
    const planKey = session.metadata?.planKey || 'PRO';
    if (!subscriptionId) {
        log.warn({ sessionId: session.id }, 'Checkout has no subscription ID');
        return;
    }
    // Fetch real billing period from Stripe
    let periodStart;
    let periodEnd;
    try {
        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
        periodStart = new Date(stripeSub.current_period_start * 1000);
        periodEnd = new Date(stripeSub.current_period_end * 1000);
    }
    catch (err) {
        log.warn({ err }, 'Could not fetch subscription period, using fallback');
        periodStart = new Date();
        periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    // Find by stripeCustomerId first, then by userId
    let sub = await db.subscription.findFirst({ where: { stripeCustomerId: customerId } });
    if (!sub && userId) {
        sub = await db.subscription.findUnique({ where: { userId } });
    }
    if (!sub && userId) {
        log.warn({ customerId, userId }, 'Creating subscription from webhook');
        sub = await db.subscription.create({
            data: {
                userId,
                tier: planKey.toLowerCase(),
                status: 'active',
                stripeCustomerId: customerId,
                planTier: planKey,
                subscriptionStatus: 'active',
            },
        });
    }
    if (!sub) {
        log.error({ customerId }, 'Cannot resolve subscription — event dropped');
        return;
    }
    await db.subscription.update({
        where: { id: sub.id },
        data: {
            stripeSubscriptionId: subscriptionId,
            tier: planKey.toLowerCase(),
            status: 'active',
            planTier: planKey,
            subscriptionStatus: 'active',
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
        },
    });
    log.info({ subscriptionId, planKey, userId: sub.userId }, 'Subscription activated');
}
async function handleInvoicePaid(db, invoice) {
    const subscriptionId = invoice.subscription;
    if (!subscriptionId)
        return;
    const sub = await db.subscription.findFirst({ where: { stripeSubscriptionId: subscriptionId } });
    if (!sub) {
        log.warn({ subscriptionId }, 'No subscription for paid invoice');
        return;
    }
    await db.subscription.update({
        where: { id: sub.id },
        data: { status: 'active', subscriptionStatus: 'active' },
    });
    log.info({ subscriptionId }, 'Invoice paid');
}
async function handleSubscriptionUpdated(db, stripeSub) {
    const sub = await db.subscription.findFirst({ where: { stripeSubscriptionId: stripeSub.id } });
    if (!sub) {
        log.warn({ stripeSubId: stripeSub.id }, 'No subscription for update');
        return;
    }
    const statusMap = {
        trialing: 'trialing', active: 'active', past_due: 'past_due',
        canceled: 'canceled', unpaid: 'past_due',
    };
    const currentPriceId = stripeSub.items?.data?.[0]?.price?.id;
    const detectedPlan = currentPriceId ? getPlanKeyFromPriceId(currentPriceId) : undefined;
    await db.subscription.update({
        where: { id: sub.id },
        data: {
            status: statusMap[stripeSub.status] || stripeSub.status,
            subscriptionStatus: statusMap[stripeSub.status] || stripeSub.status,
            currentPeriodEnd: stripeSub.current_period_end ? new Date(stripeSub.current_period_end * 1000) : undefined,
            currentPeriodStart: stripeSub.current_period_start ? new Date(stripeSub.current_period_start * 1000) : undefined,
            cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
            ...(detectedPlan ? { tier: detectedPlan.toLowerCase(), planTier: detectedPlan } : {}),
        },
    });
    log.info({ stripeSubId: stripeSub.id, status: stripeSub.status }, 'Subscription updated');
}
async function handleSubscriptionDeleted(db, stripeSub) {
    const sub = await db.subscription.findFirst({ where: { stripeSubscriptionId: stripeSub.id } });
    if (!sub)
        return;
    await db.subscription.update({
        where: { id: sub.id },
        data: { status: 'canceled', subscriptionStatus: 'canceled', cancelAtPeriodEnd: true },
    });
    log.info({ stripeSubId: stripeSub.id }, 'Subscription canceled');
}
async function handlePaymentFailed(db, invoice) {
    const subscriptionId = invoice.subscription;
    if (!subscriptionId)
        return;
    const sub = await db.subscription.findFirst({ where: { stripeSubscriptionId: subscriptionId } });
    if (!sub)
        return;
    await db.subscription.update({
        where: { id: sub.id },
        data: { status: 'past_due', subscriptionStatus: 'past_due' },
    });
    log.warn({ subscriptionId }, 'Payment failed');
}
//# sourceMappingURL=billing.js.map