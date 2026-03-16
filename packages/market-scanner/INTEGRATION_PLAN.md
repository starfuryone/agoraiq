# AgoraIQ Signal Engine — Integration Plan

**Package:** `packages/signal-engine/`
**Internal Provider Slug:** `agoraiq-engine`
**Date:** 2026-03-10
**Status:** Implementation-ready

---

## 1. Repo Fit Summary

### What already exists

AgoraIQ is a signal operating system. The current pipeline is:

```
provider webhooks → Signal/Trade storage → Tracker → Dashboard / Proof / Telegram
```

The existing platform already supports:
- **Signal model**: `providerKey`, `providerId`, `workspaceId`, `symbol`, `timeframe`, `action`, `score`, `confidence`, `signalTs`, `price`, `meta`, `rawPayload`
- **Trade model**: `direction`, entry price, TP/SL, multi-TP fields (`tp1Price`, `tp2Price`, `tp3Price`), TP hit timestamps, timeout, status, R multiple, P&L
- **Provider model**: provider records with slug, type, verification, analytics eligibility
- **Tracker** (`@agoraiq/tracker`): resolves trades against live price, updates TP/SL hits, computes R multiples
- **Dashboard/Proof**: public proof routes with safe-mode and masking, provider leaderboard, signal feed
- **Telegram** (`@agoraiq/telegram`): `/signals`, `/providers`, watchlist alerts

### What must be added

The signal engine is the **upstream producer** that turns AgoraIQ into its own provider. It does not replace any existing package. It sits before the ingestion endpoint.

```
market/news/TA scanner → AgoraIQ Engine provider → existing ingestion → existing tracker → existing UI
```

New components:
1. `packages/signal-engine/` — the worker package
2. A `Provider` record: `slug: agoraiq-engine`, `providerType: SIGNAL`, `isVerified: true`
3. Schema enrichment (either via `meta`/`rawPayload` or a new `SignalAnalysis` table)
4. Dashboard/Telegram presentation for first-party engine signals

### What stays untouched (Phase 1)
- `@agoraiq/tracker` — no changes needed; it resolves signals regardless of source
- `@agoraiq/api` ingestion routes — the engine posts through the same HTTP endpoint
- `@agoraiq/telegram` — signals appear automatically once they hit the Signal table
- Proof routes — engine signals flow into proof pages like any provider

---

## 2. File-by-File Integration Plan

```
packages/signal-engine/
├── package.json
├── tsconfig.json
├── .env.example
├── prisma/
│   └── signal-analysis.prisma          # new schema extension
├── src/
│   ├── index.ts                         # entry point / scheduler
│   ├── types.ts                         # all enums, interfaces, type definitions
│   ├── config.ts                        # env vars, thresholds, feature flags
│   ├── snapshot-builder.ts              # builds MarketSnapshot from raw sources
│   ├── regime-detector.ts               # classifies market regime
│   ├── strategies/
│   │   ├── index.ts                     # strategy runner (runs all strategies)
│   │   ├── trend-continuation.ts        # TREND_CONTINUATION strategy
│   │   ├── breakout.ts                  # BREAKOUT_CONFIRMATION strategy
│   │   ├── mean-reversion.ts            # MEAN_REVERSION strategy
│   │   ├── event-driven.ts             # EVENT_DRIVEN strategy
│   │   └── pullback.ts                 # PULLBACK placeholder
│   ├── scoring/
│   │   ├── index.ts                     # apply_global_scoring orchestrator
│   │   ├── technical-score.ts           # score_technicals
│   │   ├── market-structure-score.ts    # score_market_structure
│   │   ├── news-score.ts               # score_news_context
│   │   ├── provider-score.ts            # score_provider_context
│   │   ├── risk-penalty.ts             # score_risk_penalty
│   │   └── confidence.ts               # map_score_to_confidence
│   ├── ranking.ts                       # rank_candidates + select_best
│   ├── publisher.ts                     # convert to FinalSignal + publish
│   ├── explanation.ts                   # translate reason codes to human text
│   ├── lifecycle.ts                     # track active signals (optional local)
│   ├── learning.ts                      # nightly feedback job
│   ├── services/
│   │   ├── market-data.ts              # OHLCV, orderbook from exchange
│   │   ├── derivatives.ts              # funding, OI, liquidations
│   │   ├── news.ts                     # news event scoring
│   │   ├── sentiment.ts                # sentiment aggregation
│   │   ├── levels.ts                   # support/resistance detection
│   │   └── provider-stats.ts           # historical expectancy lookup
│   └── utils/
│       ├── ta.ts                        # technical analysis helpers (RSI, MACD, EMA, etc.)
│       ├── math.ts                      # clamp, normalize, compute_expected_r
│       └── thresholds.ts               # per-symbol liquidity/volume thresholds
```

