# AgoraIQ Telegram Bot — Implementation Spec

**Version:** 1.0  
**Date:** 2026-03-03  
**Status:** Implementation-ready  

---

## A. Architecture Overview

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                      TELEGRAM CLOUD                          │
│  Users ←→ Bot API ←→ Webhook endpoint                       │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS (webhook)
┌──────────────────────────▼──────────────────────────────────┐
│              TELEGRAM BOT SERVICE (Node.js / Telegraf)        │
│  • Webhook receiver                                          │
│  • Menu state machine (inline keyboards)                     │
│  • API client → calls AgoraIQ API                            │
│  • Stateless, horizontally scalable                          │
└──────────────────────────┬──────────────────────────────────┘
                           │ Internal HTTP (bearer token)
┌──────────────────────────▼──────────────────────────────────┐
│              AGORAIQ API (FastAPI — existing + new routes)    │
│  • /api/telegram/*  — bot-facing endpoints                   │
│  • /internal/telegram/*  — worker-only endpoints             │
│  • Auth middleware (JWT for web, API-key for bot/worker)      │
│  • Entitlement checks on every premium action                │
└────────┬───────────────────────────────┬────────────────────┘
         │                               │
    ┌────▼────┐                   ┌──────▼───────┐
    │ PostgreSQL│                  │ Redis/BullMQ │
    │ (source   │                  │ (job queue)  │
    │  of truth)│                  └──────┬───────┘
    └─────────┘                          │
                              ┌──────────▼──────────┐
                              │ RECONCILER WORKER    │
                              │ • Cron: nightly full │
                              │ • Event: on entitle- │
                              │   ment change        │
                              │ • Cleanup expired    │
                              │   invites            │
                              └─────────────────────┘
```

### Trust Boundaries

| Boundary | Enforcement |
|---|---|
| Telegram → Bot Service | Telegram webhook secret verification |
| Bot Service → AgoraIQ API | Internal API key in `Authorization` header |
| Web browser → AgoraIQ API | JWT (existing auth) |
| Worker → AgoraIQ API | Internal API key + source IP allowlist |
| AgoraIQ API → Telegram Bot API | `TELEGRAM_BOT_TOKEN` (server-side only) |

### Data Flow

1. **Linking:** Bot generates code → user opens web link → web confirms code → DB stores mapping.
2. **Join Source:** Bot calls `/api/telegram/invite` → API checks entitlement → mints invite link → bot sends to user → audit logged.
3. **Revocation:** Stripe webhook fires → entitlement updated → reconcile job enqueued → worker calls Telegram `banChatMember` / `unbanChatMember` for clean removal.
4. **Proof:** Bot calls `/api/telegram/signals/latest` → renders inline card → "View Proof" button deep-links to `app.agoraiq.net/proof/{signalId}`.

---

## B. Data Model

### Prisma-style Models (PostgreSQL)

```prisma
model TelegramAccount {
  id              String   @id @default(uuid())
  telegramUserId  BigInt   @unique
  telegramUsername String?
  userId          String   @unique  // FK → User
  linkedAt        DateTime @default(now())
  lastSeenAt      DateTime @default(now())
  flags           Json     @default("{}")
  
  user            User     @relation(fields: [userId], references: [id])
  invites         TelegramInvite[]
  memberships     TelegramMembership[]
  
  @@index([telegramUserId])
  @@index([userId])
}

model TelegramLinkCode {
  id           String    @id @default(uuid())
  code         String    @unique  // 8-char alphanumeric
  telegramUserId BigInt
  telegramUsername String?
  expiresAt    DateTime
  usedAt       DateTime?
  usedByUserId String?
  createdAt    DateTime  @default(now())
  
  @@index([code])
  @@index([telegramUserId])
}

model TelegramSource {
  id              String   @id @default(uuid())
  name            String
  telegramChatId  BigInt   @unique
  telegramUsername String?
  category        String   // 'crypto_signals' | 'forex' | 'news_intel' | 'education' | 'collections'
  tags            String[] @default([])
  tierMin         String   @default("FREE")  // 'FREE' | 'PRO' | 'ELITE'
  status          String   @default("active") // 'active' | 'paused' | 'archived'
  sortOrder       Int      @default(0)
  providerId      String?
  description     String?
  memberCount     Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  invites         TelegramInvite[]
  memberships     TelegramMembership[]
  
  @@index([category, status])
  @@index([tierMin])
}

model TelegramInvite {
  id              String    @id @default(uuid())
  telegramAccountId String
  sourceId        String
  inviteLink      String
  expiresAt       DateTime
  usedAt          DateTime?
  revokedAt       DateTime?
  revokeReason    String?
  createdAt       DateTime  @default(now())
  
  account         TelegramAccount @relation(fields: [telegramAccountId], references: [id])
  source          TelegramSource  @relation(fields: [sourceId], references: [id])
  
  @@index([telegramAccountId])
  @@index([sourceId])
  @@index([expiresAt])
}

model TelegramMembership {
  id              String    @id @default(uuid())
  telegramAccountId String
  sourceId        String
  joinedAt        DateTime  @default(now())
  removedAt       DateTime?
  removeReason    String?
  status          String    @default("active") // 'active' | 'removed' | 'left'
  
  account         TelegramAccount @relation(fields: [telegramAccountId], references: [id])
  source          TelegramSource  @relation(fields: [sourceId], references: [id])
  
  @@unique([telegramAccountId, sourceId])
  @@index([status])
}

model TelegramAuditLog {
  id              String   @id @default(uuid())
  action          String   // 'link' | 'unlink' | 'invite_created' | 'invite_used' | 
                           // 'invite_revoked' | 'join_attempt' | 'member_removed' |
                           // 'source_paused' | 'admin_action'
  actorType       String   // 'user' | 'bot' | 'worker' | 'admin'
  actorId         String?
  targetType      String?  // 'telegram_account' | 'source' | 'invite'
  targetId        String?
  metadata        Json     @default("{}")
  createdAt       DateTime @default(now())
  
  @@index([action, createdAt])
  @@index([actorId])
  @@index([targetId])
}

model Referral {
  id              String   @id @default(uuid())
  referrerUserId  String
  referredUserId  String?
  referralCode    String   @unique
  rewardType      String   @default("free_days") // 'free_days' | 'discount_pct'
  rewardValue     Int      @default(7)
  status          String   @default("pending") // 'pending' | 'claimed' | 'expired'
  claimedAt       DateTime?
  expiresAt       DateTime
  createdAt       DateTime @default(now())
  
  @@index([referrerUserId])
  @@index([referralCode])
}
```

---

## C. API Endpoints

### Bot-facing Endpoints

#### `POST /api/telegram/link/start`

Generates a one-time link code for a Telegram user.

**Headers:** `Authorization: Bearer <INTERNAL_API_KEY>`

**Request:**
```json
{
  "telegram_user_id": 123456789,
  "telegram_username": "frederic"
}
```

**Response (200):**
```json
{
  "code": "AQ7X9K2M",
  "link_url": "https://app.agoraiq.net/telegram/link?code=AQ7X9K2M",
  "expires_at": "2026-03-03T15:30:00Z"
}
```

**Errors:** `429 RATE_LIMITED` (max 3 codes/hour/user)

---

#### `POST /api/telegram/link/confirm`

Called by the web app when user confirms the link.

**Headers:** `Authorization: Bearer <JWT>` (web user session)

**Request:**
```json
{
  "code": "AQ7X9K2M"
}
```

**Response (200):**
```json
{
  "linked": true,
  "telegram_user_id": 123456789,
  "telegram_username": "frederic",
  "tier": "PRO",
  "expires_at": "2026-04-03T00:00:00Z"
}
```

**Errors:** `400 CODE_EXPIRED`, `400 CODE_ALREADY_USED`, `404 CODE_NOT_FOUND`, `409 ALREADY_LINKED`

---

#### `GET /api/telegram/me`

Returns linked status and entitlement info for a Telegram user.

**Headers:** `Authorization: Bearer <INTERNAL_API_KEY>`  
**Query:** `?telegram_user_id=123456789`

**Response (200 — linked):**
```json
{
  "linked": true,
  "user_id": "usr_abc123",
  "tier": "PRO",
  "tier_expires_at": "2026-04-03T00:00:00Z",
  "telegram_username": "frederic",
  "linked_at": "2026-03-01T10:00:00Z",
  "referral_code": "AQREF-FR3D",
  "referral_count": 3,
  "preferences": {
    "notifications_enabled": true,
    "followed_providers": ["prov_001", "prov_002"]
  }
}
```

**Response (200 — not linked):**
```json
{
  "linked": false
}
```

---

#### `GET /api/telegram/sources`

Returns the source registry filtered by entitlement.

**Headers:** `Authorization: Bearer <INTERNAL_API_KEY>`  
**Query:** `?telegram_user_id=123456789&category=crypto_signals&page=1&per_page=10`

**Response (200):**
```json
{
  "sources": [
    {
      "id": "src_001",
      "name": "Alpha Crypto Calls",
      "category": "crypto_signals",
      "tags": ["BTC", "ETH", "swing"],
      "tier_min": "FREE",
      "locked": false,
      "member_count": 1240,
      "provider_id": "prov_001",
      "description": "Daily swing trade setups on major pairs"
    },
    {
      "id": "src_002",
      "name": "Whale Moves Premium",
      "category": "crypto_signals",
      "tags": ["whale", "onchain"],
      "tier_min": "PRO",
      "locked": true,
      "member_count": 320,
      "provider_id": "prov_003",
      "description": "On-chain whale movement alerts"
    }
  ],
  "total": 24,
  "page": 1,
  "per_page": 10
}
```

---

#### `POST /api/telegram/invite`

Mints a per-user expiring invite link for a source.

**Headers:** `Authorization: Bearer <INTERNAL_API_KEY>`

**Request:**
```json
{
  "telegram_user_id": 123456789,
  "source_id": "src_001"
}
```

**Response (200):**
```json
{
  "invite_link": "https://t.me/+aBcDeFgHiJk",
  "expires_at": "2026-03-03T15:30:00Z",
  "source_name": "Alpha Crypto Calls"
}
```

**Errors:**
- `403 NOT_LINKED` — Telegram account not linked
- `403 ENTITLEMENT_EXPIRED` — Subscription expired or tier too low
- `403 SOURCE_LOCKED` — Source requires higher tier
- `403 SOURCE_PAUSED` — Source temporarily unavailable
- `429 RATE_LIMITED` — Max 5 invites/hour/user

---

#### `GET /api/telegram/signals/latest`

**Headers:** `Authorization: Bearer <INTERNAL_API_KEY>`  
**Query:** `?telegram_user_id=123456789&provider_id=prov_001&limit=5`

**Response (200):**
```json
{
  "signals": [
    {
      "signal_id": "sig_20260303_001",
      "provider_id": "prov_001",
      "provider_name": "Alpha Crypto Calls",
      "pair": "BTC/USDT",
      "direction": "LONG",
      "entry": "67,250.00",
      "stop_loss": "66,100.00",
      "targets": ["68,500.00", "69,800.00", "71,000.00"],
      "trust_score": 82,
      "status": "active",
      "created_at": "2026-03-03T12:15:00Z",
      "proof_url": "https://app.agoraiq.net/proof/sig_20260303_001"
    }
  ]
}
```

---

#### `GET /api/telegram/signals/:id/card`

**Response (200):**
```json
{
  "signal_id": "sig_20260303_001",
  "provider_name": "Alpha Crypto Calls",
  "pair": "BTC/USDT",
  "direction": "LONG",
  "entry": "67,250.00",
  "stop_loss": "66,100.00",
  "targets": ["68,500.00", "69,800.00", "71,000.00"],
  "trust_score": 82,
  "status": "active",
  "pnl_percent": "+3.2%",
  "duration": "4h 22m",
  "proof_url": "https://app.agoraiq.net/proof/sig_20260303_001",
  "analytics_url": "https://app.agoraiq.net/analytics/sig_20260303_001",
  "provider_url": "https://app.agoraiq.net/providers/prov_001"
}
```

---

#### `GET /api/telegram/providers/:id/summary`

**Response (200):**
```json
{
  "provider_id": "prov_001",
  "name": "Alpha Crypto Calls",
  "trust_score": 82,
  "total_signals": 347,
  "win_rate": 68.5,
  "avg_pnl_percent": 4.2,
  "avg_duration": "6h 15m",
  "monthly_breakdown": [
    { "month": "2026-01", "signals": 42, "win_rate": 71.4, "avg_pnl": 5.1 },
    { "month": "2026-02", "signals": 38, "win_rate": 65.8, "avg_pnl": 3.8 }
  ],
  "provider_url": "https://app.agoraiq.net/providers/prov_001"
}
```

---

#### `POST /api/telegram/prefs`

**Request:**
```json
{
  "telegram_user_id": 123456789,
  "notifications_enabled": true,
  "followed_providers": ["prov_001", "prov_002"]
}
```

**Response (200):**
```json
{ "updated": true }
```

---

### Worker-only Endpoints

#### `POST /internal/telegram/reconcile`

**Headers:** `Authorization: Bearer <WORKER_API_KEY>`

**Request:**
```json
{
  "user_id": "usr_abc123",
  "reason": "subscription_changed"
}
```

**Response (200):**
```json
{
  "actions_taken": [
    { "source_id": "src_002", "action": "removed", "reason": "tier_downgraded" }
  ]
}
```

---

#### `POST /internal/telegram/revokeExpired`

No body. Runs as cron. Returns count of revoked memberships.

---

#### `POST /internal/telegram/resyncMemberships`

No body. Full nightly reconciliation. Returns summary stats.

---

## D. Bot UX Flow

### State Diagram

```
                    ┌──────────┐
                    │  /start  │
                    └────┬─────┘
                         │
                   ┌─────▼──────┐
                   │ Check Link │
                   └──┬──────┬──┘
                      │      │
              Unlinked│      │Linked
                      │      │
            ┌─────────▼─┐  ┌─▼────────────┐
            │UNLINKED    │  │ MAIN MENU    │
            │MENU        │  │              │
            │            │  │ [📡 Sources] │
            │[🔗 Link]  │  │ [📊 Signals] │
            │[🆓 Trial] │  │ [👤 Account] │
            │[💎 Plans] │  │ [💬 Support] │
            │[💬 Help]  │  └──┬──┬──┬──┬──┘
            └────────────┘     │  │  │  │
                               │  │  │  │
          ┌────────────────────┘  │  │  └──────────────┐
          │                       │  │                  │
    ┌─────▼──────┐        ┌──────▼──┐  ┌──────▼───┐  ┌─▼────────┐
    │ SOURCES    │        │ SIGNALS │  │ ACCOUNT  │  │ SUPPORT  │
    │            │        │         │  │          │  │          │
    │ Categories:│        │ Latest  │  │ Info     │  │ FAQ      │
    │ • Crypto   │        │ Search  │  │ Tier     │  │ Contact  │
    │ • Forex    │        │ Followed│  │ Prefs    │  │ Report   │
    │ • News     │        │         │  │ Unlink   │  │          │
    │ • Education│        │         │  │ Referrals│  │          │
    │ • Premium  │        └─────────┘  └──────────┘  └──────────┘
    └─────┬──────┘
          │
    ┌─────▼──────┐
    │SOURCE LIST │
    │ [Join]     │
    │ [🔒 Locked]│
    │ [◀ Back]   │
    └─────┬──────┘
          │ (if entitled)
    ┌─────▼──────┐
    │INVITE SENT │
    │ Link + exp │
    │ [◀ Back]   │
    └────────────┘
```

### Button Labels (exact)

**Unlinked Menu:**
- `🔗 Link Account`
- `🆓 Start Trial`
- `💎 View Plans`
- `💬 Get Help`

**Main Menu (linked):**
- `📡 Join Sources`
- `📊 Signals & Proof`
- `👤 My Account`
- `💬 Support`

**Sources — Category Selector:**
- `🪙 Crypto Signals`
- `💱 Forex`
- `📰 News & Intel`
- `🎓 Education`
- `⭐ Premium Collections`
- `◀ Back`

**Source List Item (unlocked):**
- `✅ Join — {source_name}`

**Source List Item (locked):**
- `🔒 {source_name} (requires {tier})`

**Source List Navigation:**
- `◀ Prev` / `▶ Next`
- `◀ Back to Categories`

**Signals Menu:**
- `📋 Latest Signals`
- `🔍 Search by ID`
- `⭐ Followed Providers`
- `◀ Back`

**Signal Card Buttons:**
- `🔎 View Proof`
- `📈 Provider Stats`
- `📅 Monthly Breakdown`
- `⏱ Duration Analytics`
- `◀ Back`

**Account Menu:**
- `ℹ️ Account Info`
- `💎 Subscription`
- `🔔 Notifications`
- `🔗 Referral Code`
- `🚪 Unlink Telegram`
- `◀ Back`

**Support Menu:**
- `❓ FAQ`
- `📩 Contact Support`
- `⚠️ Report Provider`
- `◀ Back`

---

## E. Security Plan

### Invite Expiry & Rate Limits

| Control | Value |
|---|---|
| Link code expiry | 10 minutes |
| Invite link expiry | 30 minutes |
| Max link code requests | 3/hour/telegram_user |
| Max invite requests | 5/hour/user |
| Max concurrent active invites per source | 1/user |

### Invite Binding & Reconciliation

1. **Invite links are bound to `telegram_user_id`**: The API records which user requested which invite. If someone else uses the link (detectable via `chat_member` updates), the unauthorized joiner is flagged.
2. **Reconciliation kicks**: The worker queries Telegram `getChatMember` for each membership record. If the user's entitlement no longer covers the source's `tier_min`, the worker calls `banChatMember` (then `unbanChatMember` to allow re-join if they re-subscribe).
3. **Invite revocation**: Expired invites are cleaned up by the worker. The API also calls `revokeChatInviteLink` on Telegram.

### Abuse Detection Signals

| Signal | Action |
|---|---|
| User requests >10 invites/day | Flag + temporary soft-block |
| Invite used by different telegram_user_id | Revoke invite, kick unauthorized, alert admin |
| Same IP / device links multiple Telegram accounts | Flag for manual review |
| User unlinks + re-links repeatedly (>3x/week) | Rate-limit link generation |
| Membership without corresponding invite record | Auto-kick via reconciler |

### Error Codes

All bot-facing endpoints return structured errors:

```json
{
  "error": "ENTITLEMENT_EXPIRED",
  "message": "Your subscription has expired. Renew at app.agoraiq.net/billing",
  "action_url": "https://app.agoraiq.net/billing"
}
```

Codes: `NOT_LINKED`, `ENTITLEMENT_EXPIRED`, `SOURCE_LOCKED`, `SOURCE_PAUSED`, `RATE_LIMITED`, `CODE_EXPIRED`, `CODE_ALREADY_USED`, `ALREADY_LINKED`, `INVITE_LIMIT_REACHED`

---

## F. Implementation Scaffolding

**Runtime:** Node.js + TypeScript (Telegraf v4)

**Justification:** Telegraf is the most mature Telegram bot framework for Node.js, has excellent TypeScript support, built-in webhook handling, and session middleware. Since the AgoraIQ API is FastAPI (Python), the bot service being in Node.js keeps it as a clean, separate service — a true thin client. This also allows the team to use the same language (TS) for both the bot and the React frontend.

### Folder Structure

```
agoraiq-telegram-bot/
├── services/
│   └── telegram-bot/
│       ├── src/
│       │   ├── index.ts              # Entry point + webhook setup
│       │   ├── bot.ts                # Telegraf instance + middleware
│       │   ├── handlers/
│       │   │   ├── start.ts          # /start command
│       │   │   ├── link.ts           # Linking flow
│       │   │   └── callback.ts       # Inline keyboard callback router
│       │   ├── menus/
│       │   │   ├── main.ts           # Main menu (linked)
│       │   │   ├── unlinked.ts       # Unlinked menu
│       │   │   ├── sources.ts        # Sources browser
│       │   │   ├── signals.ts        # Signals & proof
│       │   │   ├── account.ts        # Account management
│       │   │   └── support.ts        # Support & FAQ
│       │   ├── middleware/
│       │   │   ├── auth.ts           # Check linked status
│       │   │   └── rateLimit.ts      # Per-user rate limiting
│       │   ├── utils/
│       │   │   ├── api.ts            # AgoraIQ API client
│       │   │   ├── keyboard.ts       # Keyboard builder helpers
│       │   │   └── format.ts         # Message formatting
│       │   └── config/
│       │       └── env.ts            # Environment config
│       ├── package.json
│       ├── tsconfig.json
│       └── Dockerfile
├── packages/
│   └── api/
│       └── src/
│           ├── routes/
│           │   └── telegram.py       # All /api/telegram/* routes
│           ├── controllers/
│           │   └── telegram.py       # Business logic
│           ├── middleware/
│           │   └── bot_auth.py       # API key verification
│           ├── models/
│           │   └── telegram.py       # SQLAlchemy/Prisma models
│           └── services/
│               ├── invite.py         # Invite generation + Telegram API calls
│               ├── linking.py        # Link code management
│               └── entitlement.py    # Entitlement checks
├── workers/
│   └── telegram-reconciler/
│       └── src/
│           ├── index.ts              # Worker entry (BullMQ)
│           ├── jobs/
│           │   ├── reconcileUser.ts
│           │   ├── nightlyReconcile.ts
│           │   └── cleanupInvites.ts
│           └── config/
│               └── env.ts
├── .env.example
└── SPEC.md
```

See the individual code files in this repository for the full scaffolding.

---

## G. Deployment Plan

### Environment Variables

```bash
# Bot Service
TELEGRAM_BOT_TOKEN=           # From @BotFather
TELEGRAM_WEBHOOK_SECRET=      # Random string for webhook verification
AGORAIQ_API_URL=https://app.agoraiq.net/api
AGORAIQ_INTERNAL_API_KEY=     # Shared secret for bot → API auth
BOT_WEBHOOK_DOMAIN=https://bot.agoraiq.net
BOT_WEBHOOK_PATH=/webhook
PORT=3100

# API (additions to existing .env)
TELEGRAM_BOT_TOKEN=           # Same token — API needs it to mint invite links
TELEGRAM_INTERNAL_API_KEY=    # Same shared secret — API validates it
TELEGRAM_WORKER_API_KEY=      # Separate key for worker → API

# Worker
REDIS_URL=redis://localhost:6379
AGORAIQ_API_URL=https://app.agoraiq.net
AGORAIQ_WORKER_API_KEY=
RECONCILE_CRON=0 3 * * *     # Nightly at 3 AM
INVITE_CLEANUP_CRON=*/30 * * * *  # Every 30 minutes
```

### Webhook Setup Steps

```bash
# 1. Set webhook via Telegram API
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://bot.agoraiq.net/webhook",
    "secret_token": "<WEBHOOK_SECRET>",
    "allowed_updates": ["message", "callback_query", "chat_member"],
    "drop_pending_updates": true
  }'

