# How to Add a Provider

## 1. Create a Provider Record

Insert into the `providers` table via Prisma or direct SQL:

```sql
INSERT INTO providers (id, slug, name, description, "proofCategory", "isActive", config, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'my-provider',                    -- unique slug (used in webhook URL)
  'My Signal Provider',             -- display name
  'External signal provider',       -- description
  'futures-low',                    -- proof_category: spot | futures-low | futures-high | all
  true,
  '{
    "webhookSecret": "generate-a-secure-random-token",
    "rateLimits": {"maxPerMinute": 60},
    "ipAllowlist": [],
    "defaultExchange": "BINANCE_FUTURES",
    "defaultTpPct": 3.0,
    "defaultSlPct": 1.5,
    "defaultTimeoutHours": 72
  }',
  now(),
  now()
);
```

## 2. Configure Webhook Auth

The provider must include the header on every POST:

```
X-AgoraIQ-Provider-Token: <webhookSecret from config>
```

## 3. Webhook Endpoint

```
POST /api/v1/providers/{slug}/signals
```

Example for slug `my-provider`:
```
POST https://agoraiq.net/api/v1/providers/my-provider/signals
```

## 4. Payload Schema

```json
{
  "schema_version": "1.0",
  "provider_key": "my-provider-instance-01",
  "symbol": "BTCUSDT",
  "timeframe": "5m",
  "action": "BUY",
  "score": 0.72,
  "confidence": 0.72,
  "ts": "2026-02-18T16:21:00.000Z",
  "price": 52341.20,
  "meta": {"model_version": "v1"}
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `schema_version` | Yes | Always "1.0" |
| `provider_key` | Yes | Unique identifier for this provider instance |
| `symbol` | Yes | Trading pair (e.g. BTCUSDT) |
| `timeframe` | Yes | Candle timeframe (1m, 5m, 15m, 1h, 4h, 1d) |
| `action` | Yes | BUY, SELL, or HOLD |
| `score` | No | Signal score 0.0–1.0 |
| `confidence` | No | Confidence level 0.0–1.0 |
| `ts` | Yes | ISO 8601 timestamp of signal |
| `price` | No | Price at signal time (enables TP/SL calculation) |
| `meta` | No | Arbitrary metadata (model version, features, etc.) |

## 5. Idempotency

Signals are deduplicated by: `provider_key + symbol + timeframe + ts`

Sending the same signal twice returns `{"status": "duplicate"}` with HTTP 200.

## 6. Optional IP Allowlist

Add IPs to `config.ipAllowlist` array to restrict access:

```json
{
  "ipAllowlist": ["203.0.113.10", "198.51.100.20"]
}
```

Empty array = allow all IPs.
