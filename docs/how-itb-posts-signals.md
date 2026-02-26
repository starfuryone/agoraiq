# How ITB Posts Signals to AgoraIQ

## Architecture

```
┌──────────┐   HTTP POST    ┌──────────────┐
│   ITB    │ ──────────────→ │  AgoraIQ API │
│ (Python) │  webhook+token  │  (Node.js)   │
└──────────┘                 └──────────────┘
   separate                    /api/v1/providers/itb/signals
   process                     validates → stores → tracks
```

- **ITB runs as a separate service** (separate repo, separate runtime)
- Communication is **webhook-only** via HTTP POST
- No shared code, no shared dependencies
- ITB is just another provider to AgoraIQ

## Endpoint

```
POST https://agoraiq.net/api/v1/providers/itb/signals
```

## Authentication

Header: `X-AgoraIQ-Provider-Token: <value of ITB_PROVIDER_TOKEN from .env>`

## When to Post

- Post when ITB generates an actionable signal (BUY or SELL)
- HOLD signals can be posted but won't create paper trades by default
- Post immediately after signal generation for accurate tracking

## Payload

```json
{
  "schema_version": "1.0",
  "provider_key": "itb-live-01",
  "symbol": "BTCUSDT",
  "timeframe": "5m",
  "action": "BUY",
  "score": 0.72,
  "confidence": 0.72,
  "ts": "2026-02-18T16:21:00.000Z",
  "price": 52341.20,
  "meta": {
    "model_version": "gb_v2",
    "features_used": 14
  }
}
```

## Python Example

See `INSTALL.md` Section 12 for the full `itb_notifier.py` script.

Quick usage:
```python
from itb_notifier import post_signal
post_signal("BTCUSDT", "5m", "BUY", score=0.72, price=52341.20)
```

## What Happens on Ingest

1. AgoraIQ validates the payload schema
2. Checks idempotency key (`itb-live-01:BTCUSDT:5m:<ts>`)
3. Creates a `Signal` record (immutable, stores raw payload for audit)
4. For BUY/SELL: creates a `Trade` record with status `ACTIVE`
   - Calculates TP/SL prices from provider config defaults
   - Sets timeout (default 72 hours)
5. The Tracker Worker later resolves the trade (HIT_TP / HIT_SL / EXPIRED)
6. Results appear in proof page (redacted) and dashboard (full detail)

## Best Practices

- Always include `price` for accurate TP/SL and R-multiple calculation
- Include `model_version` in `meta` for tracking model performance over time
- Use consistent `provider_key` values per ITB instance
- Don't send duplicate signals — idempotency will deduplicate, but it's cleaner to check first
