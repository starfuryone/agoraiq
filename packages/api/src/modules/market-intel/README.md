# AgoraIQ Market Intel Module

**$79/mo feature — real-time crypto intelligence: AI trade scores, volatility alerts, cross-exchange arbitrage.**

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Market Intel Data Flow                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Exchange APIs (Binance / Bybit / Kraken / OKX)                 │
│       │                          │                              │
│       ▼                          ▼                              │
│  volatilityEngine.ts      arbitrageEngine.ts                    │
│  (every 60s)              (every 60s)                           │
│       │                          │                              │
│       ▼                          ▼                              │
│  VolatilitySnapshot        ArbitrageAlert                       │
│  VolatilityAlert           → market_intel_alerts                │
│  → market_intel_snapshots                                       │
│  → market_intel_alerts                                          │
│                                                                  │
│  AgoraIQ DB (providers/signals)                                 │
│       │                                                          │
│       ▼                                                          │
│  scoreRefreshService.ts  ←── sentimentProvider.ts               │
│  (every 2 min)               (LunarCrush / stub)               │
│       │                                                          │
│  aiScoreEngine.ts                                               │
│  calculateTradeScore()                                          │
│  score = Σ(weight × normalised_input)                           │
│       │                                                          │
│       ▼                                                          │
│  ScoreResult → market_intel_scores                              │
│                                                                  │
│  marketIntelRoutes.ts                                           │
│  GET /api/market-intel/overview      ─┐                        │
│  GET /api/market-intel/scores        ─┤── Auth + Plan guard    │
│  GET /api/market-intel/alerts        ─┘                        │
│  POST /api/market-intel/admin/recompute ── Admin only          │
│                                                                  │
│  UI: /market-intel         (market-intel.html)                  │
│      /market-intel/:symbol (market-intel-detail.html)           │
└─────────────────────────────────────────────────────────────────┘
```

### Scoring Formula

```
score =
  0.25 × provider_accuracy   (from AgoraIQ verified win-rate)
  0.20 × momentum_strength   (24h price change, normalised ±10%)
  0.15 × volume_spike        (currentVol / 7d avg, 1x→3x range)
  0.15 × volatility_regime   (ATR%, bell-curve peak at ~3%)
  0.15 × sentiment_score     (LunarCrush / stub, 0..1)
  0.10 × funding_rate_signal (abs(funding%) / 0.1% max)
```

Confidence mapping: `HIGH ≥ 70%`, `MED 55–69%`, `LOW < 55%`

Expected R: `(1 + score×2) × (1 + vol_normalised)` capped at 5R

### Volatility Trigger Logic

```
if volatility_24h > 2× 30day_ema_avg
AND volume_24h    > 1.5× 30day_ema_avg
THEN trigger alert
```

30-day average is approximated using an EMA (α=1/30) that updates each tick.

### Arbitrage Trigger Logic

```
for each pair (buyExchange, sellExchange):
  spread = (sellEx.bid - buyEx.ask) / buyEx.ask
  fees   = buyEx.takerFee + sellEx.takerFee
  net    = spread - fees
  if spread > 0.003 AND net > 0.0005:
    emit alert (deduplicated per 5-minute window)
```

---

## File Tree

```
market-intel/
├── types/
│   └── index.ts                  Shared TS types
├── services/
│   ├── aiScoreEngine.ts          Scoring formula + normalisers
│   ├── volatilityEngine.ts       Spike detection + exchange adapters
│   ├── arbitrageEngine.ts        Cross-exchange price diff engine
│   ├── scoreRefreshService.ts    Orchestrates scoring per symbol
│   └── sentimentProvider.ts     Sentiment adapter chain
├── db/
│   ├── marketIntelRepository.ts  All DB queries (Prisma)
│   ├── migration.sql             Raw SQL migration
│   └── schema_additions.prisma  Prisma model additions
├── middleware/
│   └── marketIntelEntitlement.ts Auth + plan guard middleware
├── routes/
│   └── marketIntelRoutes.ts      Express router
├── scheduler/
│   └── marketIntelScheduler.ts   node-cron jobs with locking
├── ui/
│   ├── market-intel.html         Main dashboard page
│   └── market-intel-detail.html  Symbol detail + history page
├── integration/
│   └── wireMarketIntel.ts        Drop-in Express wiring helper
├── .env.example                  All env vars documented
└── README.md                     This file
```

---

## Setup & Run

### 1. Install dependencies

```bash
cd /opt/agoraiq
pnpm add node-cron @types/node-cron
```

### 2. Database migration

**Option A — Prisma (recommended)**
```bash
# Append Prisma models to existing schema
cat market-intel/db/schema_additions.prisma >> prisma/schema.prisma

