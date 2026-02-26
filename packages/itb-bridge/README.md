# ITB → AgoraIQ Bridge

Drop-in integration for [Intelligent Trading Bot](https://github.com/intelligent-trading-bot) to forward signals to AgoraIQ in real time.

## Quick Setup

### 1. Copy the plugin into ITB

```bash
cp notifier_agoraiq.py  /path/to/intelligent-trading-bot/outputs/
```

### 2. Register the generator in ITB

Open `common/generators.py` and add inside the `output_feature_set()` function:

```python
elif generator == "notifier_agoraiq":
    from outputs.notifier_agoraiq import send_agoraiq_signal
    generator_fn = send_agoraiq_signal
```

### 3. Add the output set to your ITB config

```jsonc
"output_sets": [
    // ... your existing outputs (score_notification, diagram, trader_simulation) ...

    {"generator": "notifier_agoraiq", "config": {
        "agoraiq_url": "https://YOUR-DOMAIN/api/v1/providers/itb/signals",
        "agoraiq_token": "your-provider-token-from-agoraiq",
        "provider_key": "itb-btc-1h-svc",

        // Signal column mapping (these are ITB defaults)
        "buy_signal_column": "buy_signal_column",
        "sell_signal_column": "sell_signal_column",
        "score_column": "trade_score",

        // Optional: include secondary score
        // "secondary_score_column": "trade_score_2",

        // Optional: include transaction profit data
        "include_transaction": true,

        // Optional: send HOLD signals (default: false, only BUY/SELL)
        "send_holds": false,

        // Band config (copy from your score_notification_model)
        "positive_bands": [
            {"edge": 0.08, "sign": "〉〉〉📈", "text": "BUY ZONE"},
            {"edge": 0.04, "sign": "〉〉", "text": "strong"},
            {"edge": 0.02, "sign": "〉", "text": "weak"}
        ],
        "negative_bands": [
            {"edge": -0.02, "sign": "〈", "text": "weak"},
            {"edge": -0.04, "sign": "〈〈", "text": "strong"},
            {"edge": -0.08, "sign": "〈〈〈📉", "text": "SELL ZONE"}
        ]
    }}
]
```

### 4. Create the provider in AgoraIQ

Register ITB as a provider:

```sql
INSERT INTO providers (id, slug, name, description, proof_category, config)
VALUES (
    'itb-provider-001',
    'itb',
    'Intelligent Trading Bot',
    'ML-based signal generator (SVM/GB/NN)',
    'futures-low',
    '{"webhookSecret": "your-provider-token-from-agoraiq",
      "defaultExchange": "BINANCE_FUTURES",
      "defaultTpPct": 3.0,
      "defaultSlPct": 1.5,
      "defaultTimeoutHours": 72}'
);
```

Or via the AgoraIQ admin API (when available).

## What Gets Sent

Each signal POST includes:

| Field | Example | Notes |
|-------|---------|-------|
| `symbol` | `BTCUSDT` | From ITB config |
| `timeframe` | `1h` | Converted from pandas freq |
| `action` | `BUY` / `SELL` | From signal columns |
| `price` | `97250.00` | Close price at signal time |
| `score` | `0.12` | Confidence [0,1] from abs(trade_score) |
| `ts` | `2026-02-19T14:00:00Z` | Signal timestamp |
| `meta.trade_score` | `+0.12` | Raw signed score [-1,+1] |
| `meta.band_no` | `3` | Band number (positive=buy, negative=sell) |
| `meta.band_sign` | `〉〉〉📈` | Band emoji from config |
| `meta.band_text` | `BUY ZONE` | Band label |
| `meta.close_price` | `97250.00` | Exact close price |
| `meta.open/high/low` | `97100/97500/96800` | OHLC candle data |
| `meta.transaction` | `{status, price, profit}` | If include_transaction=true |
| `meta.description` | `BTCUSDT 1h SVM` | From ITB config |

## Data Visibility

### Public Proof Page (`/proof`)
- ✅ Symbol, timeframe, direction, outcome (win/loss)
- ✅ R-multiple, P&L percentage (after trade closes)
- ❌ No prices, no exact scores, no band details
- ❌ Provider masked after top-3

### Paid Dashboard (`/dashboard`)
- ✅ Everything above, plus:
- ✅ Exact entry/exit prices, TP/SL levels
- ✅ Full score + band details
- ✅ Provider name, signal history
- ✅ CSV export with all fields

### Telegram Bot (paid subscribers)
- ✅ Full signal with score, band, price
- ✅ Watchlist-based alerts
- ✅ Real-time delivery

## Idempotency

Signals are deduplicated by: `provider_key + symbol + timeframe + timestamp`

If ITB sends the same signal twice (e.g., restart), AgoraIQ returns `200 duplicate` and does not create a new record.