### File Details

| File | Purpose | Major Exports | Talks To | I/O |
|------|---------|---------------|----------|-----|
| `src/index.ts` | Main loop scheduler. Runs every 5 min via cron or setInterval. | `startEngine()`, `stopEngine()` | All modules | In: config → Out: published signals |
| `src/types.ts` | All TypeScript types and enums. | `Direction`, `RegimeType`, `SignalStatus`, `MarketSnapshot`, `StrategySignalCandidate`, `FinalSignal`, `SignalOutcome` | Everything imports from here | Pure type definitions |
| `src/config.ts` | Environment config, feature flags, thresholds. | `EngineConfig` | `index.ts`, services | In: env vars → Out: typed config |
| `src/snapshot-builder.ts` | Assembles MarketSnapshot from raw exchange/news/sentiment data. | `buildMarketSnapshot(symbol, timeframe)` | `services/*`, `regime-detector`, `utils/ta` | In: symbol+timeframe → Out: MarketSnapshot |
| `src/regime-detector.ts` | Classifies regime from snapshot + candles. | `detectMarketRegime(snapshot, candles)` | `utils/thresholds` | In: snapshot+candles → Out: RegimeType |
| `src/strategies/index.ts` | Runs all strategy functions, filters nulls. | `runAllStrategies(snapshot)` | Individual strategy files | In: MarketSnapshot → Out: StrategySignalCandidate[] |
| `src/strategies/trend-continuation.ts` | Trend continuation logic. | `runTrendContinuation(snapshot)` | None | In: MarketSnapshot → Out: candidate or null |
| `src/strategies/breakout.ts` | Breakout confirmation logic. | `runBreakout(snapshot)` | `services/levels` | In: MarketSnapshot → Out: candidate or null |
| `src/strategies/mean-reversion.ts` | Mean reversion logic. | `runMeanReversion(snapshot)` | None | In: MarketSnapshot → Out: candidate or null |
| `src/scoring/index.ts` | Orchestrates all scoring components. | `applyGlobalScoring(candidate, snapshot)` | All score files | In: candidate+snapshot → Out: scored candidate |
| `src/ranking.ts` | Sorts and selects best candidate. | `rankCandidates(candidates)`, `selectBest(ranked)` | None | In: candidates[] → Out: sorted candidates[] |
| `src/publisher.ts` | Converts to FinalSignal, posts to ingestion API. | `publishSignal(candidate, snapshot)` | `@agoraiq/api` via HTTP | In: candidate+snapshot → Out: HTTP POST |
| `src/explanation.ts` | Human-readable reason translations. | `translateReasonCodes(codes)`, `formatAlertMessage(signal)` | None | In: reason codes → Out: string[] |
| `src/lifecycle.ts` | Optional local tracking (can defer to @agoraiq/tracker). | `trackActiveSignals()` | DB | In: active signals → Out: updated statuses |
| `src/learning.ts` | Nightly expectancy update job. | `nightlyFeedbackJob()` | DB, `services/provider-stats` | In: closed signals → Out: updated expectancy |

---

## 3. Data Flow

Step-by-step sequence, end to end:

```
1. SCHEDULER (index.ts)
   Every 5 minutes, for each symbol in [BTC, ETH, SOL, XRP]:
     for each timeframe in [15m, 1h, 4h]:

2. SNAPSHOT BUILD (snapshot-builder.ts)
   ├── Fetch OHLCV candles (300 bars) from exchange API
   ├── Fetch orderbook snapshot
   ├── Fetch funding rate, OI, liquidation data
   ├── Fetch recent news (last 6h)
   ├── Fetch sentiment (last 6h)
   ├── Compute TA indicators: RSI, MACD, EMA(20/50/200), ATR, Bollinger, VWAP
   ├── Compute orderbook imbalance
   ├── Detect regime (regime-detector.ts)
   └── Return: MarketSnapshot

3. STRATEGY EVALUATION (strategies/index.ts)
   ├── run_trend_continuation(snapshot) → candidate | null
   ├── run_breakout(snapshot) → candidate | null
   ├── run_mean_reversion(snapshot) → candidate | null
   ├── run_event_driven(snapshot) → candidate | null
   ├── run_pullback(snapshot) → null (placeholder)
   └── Filter nulls → valid_candidates[]

4. SCORING (scoring/index.ts)
   For each valid candidate:
   ├── score_technicals → 0..100
   ├── score_market_structure → 0..100
   ├── score_news_context → 0..100
   ├── score_provider_context → 0..100 (from historical expectancy)
   ├── score_risk_penalty → 0..40
   ├── final_score = 0.35*tech + 0.25*mkt + 0.20*news + 0.20*provider - penalty
   ├── confidence = map_score_to_confidence(final_score)
   ├── expected_r = compute_expected_r(candidate)
   └── Append risk flags

5. RANKING (ranking.ts)
   Sort by [final_score, expected_r, news_score, market_structure_score] desc
   Select best candidate

6. PUBLISH GATE (publisher.ts → should_publish)
   ├── confidence != "REJECT"
   ├── final_score >= 65
   ├── expected_r >= 1.3
   └── If passes → continue

7. SIGNAL CREATION (publisher.ts → toFinalSignal)
   Convert candidate to FinalSignal with UUID, timestamps, expiry

8. PUBLISH TO AGORAIQ (publisher.ts → publishSignal)
   POST /api/v1/providers/agoraiq-engine/signals
   Body: { action, symbol, timeframe, score, confidence, price, meta, rawPayload }
   ↓
9. EXISTING INGESTION (@agoraiq/api)
   Signal record created in DB (same as any external provider)
   ↓
10. TRADE CREATION (@agoraiq/api or tracker)
    Trade record created with entry, TP1, TP2, SL
    ↓
11. TRACKER (@agoraiq/tracker)
    Polls live price, updates TP/SL hits, computes R, finalizes outcomes
    ↓
12. DISTRIBUTION
    ├── Dashboard: signal card appears in feed, filterable by provider
    ├── Proof: engine signals appear in proof stream
    └── Telegram: /signals shows engine signals, /providers ranks engine
```

---

## 4. Schema Strategy

### Path A: Minimal-change (use meta/rawPayload)

Post signals to the existing ingestion endpoint. The standard Signal fields get:
- `action`: "BUY" or "SELL"
- `score`: `final_score`
- `confidence`: "HIGH" / "MEDIUM" / "LOW"
- `price`: current price

Rich data goes into `meta`:
```json
{
  "strategyType": "TREND_CONTINUATION",
  "regime": "TRENDING_BULL",
  "entryLow": 87234.50,
  "entryHigh": 87582.10,
  "expectedR": 2.1,
  "technicalScore": 80,
  "marketStructureScore": 65,
  "newsScore": 50,
  "providerScore": 55,
  "riskPenalty": 5,
  "reasonCodes": ["EMA_BULLISH_ALIGNMENT", "RSI_BULLISH_MIDZONE", "MACD_POSITIVE"],
  "riskFlags": [],
  "engineVersion": "1.0.0"
}
```

`rawPayload`: the full MarketSnapshot at signal time (for debugging/audit).

**Pros:** Zero schema changes. Ship in days.
**Cons:** Can't query by strategy, regime, or component scores in SQL. Analytics require JSON parsing.

### Path B: Correct path (new SignalAnalysis table)

```prisma
model SignalAnalysis {
  id                    String    @id @default(cuid())
  signalId              String    @unique
  signal                Signal    @relation(fields: [signalId], references: [id])

  strategyType          String    // TREND_CONTINUATION, BREAKOUT_CONFIRMATION, etc.
  regime                String    // TRENDING_BULL, TRENDING_BEAR, etc.

  entryLow              Float
  entryHigh             Float
  expectedR             Float

  technicalScore        Float
  marketStructureScore  Float
  newsScore             Float
  providerScore         Float
  riskPenalty           Float
  finalScore            Float

  reasonCodes           Json      // string[]
  riskFlags             Json      // string[]

  expiresAt             DateTime

  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@index([strategyType])
  @@index([regime])
  @@index([finalScore])
  @@index([expiresAt])
}
```

Additionally, the learning loop needs:

```prisma
model StrategyExpectancy {
  id            String    @id @default(cuid())
  strategyType  String
  symbol        String
  timeframe     String
  regime        String

  winRate       Float
  avgR          Float
  sampleSize    Int

  updatedAt     DateTime  @updatedAt

  @@unique([strategyType, symbol, timeframe, regime])
}
```