# Run migration
pnpm prisma migrate dev --name add_market_intel_tables
pnpm prisma generate
```

**Option B — Raw SQL**
```bash
psql $DATABASE_URL < market-intel/db/migration.sql
```

### 3. Copy module into your repo

```bash
cp -r market-intel/ /opt/agoraiq/packages/api/src/modules/market-intel/
```

### 4. Update Prisma import path

In `db/marketIntelRepository.ts`, change:
```typescript
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
```
to:
```typescript
import { prisma } from '../../lib/prisma.js';  // your existing client
```

### 5. Wire into Express app

In your `app.ts` / `server.ts`:
```typescript
import { integrateMarketIntel } from './modules/market-intel/integration/wireMarketIntel';
integrateMarketIntel(app);
```

### 6. Copy UI pages

```bash
cp market-intel/ui/market-intel.html        /opt/agoraiq/packages/web/public/
cp market-intel/ui/market-intel-detail.html /opt/agoraiq/packages/web/public/
```

### 7. Environment variables

```bash
cat market-intel/.env.example >> .env
# Edit .env and fill in values (most have sensible defaults)
```

### 8. Restart PM2

```bash
pm2 restart agoraiq-api --update-env
pm2 logs agoraiq-api --lines 50
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `APP_BASE_URL` | `https://app.agoraiq.net` | Base URL for upgrade links |
| `MARKET_INTEL_VOLATILITY_MULTIPLIER` | `2` | Trigger: vol > N × 30d avg |
| `MARKET_INTEL_VOLUME_MULTIPLIER` | `1.5` | Trigger: vol > N × avg volume |
| `MARKET_INTEL_SPREAD_THRESHOLD` | `0.003` | Arbi trigger: spread > 0.3% |
| `MARKET_INTEL_CRON_VOLATILITY` | `*/1 * * * *` | Cron for volatility engine |
| `MARKET_INTEL_CRON_ARBITRAGE` | `*/1 * * * *` | Cron for arbitrage engine |
| `MARKET_INTEL_CRON_SCORE` | `*/2 * * * *` | Cron for score refresh |
| `LUNARCRUSH_API_KEY` | *(empty)* | Optional — real sentiment |
| `DATABASE_URL` | — | PostgreSQL connection string |

---

## API Reference

### `GET /api/market-intel/overview`
Returns top scored opportunities sorted by score descending.

**Auth:** Requires `pro`, `elite`, or `market_intel` plan.

**Query params:**
- `limit` — integer, default `20`, max `50`

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "symbol": "BTCUSDT",
      "side": "LONG",
      "score": 0.742,
      "probabilityPct": 74,
      "confidence": "HIGH",
      "expectedR": 2.1,
      "createdAt": "2025-01-15T14:32:00Z"
    }
  ],
  "meta": { "count": 8, "generatedAt": "..." }
}
```

---

### `GET /api/market-intel/scores?symbol=BTCUSDT`
Returns score history for a specific symbol.

**Query params:**
- `symbol` — required, e.g. `BTCUSDT`
- `limit` — default `50`, max `200`

---

### `GET /api/market-intel/alerts?type=volatility`
Returns recent alerts stream.

**Query params:**
- `type` — `volatility` | `arbitrage` | `all` (default `all`)
- `limit` — default `50`, max `200`
- `since` — ISO datetime filter

---

### `POST /api/market-intel/admin/recompute`
Manual trigger for testing. **Admin only.**

**Body:**
```json
{ "engines": ["volatility", "arbitrage", "scores"] }
```

---

## Test Plan

### 1. Unit tests — Score Engine

```typescript
// Test: correct formula output
const result = calculateTradeScore({
  provider_accuracy:   0.82,
  momentum_strength:   0.77,
  volume_spike:        0.71,
  volatility_regime:   0.62,
  sentiment_score:     0.69,
  funding_rate_signal: 0.40,
}, 'BTCUSDT', 'LONG');

