# Signal Engine → AgoraIQ Integration Plan

## Current State of Each System

### Signal Engine (this package)
- Standalone TypeScript worker
- Scans markets, scores candidates, publishes signals via HTTP POST
- Own SQLite DB for self-validation, learning loop, backtest history
- Expects an `/api/v1/providers/:key/signals` ingestion endpoint
- Expects a Provider record with slug `agoraiq-engine` to exist
- Health endpoint on port 9090
- No UI, no Prisma, no direct DB access to AgoraIQ Postgres

### AgoraIQ Monorepo (`/opt/agoraiq`)
- `packages/api` — Express on port 4000 (PM2: `agoraiq-api`)
- `packages/db` — Prisma + PostgreSQL (Signal, Trade, Provider models)
- `packages/web/public` — Static HTML served by Caddy at `app.agoraiq.net`
- `packages/services`, `packages/common`, `packages/observability`
- PM2: `agoraiq-api`, `agoraiq-listener`, `agoraiq-telegram`, `agoraiq-tracker`
- Caddy: `app.agoraiq.net` → static HTML + `/api/*` → port 4000

### What Connects Them
The signal engine POSTs to the AgoraIQ API like any external provider. The API creates a Signal record, the tracker resolves it against price, and the dashboard/Telegram display it. The engine is treated identically to a Discord or Telegram signal provider — it just happens to run on the same server.

---

## Phase 1: Minimal Integration (Get Signals Flowing)

Goal: Engine signals appear in the existing signal feed and get tracked. No schema changes, no frontend changes, no monorepo restructuring.

### 1.1 Deploy the Engine

```
/opt/agoraiq/
├── packages/
│   ├── signal-engine/     ← new (unzip here)
│   ├── api/
│   ├── db/
│   ├── web/
│   └── ...
```

```bash
cd /opt/agoraiq/packages
mkdir signal-engine && cd signal-engine
# unzip or copy the engine files here
npm install
npx tsc
```

### 1.2 Seed the Provider Record

The engine needs a Provider row in Postgres. Two options:

**Option A: HTTP (if the API has an admin create-provider endpoint)**

```bash
cd /opt/agoraiq/packages/signal-engine
AGORAIQ_API_BASE_URL=http://127.0.0.1:4000/api/v1 \
AGORAIQ_ADMIN_TOKEN=your-admin-token \
npx tsx scripts/seed-provider.ts
```

**Option B: Direct Prisma insert**

```bash
cd /opt/agoraiq/packages/db
npx prisma studio
# Manually create Provider:
#   slug: agoraiq-engine
#   name: AgoraIQ Engine
#   providerType: SIGNAL
#   isVerified: true
```

Or via a one-off script:

```bash
cd /opt/agoraiq/packages/db
npx tsx -e "
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
db.provider.upsert({
  where: { slug: 'agoraiq-engine' },
  update: {},
  create: {
    slug: 'agoraiq-engine',
    name: 'AgoraIQ Engine',
    providerType: 'SIGNAL',
    isVerified: true,
  }
}).then(p => { console.log('Provider:', p.id); db.\$disconnect(); });
"
```

Save the provider ID. If the API generates auth tokens per provider, set it in the engine's `.env` as `AGORAIQ_ENGINE_TOKEN`.

### 1.3 Verify the Ingestion Endpoint

The engine POSTs to `/api/v1/providers/agoraiq-engine/signals`. Check that this route exists in `packages/api/src/routes/`:

```bash
grep -rn 'providers.*signals\|signal.*ingest\|providerKey' /opt/agoraiq/packages/api/src/routes/ | head -10
```

If there's no provider ingestion route (only user-facing signal listing), you need to add one. The payload the engine sends:

```json
{
  "action": "BUY",
  "symbol": "BTCUSDT",
  "timeframe": "1h",
  "score": 75,
  "confidence": "MEDIUM",
  "price": 87000,
  "stopLoss": 85500,
  "takeProfit1": 89000,
  "takeProfit2": 91000,
  "signalTs": "2026-03-11T00:00:00.000Z",
  "meta": {
    "strategyType": "TREND_CONTINUATION",
    "regime": "TRENDING_BULL",
    "entryLow": 86800,
    "entryHigh": 87200,
    "expectedR": 2.1,
    "technicalScore": 80,
    "marketStructureScore": 65,
    "newsScore": 55,
    "providerScore": 50,
    "riskPenalty": 5,
    "reasonCodes": ["EMA_BULLISH_ALIGNMENT", "RSI_BULLISH_MIDZONE"],
    "riskFlags": [],
    "engineVersion": "2.0.0",
    "signalId": "abc123def456"
  },
  "rawPayload": { ... }
}
```

The route needs to:
1. Authenticate the request (Bearer token or API key)
2. Look up the Provider by slug (`agoraiq-engine`)
3. Create a Signal record with the standard fields
4. Create a Trade record from the parsed entry/TP/SL
5. Return 201 with the signal ID

If this route already exists for external providers (Discord/Telegram providers POST here), the engine uses it identically. If signals currently only come through the listener/parser pipeline, this route needs to be built.

### 1.4 Configure the Engine `.env`

```bash
cd /opt/agoraiq/packages/signal-engine
cp .env.example .env
nano .env
```

Key settings:

```env
AGORAIQ_API_BASE_URL=http://127.0.0.1:4000/api/v1
AGORAIQ_ENGINE_TOKEN=the-token-from-seed
EXCHANGE_SOCKS_PROXY=socks5://143.198.202.65:1080
ENGINE_DRY_RUN=true
ENGINE_HEALTH_PORT=9090
```

### 1.5 Test Dry Run

```bash
cd /opt/agoraiq/packages/signal-engine
npx tsx src/index.ts
```

Watch for `[DRY RUN] Would publish: ...` lines. If snapshots build and strategies fire, the engine works. Stop it.

### 1.6 PM2 Process

```bash
cd /opt/agoraiq/packages/signal-engine
npx tsc

pm2 start dist/index.js --name signal-engine --cwd /opt/agoraiq/packages/signal-engine
pm2 save
```

PM2 list should now show:

```
agoraiq-api        online
agoraiq-listener   online
agoraiq-telegram   online
agoraiq-tracker    online
signal-engine      online     ← new
```

### 1.7 Go Live

Set `ENGINE_DRY_RUN=false` in `.env`, then `pm2 restart signal-engine`.

**At this point:** Engine signals flow into the Signal table, the tracker resolves them, they appear in `/api/v1/signals` responses, and the Telegram bot shows them via `/signals`. No frontend changes needed — engine signals show up like any other provider's signals.

---

## Phase 2: Schema Enrichment (Queryable Analytics)

Goal: Add the `SignalAnalysis` table to Postgres so engine-specific metadata is queryable in SQL instead of buried in the `meta` JSON field.

### 2.1 Prisma Migration

Add to `packages/db/prisma/schema.prisma`:

```prisma
model SignalAnalysis {
  id                    String    @id @default(cuid())
  signalId              String    @unique @map("signal_id")
  signal                Signal    @relation(fields: [signalId], references: [id])

  strategyType          String    @map("strategy_type")
  regime                String
  symbol                String
  timeframe             String
  direction             String

  entryLow              Float     @map("entry_low")
  entryHigh             Float     @map("entry_high")
  expectedR             Float     @map("expected_r")

  technicalScore        Float     @map("technical_score")
  marketStructureScore  Float     @map("market_structure_score")
  newsScore             Float     @map("news_score")
  providerScore         Float     @map("provider_score")
  riskPenalty           Float     @map("risk_penalty")
  finalScore            Float     @map("final_score")
  confidence            String

  reasonCodes           Json      @map("reason_codes")
  riskFlags             Json      @map("risk_flags")

  // AI audit fields
  aiEnabled             Boolean   @default(false) @map("ai_enabled")
  aiModelVersion        String?   @map("ai_model_version")
  baseFinalScore        Float     @map("base_final_score")
  postAiFinalScore      Float     @map("post_ai_final_score")
  aiNarrative           String?   @map("ai_narrative")
  aiScoreAdjustment     Float?    @map("ai_score_adjustment")
  aiConfidence          Float?    @map("ai_confidence")
  aiReasoningLatencyMs  Int?      @map("ai_reasoning_latency_ms")

  // Outcome (filled by tracker or engine's own outcome tracker)
  outcomeLabel          String?   @map("outcome_label")
  realizedR             Float?    @map("realized_r")
  mfePct                Float?    @map("mfe_pct")
  maePct                Float?    @map("mae_pct")

  expiresAt             DateTime  @map("expires_at")
  publishedAt           DateTime  @map("published_at")
  resolvedAt            DateTime? @map("resolved_at")

  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")

  @@index([strategyType])
  @@index([regime])
  @@index([finalScore])
  @@index([publishedAt])
  @@index([outcomeLabel])
  @@map("signal_analysis")
}

model StrategyExpectancy {
  id            String    @id @default(cuid())
  strategyType  String    @map("strategy_type")
  symbol        String
  timeframe     String
  regime        String

  winRate       Float     @map("win_rate")
  avgR          Float     @map("avg_r")
  sampleSize    Int       @map("sample_size")

  updatedAt     DateTime  @updatedAt @map("updated_at")

  @@unique([strategyType, symbol, timeframe, regime])
  @@index([strategyType, symbol])
  @@map("strategy_expectancy")
}
```

Also add the relation to Signal:

```prisma
model Signal {
  // ... existing fields ...
  analysis      SignalAnalysis?
}
```

Run:

```bash
cd /opt/agoraiq/packages/db
npx prisma migrate dev --name add-signal-analysis
npx prisma generate
```

### 2.2 Dual Write