### Recommendation

**Start with Path A. Move to Path B in Phase 3.**

Rationale: Path A lets you ship and validate the engine in production without touching the schema. Once signals are flowing and you confirm the data is useful, add the SignalAnalysis table. The transition is additive — you keep posting to `meta` AND write to the new table, so nothing breaks.

---

## 5. API / Publishing Strategy

### Recommended approach: POST to existing ingestion endpoint

```
POST /api/v1/providers/agoraiq-engine/signals
```

This is the correct first implementation because:
- It reuses all existing validation, storage, trade creation, and tracking logic
- The engine is treated identically to external providers
- No new API routes needed
- Dashboard, proof, and Telegram get engine signals for free

### Payload shape

```typescript
interface EngineSignalPayload {
  action: "BUY" | "SELL";           // mapped from Direction.LONG/SHORT
  symbol: string;                    // "BTCUSDT"
  timeframe: string;                 // "1h"
  score: number;                     // final_score (0-100)
  confidence: string;                // "HIGH" | "MEDIUM" | "LOW"
  price: number;                     // current price at signal time
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  meta: {
    strategyType: string;
    regime: string;
    entryLow: number;
    entryHigh: number;
    expectedR: number;
    technicalScore: number;
    marketStructureScore: number;
    newsScore: number;
    providerScore: number;
    riskPenalty: number;
    reasonCodes: string[];
    riskFlags: string[];
    engineVersion: string;
  };
  rawPayload: Record<string, any>;   // full snapshot for audit
}
```

### Auth / Token approach

Create an internal provider token for `agoraiq-engine` during provider seed. The engine uses this token in the `Authorization` header, same as external providers. Store it in env: `AGORAIQ_ENGINE_TOKEN`.

### Idempotency / Deduplication

Each signal gets a deterministic ID based on: `sha256(symbol + timeframe + strategyType + direction + timestamp_bucket)` where `timestamp_bucket` rounds to the nearest scan interval (5 min). This prevents duplicate signals if the engine runs twice in the same window.

The publisher should check: "Is there already an active/pending signal for this symbol+timeframe+strategy from this provider?" If yes, skip.

### HOLD signals

Do not publish HOLD. The engine only emits BUY or SELL when conditions are met. Absence of a signal is the HOLD. This avoids noise and keeps the signal stream clean.

### What goes into `meta`

Everything from the scoring engine that doesn't fit in the standard Signal columns: strategy type, regime, component scores, reason codes, risk flags, entry zone, expected R, engine version. See payload shape above.

---

## 6. Strategy MVP

### Assets
BTC, ETH, SOL, XRP (4 assets)

### Timeframes
15m, 1h, 4h (3 timeframes)

### Total scans per cycle
4 × 3 = 12 snapshot builds per 5-minute cycle

### First 3 strategies

1. **TREND_CONTINUATION** — Safest starting point. Clear EMA alignment + RSI midzone + MACD confirmation. Well-defined entry/exit. Lowest false positive rate in trending markets.

2. **BREAKOUT_CONFIRMATION** — Captures the biggest moves. Requires volume + orderbook confirmation, which naturally filters noise. Higher R potential (1.5-3.0 ATR targets).

3. **MEAN_REVERSION** — Complements the other two by working in RANGE_CHOP regimes. Bollinger + RSI extreme + sentiment filter. Shorter hold times.

### Publication channels
- Dashboard signal feed
- Telegram `/signals` command

### Score threshold
`final_score >= 70` for MVP (stricter than the 65 floor in the pseudocode). This ensures only medium-high and high confidence signals publish during validation.

### Expected signal volume
With score >= 70 and expected_r >= 1.3, expect roughly 2-8 signals per day across 4 assets. This is a feature, not a bug — quality over quantity while validating.

---

## 7. Scoring Model Implementation

### technical_score (weight: 0.35)

```
score = 0
IF direction == LONG:
  price > EMA50        → +20
  EMA50 > EMA200       → +20
  RSI in [50, 68]      → +20
  MACD histogram > 0   → +20
  price > VWAP         → +20
IF direction == SHORT:
  price < EMA50        → +20
  EMA50 < EMA200       → +20
  RSI in [32, 50]      → +20
  MACD histogram < 0   → +20
  price < VWAP         → +20
RETURN clamp(score, 0, 100)
```

Each condition is binary (0 or 20). Max score = 100. This is intentionally simple — five clean checks, each worth equal weight.