# 2. Verify
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

### systemd Service Templates

```ini
# /etc/systemd/system/agoraiq-telegram-bot.service
[Unit]
Description=AgoraIQ Telegram Bot Service
After=network.target

[Service]
Type=simple
User=agoraiq
WorkingDirectory=/opt/agoraiq/services/telegram-bot
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
EnvironmentFile=/opt/agoraiq/services/telegram-bot/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/agoraiq-telegram-reconciler.service
[Unit]
Description=AgoraIQ Telegram Reconciler Worker
After=network.target redis.service

[Service]
Type=simple
User=agoraiq
WorkingDirectory=/opt/agoraiq/workers/telegram-reconciler
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
EnvironmentFile=/opt/agoraiq/workers/telegram-reconciler/.env

[Install]
WantedBy=multi-user.target
```

### Monitoring & Alerts Checklist

| Metric | Alert Threshold | Channel |
|---|---|---|
| Bot webhook response time | p95 > 2s | Slack/PagerDuty |
| Bot error rate (5xx from API) | > 5% over 5 min | Slack |
| Reconciler job failure | Any failure | Slack + email |
| Invite generation rate | > 100/min (spam) | Slack |
| Unmatched memberships (join without invite) | Any | Admin Telegram alert |
| Link code generation errors | > 10/hour | Slack |
| Webhook delivery failures (Telegram retries) | > 3 consecutive | Slack |
| Redis queue depth | > 1000 pending jobs | Slack |
| DB connection pool exhaustion | > 80% pool used | PagerDuty |