// Expected: score ≈ 0.74, probabilityPct = 74, confidence = 'HIGH'
assert(result.probabilityPct === 74);
assert(result.confidence === 'HIGH');

// Test: all zeros → score = 0
const zero = calculateTradeScore({ ...allZeros }, 'ETHUSDT', 'LONG');
assert(zero.score === 0);
assert(zero.confidence === 'LOW');

// Test: clamp prevents >1 inputs from skewing output
const clamped = calculateTradeScore({ provider_accuracy: 5 /* should clamp to 1 */ ... });
assert(clamped.score <= 1);
```

### 2. Normalisation tests

```typescript
assert(normaliseWinRate(100)  === 1);
assert(normaliseWinRate(40)   === 0);
assert(normaliseWinRate(70)   === 0.5);

assert(normaliseVolumeSpike(1) === 0);   // 1x = no spike
assert(normaliseVolumeSpike(3) === 1);   // 3x = full signal

assert(normaliseFundingRate(0)    === 0);
assert(normaliseFundingRate(0.1)  === 1);
```

### 3. Volatility alert trigger test

Simulate a snapshot where:
- `volatility24h = 20%`, `volatility30dAvg = 8%` (ratio = 2.5x)
- `volume24h = 3x average`

Expected: alert triggered with severity `high`, regime `breakout likely`.

### 4. Arbitrage detection test

Mock price data:
```
Binance: bid=68000, ask=68100
Kraken:  bid=68432, ask=68500
```
Spread = (68432 - 68100) / 68100 = 0.487%  > threshold 0.3%
Expected: arbitrage alert emitted for BTCUSDT Binance→Kraken.

### 5. Deduplication test
Trigger the same arbitrage opportunity twice within 5 minutes.
Expected: only ONE alert written to DB.

### 6. Lock / concurrency test
Set `MARKET_INTEL_CRON_VOLATILITY=*/1 * * * *` and artificially delay
`runVolatilityEngine()` to take 90 seconds.
Expected: the second tick logs "still running — skipping" and does NOT
start a second concurrent run.

### 7. API endpoint tests

```bash
# Health check (returns 401 without auth)
curl -i https://app.agoraiq.net/api/market-intel/overview
# Expected: 401 Unauthorized

# With valid PRO token
curl -H "Authorization: Bearer $TOKEN" \
  https://app.agoraiq.net/api/market-intel/overview
# Expected: 200 OK, JSON with data array

# Admin recompute
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"engines":["scores"]}' \
  https://app.agoraiq.net/api/market-intel/admin/recompute
# Expected: 200 OK, { ok: true, results: { scores: { computed: 8, ... } } }
```

### 8. End-to-end validation

1. Start server with Market Intel wired in
2. Wait 2 minutes for first cron ticks
3. Check DB: `SELECT COUNT(*) FROM market_intel_scores;` should be > 0
4. Check DB: `SELECT COUNT(*) FROM market_intel_snapshots;` should be > 0
5. Hit `/api/market-intel/overview` — should return scored symbols
6. Check `/market-intel` page loads with scores displayed
7. Click a symbol row → `/market-intel/BTCUSDT` detail page loads

### 9. Regression — existing routes

```bash
# These must still return 200 (not 404 or 500):
curl https://app.agoraiq.net/api/providers
curl https://app.agoraiq.net/api/signals
curl https://app.agoraiq.net/dashboard
```

---

## Newsletter (Next Phase)

The Market Intel module is designed to feed a weekly PRO+ELITE newsletter.
Outputs ready for newsletter use:
- `getTopScores(5)` — top 5 opportunities of the week
- `getAlerts('volatility', 10, lastWeek)` — weekly volatility highlights
- `getAlerts('arbitrage', 5, lastWeek)` — best arbi opportunities

Newsletter implementation: **Brevo API**, scheduled weekly, to be built in the next task.
Do NOT implement newsletter here.