Modify the engine's publisher to write to both:
- SQLite (local, for the engine's own feedback loop)
- Postgres via the API (for the platform)

The simplest approach: the ingestion endpoint already stores `meta` as JSON. Add an API middleware that, when the provider is `agoraiq-engine`, also writes a `SignalAnalysis` row from the `meta` fields. This keeps the engine unchanged — the API does the enrichment.

Add to the signal creation route in `packages/api/src/routes/`:

```typescript
// After creating the Signal record:
if (provider.slug === 'agoraiq-engine' && body.meta) {
  await prisma.signalAnalysis.create({
    data: {
      signalId: signal.id,
      strategyType: body.meta.strategyType,
      regime: body.meta.regime,
      // ... map all fields from meta
    }
  });
}
```

### 2.3 API Query Endpoints

Add to `packages/api/src/routes/signals.ts`:

```
GET /api/v1/signals?provider=agoraiq-engine&strategy=TREND_CONTINUATION&regime=TRENDING_BULL
GET /api/v1/signals/:id/analysis   → returns SignalAnalysis for engine signals
GET /api/v1/engine/performance     → strategy-by-strategy win rates
GET /api/v1/engine/expectancy      → current expectancy table
```

---

## Phase 3: Frontend (Engine Signal Display)

Goal: Engine signals have distinct rendering in the dashboard showing strategy, regime, score breakdown, reason codes, and risk flags.

### 3.1 Provider Badge

In the signal feed, engine signals should be visually distinguishable:

```html
<!-- Signal card when provider is agoraiq-engine -->
<div class="signal-card signal-card--engine">
  <span class="badge badge--engine">Engine</span>
  <span class="badge badge--strategy">TREND_CONTINUATION</span>
  <span class="badge badge--regime">TRENDING_BULL</span>
  <!-- ... existing signal card content ... -->
</div>
```

CSS additions to the existing design system:

```css
.badge--engine {
  background: var(--cyan);
  color: var(--bg);
  font-family: 'DM Mono', monospace;
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 3px;
}
.badge--strategy { background: rgba(0, 212, 255, 0.15); color: var(--cyan); }
.badge--regime { background: rgba(16, 185, 129, 0.15); color: var(--green); }
```

### 3.2 Score Breakdown

Each engine signal card expands to show the scoring components. This uses data already in the `meta` field (Phase 1) or the `SignalAnalysis` table (Phase 2).

```
┌─────────────────────────────────────────────────────┐
│ BTC LONG — TREND_CONTINUATION              Score: 76 │
│ Regime: TRENDING_BULL  |  Expected R: 2.1  |  1h    │
├─────────────────────────────────────────────────────┤
│ Technical       ████████████████████░░  80/100       │
│ Market Structure ████████████████░░░░░  65/100       │
│ News            ██████████████░░░░░░░  55/100       │
│ Provider History ████████████░░░░░░░░  50/100       │
│ Risk Penalty    ██░░░░░░░░░░░░░░░░░░  -5           │
├─────────────────────────────────────────────────────┤
│ Why:                                                 │
│ • EMA alignment confirmed (50 > 200, price > 50)    │
│ • RSI in healthy bullish zone (58)                   │
│ • MACD momentum positive                            │
│ • Price above VWAP                                   │
│ • Entry near EMA20 (not overextended)               │
├─────────────────────────────────────────────────────┤
│ Entry: 86,800 – 87,200  |  SL: 85,500              │
│ TP1: 89,000  |  TP2: 91,000                        │
└─────────────────────────────────────────────────────┘
```

This is a new HTML page: `engine-signal.html` or an expansion section on the existing signals page.

### 3.3 Engine Tab / Filter

The existing signals page needs a provider filter dropdown or a dedicated tab. The simplest approach:

```html
<!-- In the signal feed nav -->
<button class="tab" data-filter="all">All</button>
<button class="tab" data-filter="agoraiq-engine">Engine</button>
```

The filter adds `?provider=agoraiq-engine` to the API call. No new API work needed if the existing `/api/v1/signals` route supports provider filtering.

### 3.4 Engine Performance Page

A new page at `/engine` or `/engine-performance`:

```
Strategy Performance (last 30 days)
─────────────────────────────────────────────
TREND_CONTINUATION   42 signals   WR: 54%   avgR: 0.32   PF: 1.8
MEAN_REVERSION       18 signals   WR: 44%   avgR: 0.18   PF: 1.3
BREAKOUT_CONFIRM     11 signals   WR: 36%   avgR: 0.41   PF: 2.1

By Regime
─────────────────────────────────────────────
TRENDING_BULL        28 signals   WR: 57%   avgR: 0.38
TRENDING_BEAR        14 signals   WR: 50%   avgR: 0.22
RANGE_CHOP           16 signals   WR: 44%   avgR: 0.15
UNKNOWN               8 signals   WR: 38%   avgR: 0.28

AI Reasoning Impact
─────────────────────────────────────────────
AI Boosted            18 signals   avgR: 0.35
AI Reduced             7 signals   avgR: 0.12
AI Unchanged          31 signals   avgR: 0.28
```

This page calls `/api/v1/engine/performance` which queries the `SignalAnalysis` table (Phase 2) or the `meta` JSON field (Phase 1).

---

## Phase 4: Proof Integration

The existing proof pages show provider performance publicly. Engine signals should appear there with enhanced detail.

### 4.1 Proof Route Enhancement

The existing proof routes (`/api/v1/proof/*`) already aggregate signals by provider. Engine signals flow through automatically. The enhancement is adding strategy/regime breakdowns:

```
GET /api/v1/proof/agoraiq-engine
  → overall stats (existing)
  → plus byStrategy, byRegime, byConfidence (new)
```

### 4.2 Public Engine Proof Page

A public page showing the engine's track record with the scoring breakdown for each signal. This is the marketing surface — it shows the scoring methodology is transparent and the outcomes are real.

---

## Integration Order (What To Do When)

### Immediate (gets signals flowing, ~2 hours)

1. `mkdir -p /opt/agoraiq/packages/signal-engine`
2. Unzip, `npm install`, `npx tsc`
3. Seed the `agoraiq-engine` Provider record in Postgres
4. Configure `.env` (proxy, token, dry run)
5. Test: `npx tsx src/index.ts` — verify snapshots build
6. Verify ingestion endpoint exists and accepts the engine's payload format
7. If ingestion endpoint missing, build it (Express route, ~1-2 hours)
8. Go live via PM2

### Week 1-2 (queryable analytics)

9. Add `SignalAnalysis` Prisma model + migration
10. Add server-side enrichment: when provider is `agoraiq-engine`, write SignalAnalysis row
11. Add `/api/v1/signals?provider=agoraiq-engine` filter support (if not already there)

### Week 2-3 (frontend)

12. Provider badge on signal cards for engine signals
13. Score breakdown expand section on signal cards
14. Engine tab/filter on signals page
15. Engine performance page (static HTML + `/api/v1/engine/performance`)

### Week 3-4 (proof + polish)

16. Enhanced proof route with strategy/regime breakdowns
17. Public engine proof page
18. Caddy route if engine performance page gets its own subdomain

---

## What Does NOT Change

- `@agoraiq/tracker` — resolves trades regardless of source. No changes.
- `@agoraiq/telegram` — shows signals from any provider. Engine signals appear automatically.
- Proof routes — engine signals flow through existing proof aggregation.
- Caddy config — no changes needed in Phase 1. The engine's health endpoint is internal (port 9090) and doesn't need external exposure.
- The engine's SQLite database — continues to run independently for self-validation. The Postgres SignalAnalysis table is the platform's copy, not a replacement.

---

## Dependency Diagram

```
                   ┌──────────────────────┐
                   │   signal-engine       │
                   │   (standalone worker) │
                   │   PM2: signal-engine  │
                   │   Port: 9090 (health) │
                   │   SQLite: local DB    │
                   └──────────┬───────────┘
                              │ POST /api/v1/providers/agoraiq-engine/signals
                              │ (via SOCKS5 proxy or localhost)
                              ▼
                   ┌──────────────────────┐
                   │   packages/api        │
                   │   PM2: agoraiq-api    │
                   │   Port: 4000          │
                   ├──────────────────────┤
                   │ Creates Signal record │──────► PostgreSQL
                   │ Creates Trade record  │        (packages/db)
                   │ Writes SignalAnalysis │
                   │   (Phase 2)           │
                   └──────────┬───────────┘
                              │
                   ┌──────────▼───────────┐
                   │   agoraiq-tracker     │
                   │   PM2: agoraiq-tracker│
                   │   Polls live price    │
                   │   Updates TP/SL hits  │
                   │   Computes R-multiple │
                   └──────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ Dashboard   │  │ Telegram   │  │ Proof      │
     │ signal feed │  │ /signals   │  │ public page│
     │ (static HTML)│ │            │  │            │
     └────────────┘  └────────────┘  └────────────┘
```

---

## Risk Notes

**If the ingestion endpoint doesn't exist yet:** This is the single blocking dependency. The engine cannot publish without it. The endpoint needs to accept the payload format documented above, authenticate via Bearer token, look up the provider by slug, and create Signal + Trade records. Estimate: 1-2 hours if you have working signal/trade creation code elsewhere in the API.

**If the engine publishes to localhost instead of through the proxy:** Since both run on the same VPS, the engine can POST to `http://127.0.0.1:4000/api/v1/...` directly without SOCKS5. The proxy is only needed for Binance and external AgoraIQ domains. Set `AGORAIQ_API_BASE_URL=http://127.0.0.1:4000/api/v1` to skip the proxy for ingestion.

**If the Trade schema doesn't match the engine's payload:** The engine sends `stopLoss`, `takeProfit1`, `takeProfit2` as flat fields. The AgoraIQ Trade model uses `slPrice`, `tp1Price`, `tp2Price`, `tp3Price`. The ingestion endpoint must map between them. This is a field rename, not a structural mismatch.
