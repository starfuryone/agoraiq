# ITB → AgoraIQ Integration Analysis

## ITB Architecture Summary

Intelligent Trading Bot is a Python ML pipeline:

```
Data Sources (Binance/MT5/Yahoo)
    ↓ collector
Klines DataFrame (OHLCV)
    ↓ feature generation (talib, tsfresh, custom)
Feature Matrix
    ↓ model prediction (SVM, GB, NN, Linear)
Score Columns: high_30_svc, low_30_svc (float [0,1])
    ↓ signal generation (combine + threshold_rule)
trade_score (signed float [-1,+1]) → buy_signal_column / sell_signal_column (bool)
    ↓ output_sets
Three outputs:
  1. score_notification_model → Telegram text (score + band + price)
  2. diagram_notification_model → Telegram chart image
  3. trader_simulation → Transaction file + Telegram profit stats
```

## Signal Data Mapping

| ITB Source | ITB Field | AgoraIQ Field | Proof (Public) | Dashboard (Paid) | Telegram (Paid) |
|------------|-----------|---------------|----------------|------------------|-----------------|
| `config` | `symbol` | `signal.symbol` | ✅ Shown | ✅ Shown | ✅ Shown |
| `config` | `freq` | `signal.timeframe` | ✅ Shown | ✅ Shown | ✅ Shown |
| signal cols | BUY/SELL | `signal.action` | ✅ As direction | ✅ Shown | ✅ Shown |
| last row | `close` | `signal.price` | ❌ Redacted | ✅ Shown | ✅ Pro+ only |
| signal gen | `trade_score` | `signal.meta.trade_score` | ❌ Redacted | ✅ Shown | ✅ Pro+ only |
| band logic | `band_no` | `signal.meta.band_no` | ❌ Redacted | ✅ Shown | ✅ Pro+ only |
| band logic | `band.sign` | `signal.meta.band_sign` | ✅ Partial emoji | ✅ Shown | ✅ Pro+ only |
| band logic | `band.text` | `signal.meta.band_text` | ✅ Strength label | ✅ Shown | ✅ Pro+ only |
| last row | `open/high/low` | `signal.meta.ohlc` | ❌ Redacted | ✅ Shown | ✅ Pro+ only |
| abs(score) | confidence | `signal.confidence` | ❌ Redacted | ✅ Shown | ✅ Starter basic |
| App.transaction | `profit` | `signal.meta.transaction` | ❌ Redacted | ✅ Shown | ❌ Not sent |
| trade resolve | R-multiple | `trade.rMultiple` | ✅ After close | ✅ Shown | ✅ Shown |
| trade resolve | P&L % | `trade.pnlPct` | ✅ After close | ✅ Shown | ✅ Shown |
| Provider | name | `provider.name` | ⚠️ Top 3 only | ✅ Shown | ✅ Shown |

## Three-Tier Visibility Model

### 1. Public Proof Page (`/proof`)
Shows verifiable performance WITHOUT sensitive signal details:
- ✅ Symbol, timeframe, direction (LONG/SHORT)
- ✅ Trade outcome: HIT_TP / HIT_SL / EXPIRED / ACTIVE
- ✅ R-multiple and P&L % (only after trade closes)
- ✅ Band strength label ("BUY ZONE", "strong") and emoji indicator
- ✅ Provider name (top 3 by rank) or masked ("Provider D")
- ❌ NO entry/exit prices
- ❌ NO exact trade_score values
- ❌ NO TP/SL levels
- ❌ NO OHLC candle data
- ❌ NO provider IDs or API keys
- 🔒 Active trades delayed by 15 minutes
- 🔒 Feed capped at 25 items
- 🔒 Upgrade CTA at bottom of feed

### 2. Paid Dashboard (`/dashboard`)
Full signal intelligence for subscribers:
- ✅ Everything from proof, plus:
- ✅ Exact entry/exit prices, TP/SL levels
- ✅ Full trade_score (signed float with precision)
- ✅ Band number, sign, and text
- ✅ Complete OHLC candle data
- ✅ Transaction profit data
- ✅ Provider name, slug, category
- ✅ Signal history with pagination
- ✅ CSV export with all fields
- ✅ Watchlists and filters

### 3. Telegram Bot (paid subscribers)
Real-time alerts with tier-based detail:
- **Starter tier**: Symbol, timeframe, action, confidence %
- **Pro+ tiers**: Full score, band, price, OHLC, provider
- **All tiers**: Inline buttons to open dashboard, mute symbol

## Signal Lifecycle

```
ITB server loop (every 1min/1h)
    ↓ main_task() → collect → analyze → output_sets
    ↓
notifier_agoraiq.send_agoraiq_signal()
    ↓ Extract: last row, signal columns, score, band, OHLC
    ↓ Build payload (schema v1.1)
    ↓
POST /api/v1/providers/itb/signals
    ↓ Validate (Zod schema)
    ↓ Idempotency check (provider_key+symbol+tf+ts)
    ↓ Create Signal record (immutable, includes meta.trade_score, meta.band_*)
    ↓ Create Trade record (ACTIVE, with TP/SL from provider config)
    ↓ Audit log
    ↓
broadcastSignalAlert()
    ↓ Find users watching this symbol/provider
    ↓ Filter: active subscription + not muted
    ↓ Build tier-appropriate message
    ↓ Send via Telegram bot API

... time passes ...

Tracker service (packages/tracker)
    ↓ Polls price feeds
    ↓ Resolves trade: HIT_TP / HIT_SL / EXPIRED
    ↓ Computes R-multiple, P&L %
    ↓
Proof page updates via SSE stream
Dashboard updates on next page load
```

## Files Modified/Created

### New Files
- `packages/itb-bridge/notifier_agoraiq.py` — ITB output plugin
- `packages/itb-bridge/README.md` — Setup guide
- `packages/itb-bridge/PATCH_GENERATORS.py` — Generator registration

### Modified Files
- `packages/api/src/routes/ingestion.ts` — Extended schema v1.1, ITB meta, Telegram broadcast
- `packages/api/src/routes/proof.ts` — Feed includes signal.meta for ITB enrichment
- `packages/api/src/routes/dashboard.ts` — Full ITB metadata in signal list + detail
- `packages/api/src/services/safe-mode.ts` — Partial ITB data (strength label) in public feed
- `packages/telegram/src/index.ts` — Tier-based alerts with full ITB data for Pro+
- `packages/web/public/proof.html` — Strength badges, locked indicators, upgrade CTA

### Unchanged (compatible as-is)
- `packages/db/prisma/schema.prisma` — Signal.meta (Json) already stores ITB fields
- `packages/tracker/src/index.ts` — Trade resolution unchanged
- `packages/api/src/middleware/*` — Auth and rate limiting unchanged