### market_structure_score (weight: 0.25)

```
score = 0
IF direction == LONG:
  orderbook imbalance > 0.10    → +25
  OI change % > 0               → +20
  funding rate in [-0.01, 0.02] → +20
  volume > confirmation thresh  → +20
  short liquidations elevated   → +15
IF direction == SHORT:
  orderbook imbalance < -0.10   → +25
  OI change % > 0               → +20
  funding rate in [-0.02, 0.01] → +20
  volume > confirmation thresh  → +20
  long liquidations elevated    → +15
RETURN clamp(score, 0, 100)
```

### news_score (weight: 0.20)

```
score = 50  // neutral baseline
IF direction == LONG:
  score += news_event_score * 25
  score += sentiment_score * 20
  score += source_credibility * 10
IF direction == SHORT:
  score -= news_event_score * 25
  score -= sentiment_score * 20
  score += source_credibility * 10
RETURN clamp(score, 0, 100)
```

Starts at 50 (neutral). Positive news boosts longs, negative news boosts shorts. Source credibility always adds.

### provider_score (weight: 0.20)

```
stats = get_setup_expectancy(symbol, timeframe, strategy, regime)
IF stats is null: RETURN 50  // no history yet

score  = normalize(stats.win_rate, 0, 1) * 40
score += normalize(stats.avg_r, -1, 3) * 35
score += normalize(stats.sample_size, 0, 200) * 25
RETURN clamp(score, 0, 100)
```

Returns 50 when no historical data exists. As the engine accumulates outcomes, this score self-calibrates.

### risk_penalty (subtracted from weighted sum)

```
penalty = 0
atr_pct = ATR / price
IF atr_pct > 0.04:       penalty += 10
IF regime == LOW_LIQ:     penalty += 15
IF LONG and funding > 0.05:  penalty += 10, flag CROWDED_LONGS
IF SHORT and funding < -0.05: penalty += 10, flag CROWDED_SHORTS
IF |news_event| > 0.80 and regime == HIGH_VOL: penalty += 5, flag EVENT_SHOCK
RETURN penalty  // max realistic ~40
```

### final_score

```
final_score = (0.35 * technical_score)
            + (0.25 * market_structure_score)
            + (0.20 * news_score)
            + (0.20 * provider_score)
            - risk_penalty
```

Range: roughly 0 to 100 (penalty can push below 0 in extreme cases, but clamp if needed).

### Confidence bands

```
score >= 80 → "HIGH"
score >= 65 → "MEDIUM"
score >= 50 → "LOW"
score < 50  → "REJECT" (never published)
```

---

## 8. Existing Package Touchpoints

### @agoraiq/api
- **Untouched (Phase 1):** The engine posts to the existing provider ingestion endpoint. No new routes.
- **Phase 2 modification:** Add optional query params to signal list endpoint: `?provider=agoraiq-engine&strategy=TREND_CONTINUATION&regime=TRENDING_BULL`. These filter on `meta` fields.
- **Phase 3 modification:** Add routes for `/signals/rankings`, `/signals/performance`, `/market/regime` that query the SignalAnalysis table.

### @agoraiq/tracker
- **Untouched (all phases).** The tracker resolves signals by polling price against entry/TP/SL. It doesn't care who generated the signal. Engine signals flow through identically.

### @agoraiq/telegram
- **Untouched (Phase 1).** Engine signals appear in `/signals` automatically because they're standard Signal records.
- **Phase 2 modification:** Format engine signals with richer detail (strategy type, regime tag, confidence breakdown) using the `meta` fields.

### Prisma / DB layer
- **Phase 1:** No changes. Engine writes via HTTP.
- **Phase 3:** Add `SignalAnalysis` and `StrategyExpectancy` models.

### Provider records
- **Phase 1:** Seed a Provider record: `{ slug: "agoraiq-engine", providerType: "SIGNAL", isVerified: true, analyticsEligible: true }`.

### Proof / Dashboard routes
- **Phase 1:** Engine signals appear in the normal feed. Filter by provider slug to show "AgoraIQ Engine" tab.
- **Phase 2:** Add strategy filters, confidence breakdowns, regime tags.
- **Phase 3:** Add engine-specific proof analytics: strategy-by-strategy outcomes, regime-by-regime win rates.

---

## 9. Migration Plan

### Phase 1 — Ship the skeleton (Week 1-2)

