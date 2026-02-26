# AgoraIQ Signals Tracking Service — Implementation Plan

## Priority Breakdown

### P0 — Foundation (Ship MVP) ✅

| # | Task | Status | Files |
|---|------|--------|-------|
| 0.1 | Prisma schema (providers, signals, trades, users, subscriptions, telegram_users, watchlists, audit_logs) | ✅ | `packages/db/prisma/schema.prisma` |
| 0.2 | DB package (PrismaClient singleton, logger) | ✅ | `packages/db/src/index.ts`, `logger.ts` |
| 0.3 | Seed script (ITB provider, admin user) | ✅ | `packages/db/src/seed.ts` |
| 0.4 | Signal ingestion endpoint with Zod validation + idempotency | ✅ | `packages/api/src/routes/ingestion.ts` |
| 0.5 | Provider webhook auth middleware | ✅ | `packages/api/src/middleware/provider-auth.ts` |
| 0.6 | Safe-mode service (centralized redaction/masking/delay/caps) | ✅ | `packages/api/src/services/safe-mode.ts` |
| 0.7 | Enhanced proof routes (stats, monthly, feed, anomalies, SSE) | ✅ | `packages/api/src/routes/proof.ts` |
| 0.8 | Rate limiting middleware (proof + webhook + SSE cap) | ✅ | `packages/api/src/middleware/rate-limit.ts` |
| 0.9 | Auth middleware (JWT + subscription check) | ✅ | `packages/api/src/middleware/auth.ts` |
| 0.10 | Auth routes (signup, login, me) | ✅ | `packages/api/src/routes/auth.ts` |
| 0.11 | Dashboard routes (signals, providers, watchlists, exports) | ✅ | `packages/api/src/routes/dashboard.ts` |
| 0.12 | API server entry (Express, all routes wired) | ✅ | `packages/api/src/index.ts` |
| 0.13 | Tracker worker (price fetch, TP/SL/timeout resolution) | ✅ | `packages/tracker/src/index.ts` |
| 0.14 | Price service (Binance API, caching, retry/backoff) | ✅ | `packages/tracker/src/price-service.ts` |
| 0.15 | Telegram bot (onboarding, watchlists, alerts, recaps, commands) | ✅ | `packages/telegram/src/index.ts` |
| 0.16 | Web proof page (public, live SSE) | ✅ | `packages/web/public/proof.html` |
| 0.17 | Web dashboard (SPA: signals, providers, watchlists, settings) | ✅ | `packages/web/public/dashboard.html` |
| 0.18 | Login/signup pages | ✅ | `packages/web/public/login.html`, `signup.html` |
| 0.19 | Web server (static file serving) | ✅ | `packages/web/src/server.ts` |
| 0.20 | .env.example with all variables | ✅ | `.env.example` |
| 0.21 | INSTALL.md (full deployment guide) | ✅ | `INSTALL.md` |
| 0.22 | Documentation (4 guides) | ✅ | `docs/*.md` |

### P1 — Conversion & Retention (Week 2–3)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Daily/weekly digest scheduler (Telegram + email) | ⬜ | Cron job that queries 24h outcomes and sends via bot |
| 1.2 | Alert tuning (per-symbol confidence threshold) | ⬜ | Add to user preferences JSON |
| 1.3 | Saved filters (dashboard) | ⬜ | Store in user preferences, load on inbox |
| 1.4 | Provider ranking improvements (sample-size penalty, decay) | ⬜ | Bayesian adjustment for small sample sizes |
| 1.5 | Performance caching/rollups (materialized KPI table) | ⬜ | Scheduled job to compute and store 7d/30d/90d rollups |
| 1.6 | Admin tools (provider management CRUD) | ⬜ | Admin-only API routes |
| 1.7 | Stripe billing integration | ⬜ | Checkout sessions, webhook for subscription status |
| 1.8 | Email notifications (signal alerts, digests) | ⬜ | Optional alongside Telegram |

### P2 — Premium Features (Week 4+)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1 | Ensemble signals (weighted consensus across providers) | ⬜ | New table + scoring algorithm |
| 2.2 | Outcome feedback loop to ITB | ⬜ | POST results back to ITB for model evaluation |
| 2.3 | Provider marketplace (self-serve onboarding) | ⬜ | Public registration, approval workflow, revenue share |
| 2.4 | White-label workspaces | ⬜ | Multi-tenant with custom branding |
| 2.5 | API keys for paid users (programmatic access) | ⬜ | Key generation, rate limiting per key |
| 2.6 | Advanced analytics (equity curves, correlation, heatmaps) | ⬜ | Chart.js or D3 components |
| 2.7 | Mobile-responsive dashboard improvements | ⬜ | CSS only, no new framework |

---

## Architecture Diagram

```
┌─────────────┐    webhook     ┌─────────────────────────────────┐
│  ITB (Python)│──────────────→│  @agoraiq/api (Express)         │
│  (separate)  │               │  ├── /providers/:slug/signals   │
└─────────────┘               │  ├── /proof/* (public, safe-mode)│
                               │  ├── /dashboard/* (paid, JWT)    │
┌─────────────┐    webhook     │  └── /auth/* (public)            │
│  External    │──────────────→│                                  │
│  Providers   │               └────────────┬────────────────────┘
└─────────────┘                             │
                                            │ Prisma
                               ┌────────────▼────────────────────┐
                               │  PostgreSQL                      │
                               │  (providers, signals, trades,    │
                               │   users, subscriptions, ...)     │
                               └────────────┬────────────────────┘
                                            │
                               ┌────────────▼────────────────────┐
                               │  @agoraiq/tracker (worker)       │
                               │  Polls ACTIVE trades, fetches    │
                               │  prices, resolves TP/SL/EXPIRED  │
                               └─────────────────────────────────┘

┌─────────────┐               ┌─────────────────────────────────┐
│  @agoraiq/  │──────────────→│  Telegram Users (paid)           │
│  telegram   │  bot commands  │  Watchlists, alerts, recaps      │
│  (Telegraf) │               └─────────────────────────────────┘
└─────────────┘

┌─────────────┐    serves      ┌─────────────────────────────────┐
│  @agoraiq/  │──────────────→│  Browser (proof page, dashboard)  │
│  web        │  static HTML   │  Fetches /api/* for data          │
└─────────────┘               └─────────────────────────────────┘
```

## File Tree

```
agoraiq/
├── .env.example
├── INSTALL.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── docs/
│   ├── how-to-add-provider.md
│   ├── how-itb-posts-signals.md
│   ├── how-safe-mode-works.md
│   └── how-to-run-tracker.md
└── packages/
    ├── db/
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── prisma/schema.prisma
    │   └── src/
    │       ├── index.ts
    │       ├── logger.ts
    │       └── seed.ts
    ├── api/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts
    │       ├── middleware/
    │       │   ├── auth.ts
    │       │   ├── provider-auth.ts
    │       │   └── rate-limit.ts
    │       ├── routes/
    │       │   ├── auth.ts
    │       │   ├── dashboard.ts
    │       │   ├── health.ts
    │       │   ├── ingestion.ts
    │       │   └── proof.ts
    │       └── services/
    │           ├── cache.ts
    │           └── safe-mode.ts
    ├── tracker/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts
    │       └── price-service.ts
    ├── telegram/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       └── index.ts
    └── web/
        ├── package.json
        ├── tsconfig.json
        ├── public/
        │   ├── proof.html
        │   ├── dashboard.html
        │   ├── login.html
        │   └── signup.html
        └── src/
            └── server.ts
```
