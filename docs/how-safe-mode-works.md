# How Proof Safe-Mode Works

## Overview

The public proof page shows real, live trading performance data — but with strict filtering to prevent leaking the full trading edge. This is enforced centrally in `packages/api/src/services/safe-mode.ts`.

## Five Layers of Protection

### 1. Delay
- **Closed trades**: shown immediately
- **Active trades**: delayed by `PROOF_ACTIVE_DELAY_MINUTES` (default: 15 min)
- Active trades within the delay window are **completely hidden** from public endpoints

### 2. Redaction
The following fields are **NEVER** returned in public responses:
- `providerId`, `providerKey` — provider identity
- `entryPrice`, `exitPrice`, `tpPrice`, `slPrice`, `tpPct`, `slPct` — exact price levels
- `rawPayload` — original signal data
- `notes`, `meta`, `config` — internal data
- `userId`, `telegramId`, `chatId`, `workspaceId` — user/system identifiers

### 3. Masking
- Top 3 providers by ranking are shown with their **real names**
- All other providers are masked as "Provider D", "Provider E", etc.
- The mask is rebuilt on each request based on current rankings

### 4. Caps
- Stats: last 30 days only
- Monthly table: max 12 months
- Feed: max 25 items
- These are hard limits enforced in `SAFE_MODE_CONFIG`

### 5. Rate Limiting
- IP-based rate limiting: 60 requests/minute per IP
- SSE connection cap: max 100 concurrent connections
- Nginx layer: additional 30 requests/minute burst=10
- All public responses cached for 60 seconds

## Defense in Depth: `assertSafe()`

Every public endpoint calls `assertSafe(data)` before sending the response. This function scans the serialized JSON for any forbidden field names. If a forbidden field is detected, it **throws an error** and returns 500 instead of leaking data.

```typescript
// This will THROW if any forbidden field is found
assertSafe(responseData);
```

## Where Safe-Mode is Enforced

| Layer | File | What it does |
|-------|------|-------------|
| Service | `services/safe-mode.ts` | Redaction, masking, delay, caps, assertSafe |
| Routes | `routes/proof.ts` | Calls safe-mode on every endpoint |
| Middleware | `middleware/rate-limit.ts` | IP rate limiting, SSE connection cap |
| Nginx | `nginx.conf` | Additional rate limiting for `/api/v1/proof/` |
| Cache | `services/cache.ts` | 60s TTL prevents DB hammering |

## Configuration (via .env)

```env
PROOF_ACTIVE_DELAY_MINUTES=15   # Delay for active trades
PROOF_MAX_FEED_ITEMS=25         # Max items in feed endpoint
PROOF_MAX_MONTHS=12             # Max months in monthly table
RATE_LIMIT_PROOF_MAX=60         # Requests per window
RATE_LIMIT_PROOF_WINDOW_MS=60000
SSE_MAX_CONNECTIONS=100
```

## Guarantee

**Public responses will NEVER contain:**
- Provider IDs or keys
- Exact entry/exit prices or TP/SL levels
- Raw signal payloads
- User identifiers
- Workspace IDs

This is enforced at the code level with `assertSafe()` and at the API level with field selection.