- Create Provider record: `agoraiq-engine`
- Build `packages/signal-engine/` with:
  - Snapshot builder (exchange data only, no news initially)
  - 3 strategies: trend continuation, breakout, mean reversion
  - Scoring engine (technical + market structure; news/provider default to 50)
  - Publisher: POST to existing ingestion endpoint
- Scan BTC, ETH on 1h timeframe only
- Score threshold: 70
- Deploy as a standalone worker (cron job or long-running process)
- Output: signals appearing in dashboard and Telegram

### Phase 2 — Enrich and expand (Week 3-4)

- Add SOL, XRP
- Add 15m, 4h timeframes
- Integrate news and sentiment data sources
- Improve scoring with real news_score and provider_score
- Add richer `meta` fields
- Format engine signals with strategy/regime labels in Telegram
- Add provider filter to dashboard
- Add event-driven strategy

### Phase 3 — Dedicated schema (Week 5-6)

- Add `SignalAnalysis` Prisma model + migration
- Write to SignalAnalysis alongside meta
- Add strategy/regime filters to dashboard
- Add engine proof analytics page
- Add ranked opportunities endpoint
- Lower score threshold to 65 once signal quality is validated

### Phase 4 — Learning loop (Week 7-8)

- Implement nightly feedback job
- Add `StrategyExpectancy` table
- Provider score uses real historical data
- Add regime analytics to dashboard
- Add first-party performance reporting
- Begin pullback strategy development

---

## 10. Risks and Failure Modes

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Duplicate signal creation** | Noisy feed, inflated stats | Deterministic signal ID from `sha256(symbol+tf+strategy+direction+time_bucket)`. Dedup check before publish. |
| **Noisy signals** | User trust erosion | Start with score >= 70 threshold. Only 3 well-tested strategies. Expand after validation period. |
| **Weak schema fit** | Can't query signal intelligence | Acceptable in Phase 1 (everything in meta). Mitigated by Phase 3 dedicated table. |
| **Analytics fragmentation** | Two sources of truth (meta vs table) | Phase 3 writes to both. Eventually deprecate meta for analytics, keep for backward compat. |
| **Data source reliability** | No snapshot → no signals | Null-check at snapshot build. If exchange API fails, skip cycle. Alert on consecutive failures. |
| **Overcoupling to Binance** | Single point of failure for price data | Abstract market data service behind interface. Add fallback exchange (Bybit, OKX) in Phase 2. |
| **Scoring opacity** | Users don't trust scores | Reason codes + human explanations for every signal. Component score breakdown visible in dashboard. |
| **Dashboard clutter** | Too many signals mixed together | Provider filter. Engine signals tagged distinctly. Separate "AgoraIQ Engine" tab. |
| **TA library accuracy** | Incorrect indicator values → bad signals | Use battle-tested library (technicalindicators npm). Validate against TradingView for first 100 signals. |
| **Rate limiting on exchange APIs** | Throttled during high-vol periods | Cache candles with 1-min TTL. Batch orderbook/funding requests. Respect rate limits with exponential backoff. |

---

## 11. Final Recommendation

**Build first:**
- Snapshot builder with exchange data (OHLCV, funding, OI)
- Trend continuation strategy (simplest, most reliable)
- Technical score + market structure score
- Publisher that POSTs to existing ingestion endpoint
- Deploy for BTC on 1h only

This gives you a working first-party signal in production within days, not weeks.

**Do not overbuild:**
- Do not build the learning loop yet. There's nothing to learn from until you have 30+ closed signals.
- Do not build the SignalAnalysis table yet. Meta works fine for launch.
- Do not build all 5 strategies. Start with 1, validate, add more.
- Do not build custom dashboard UI yet. The engine signals appear in the existing feed.

**Can be deferred:**
- News/sentiment integration (default to neutral scores)
- Provider score (default to 50 until history exists)
- Event-driven strategy (needs news pipeline)
- Pullback strategy (placeholder)
- Lifecycle tracking (let @agoraiq/tracker handle it)
- Regime analytics dashboard

**Fastest path to working first-party engine:**

1. Seed provider record → 5 minutes
2. Build snapshot from Binance OHLCV + funding → 2 hours
3. Implement trend continuation strategy → 1 hour
4. Implement technical + market structure scoring → 2 hours
5. Build publisher with HTTP POST → 1 hour
6. Wire up scheduler → 30 minutes
7. Deploy → live first-party signals

Total: **one focused engineering day** to first signal in production.
