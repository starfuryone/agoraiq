# AgoraIQ Signals Tracking Service — Installation Guide

**Target OS:** Ubuntu 22.04 / 24.04 LTS  
**Architecture:** Single-server deployment (API + Web + Tracker + Telegram Bot)

---

## 0) Requirements

| Resource       | Minimum          |
|----------------|------------------|
| CPU            | 2 cores          |
| RAM            | 4 GB (8 GB recommended) |
| Disk           | 20 GB SSD        |
| Domain         | e.g. `agoraiq.net` with DNS pointed to server |
| Ports          | 80, 443 (public), 3000/4000 (internal) |

---

## 1) System Packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential nginx certbot python3-certbot-nginx
```

---

## 2) Install Node.js 20+ and pnpm

```bash
# Node.js 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v  # should show v20.x+

# pnpm
npm install -g pnpm@9
pnpm -v
```

---

## 3) PostgreSQL + Redis

```bash
# PostgreSQL 16
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql

# Create database and user
sudo -u postgres psql << 'EOF'
CREATE USER agoraiq WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE agoraiq OWNER agoraiq;
GRANT ALL PRIVILEGES ON DATABASE agoraiq TO agoraiq;
EOF

# Redis
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
redis-cli ping  # should return PONG
```

---

## 4) Deploy Code

```bash
# Create app directory
sudo mkdir -p /opt/agoraiq
sudo chown $USER:$USER /opt/agoraiq

# Upload and extract the ZIP
# (scp agoraiq-signals-tracking-ready.zip user@server:/opt/agoraiq/)
cd /opt/agoraiq
unzip agoraiq-signals-tracking-ready.zip
```

---

## 5) Configure Environment

```bash
cd /opt/agoraiq
cp .env.example .env
nano .env
```

**Required values to set:**

```env
DATABASE_URL="postgresql://agoraiq:CHANGE_THIS_PASSWORD@localhost:5432/agoraiq?schema=public"
REDIS_URL="redis://localhost:6379"
NODE_ENV="production"
API_PORT=4000
API_BASE_URL="https://agoraiq.net"
CORS_ORIGINS="https://agoraiq.net"
JWT_SECRET="$(openssl rand -hex 32)"
PROOF_WORKSPACE_ID="proof-workspace-default"
ITB_PROVIDER_TOKEN="$(openssl rand -hex 24)"
TELEGRAM_BOT_TOKEN="your-bot-token-from-BotFather"
```

Generate secrets inline:
```bash
# Generate JWT secret
echo "JWT_SECRET=$(openssl rand -hex 32)" 
# Generate ITB provider token
echo "ITB_PROVIDER_TOKEN=$(openssl rand -hex 24)"
```

---

## 6) Install Dependencies + Generate Prisma Client

```bash
cd /opt/agoraiq
pnpm install
pnpm db:generate
```

---

## 7) Database Migrations + Seed

```bash
# Run Prisma migrations
cd /opt/agoraiq/packages/db
npx prisma migrate dev --name init

# Seed ITB provider + admin user
cd /opt/agoraiq
pnpm db:seed
```

Expected output:
```
🌱 Seeding AgoraIQ database...
  ✅ Provider: Intelligent Trading Bot (slug: itb)
  ✅ Admin user: admin@agoraiq.net
  ✅ Subscription: elite (admin)
🎉 Seed complete!
```

---

## 8) Build All Packages

```bash
cd /opt/agoraiq
pnpm build
```

---

## 9) Systemd Services

### 9a) API Server

```bash
sudo tee /etc/systemd/system/agoraiq-api.service << 'EOF'
[Unit]
Description=AgoraIQ API Server
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/agoraiq/packages/api
EnvironmentFile=/opt/agoraiq/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### 9b) Web Server

```bash
sudo tee /etc/systemd/system/agoraiq-web.service << 'EOF'
[Unit]
Description=AgoraIQ Web Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/agoraiq/packages/web
EnvironmentFile=/opt/agoraiq/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### 9c) Tracker Worker

```bash
sudo tee /etc/systemd/system/agoraiq-tracker.service << 'EOF'
[Unit]
Description=AgoraIQ Tracker Worker (Paper Trade Resolver)
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/agoraiq/packages/tracker
EnvironmentFile=/opt/agoraiq/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### 9d) Telegram Bot

```bash
sudo tee /etc/systemd/system/agoraiq-telegram.service << 'EOF'
[Unit]
Description=AgoraIQ Telegram Bot
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/agoraiq/packages/telegram
EnvironmentFile=/opt/agoraiq/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### Enable and start all services

```bash
sudo chown -R www-data:www-data /opt/agoraiq

sudo systemctl daemon-reload
sudo systemctl enable agoraiq-api agoraiq-web agoraiq-tracker agoraiq-telegram
sudo systemctl start agoraiq-api agoraiq-web agoraiq-tracker agoraiq-telegram

# Check status
sudo systemctl status agoraiq-api
sudo systemctl status agoraiq-web
sudo systemctl status agoraiq-tracker
sudo systemctl status agoraiq-telegram

# View logs
sudo journalctl -u agoraiq-api -f
sudo journalctl -u agoraiq-tracker -f
```

---

## 9e) SOCKS5 Proxy (danted — for Binance/Bybit)

The tracker's price service routes Binance and Bybit API calls through a Dante
SOCKS5 proxy running on `143.198.202.65`. Kraken and other exchanges connect
directly (no proxy). This is handled automatically by the `socks-proxy-agent`
package — you just need the proxy server running.

**If danted is already running** on the proxy box, verify:

```bash
# On the proxy box (143.198.202.65)
sudo systemctl status danted

# From the AgoraIQ server, test connectivity through the proxy
curl -x socks5://143.198.202.65:1080 https://api.binance.com/api/v3/ping
# Should return: {}
```

**If you need to install danted** on a fresh Ubuntu box:

```bash
sudo apt install dante-server
```

Edit `/etc/danted.conf`:

```
logoutput: syslog
internal: eth0 port = 1080
external: eth0

# Allow all from your AgoraIQ server IP
clientmethod: none
socksmethod: none

client pass {
    from: YOUR_AGORAIQ_SERVER_IP/32 to: 0.0.0.0/0
}

socks pass {
    from: 0.0.0.0/0 to: 0.0.0.0/0
    protocol: tcp
}
```

```bash
sudo systemctl enable danted
sudo systemctl start danted
```

**Environment variables** (in `.env` on the AgoraIQ server):

```bash
SOCKS_PROXY_URL="socks5://143.198.202.65:1080"
# If Dante is configured with auth:
# SOCKS_PROXY_USERNAME="user"
# SOCKS_PROXY_PASSWORD="pass"
```

**Routing summary:**

| Exchange | Route | Why |
|----------|-------|-----|
| `BINANCE_SPOT` | SOCKS proxy → api.binance.com | Geo-restricted |
| `BINANCE_FUTURES` | SOCKS proxy → fapi.binance.com | Geo-restricted |
| `BYBIT` | SOCKS proxy → api.bybit.com | Geo-restricted |
| `KRAKEN` | Direct | No restriction |

---

## 10) Reverse Proxy + SSL (Nginx)

```bash
sudo tee /etc/nginx/sites-available/agoraiq << 'NGINX'
# Rate limiting zone for proof endpoints
limit_req_zone $binary_remote_addr zone=proof:10m rate=30r/m;

server {
    listen 80;
    server_name agoraiq.net www.agoraiq.net;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name agoraiq.net www.agoraiq.net;

    # SSL (certbot will fill these in)
    ssl_certificate /etc/letsencrypt/live/agoraiq.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/agoraiq.net/privkey.pem;

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    # Proof endpoints rate limiting
    location /api/v1/proof/ {
        limit_req zone=proof burst=10 nodelay;
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
    }

    # Web app
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/agoraiq /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# SSL certificate
sudo certbot --nginx -d agoraiq.net -d www.agoraiq.net
```

---

## 11) Verification

### Health check
```bash
curl -s http://localhost:4000/api/v1/health | jq .
# Expected: {"status":"ok","timestamp":"..."}
```

### Webhook ingest (valid token)
```bash
curl -s -X POST http://localhost:4000/api/v1/providers/itb/signals \
  -H "Content-Type: application/json" \
  -H "X-AgoraIQ-Provider-Token: YOUR_ITB_TOKEN_HERE" \
  -d '{
    "schema_version": "1.0",
    "provider_key": "itb-live-01",
    "symbol": "BTCUSDT",
    "timeframe": "5m",
    "action": "BUY",
    "score": 0.72,
    "confidence": 0.72,
    "ts": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
    "price": 52341.20,
    "meta": {"model_version": "gb_v2"}
  }' | jq .
# Expected: {"status":"created","signalId":"...","tradeId":"..."}
```

### Webhook ingest (invalid token — must fail)
```bash
curl -s -X POST http://localhost:4000/api/v1/providers/itb/signals \
  -H "Content-Type: application/json" \
  -H "X-AgoraIQ-Provider-Token: wrong-token" \
  -d '{"schema_version":"1.0","provider_key":"itb","symbol":"BTCUSDT","timeframe":"1m","action":"BUY","ts":"2026-01-01T00:00:00.000Z"}' | jq .
# Expected: {"error":"FORBIDDEN","message":"Invalid provider token"}
```

### Proof endpoints (public, must be redacted)
```bash
# Stats
curl -s "http://localhost:4000/api/v1/proof/stats?category=all&public=1" | jq .

# Monthly
curl -s "http://localhost:4000/api/v1/proof/monthly?category=all&months=6&public=1" | jq .

# Feed (must NOT contain providerId, prices, TP/SL)
curl -s "http://localhost:4000/api/v1/proof/feed?category=all&public=1" | jq .

# SSE stream
curl -s -N "http://localhost:4000/api/v1/proof/stream?public=1"
# Should see: event: connected, then event: stats every 30s
```

### Dashboard (must require auth)
```bash
curl -s http://localhost:4000/api/v1/dashboard/signals | jq .
# Expected: {"error":"UNAUTHORIZED",...}
```

### Telegram bot test
```
# In Telegram, message your bot: /start
# Should get welcome message with onboarding instructions
```

---

## 12) ITB Provider Setup (Same Server, Separate Service)

ITB runs as its own process and posts signals to AgoraIQ via webhook.

### Curl example
```bash
curl -X POST https://agoraiq.net/api/v1/providers/itb/signals \
  -H "Content-Type: application/json" \
  -H "X-AgoraIQ-Provider-Token: YOUR_ITB_TOKEN" \
  -d '{
    "schema_version": "1.0",
    "provider_key": "itb-live-01",
    "symbol": "ETHUSDT",
    "timeframe": "15m",
    "action": "SELL",
    "score": 0.65,
    "confidence": 0.65,
    "ts": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
    "price": 3150.50,
    "meta": {"model_version": "gb_v3"}
  }'
```

### Python notifier example (for ITB)
```python
#!/usr/bin/env python3
"""
itb_notifier.py — Minimal example of ITB posting signals to AgoraIQ.
Place this in the ITB repo and call post_signal() when a signal fires.
"""
import requests
import json
from datetime import datetime, timezone

AGORAIQ_URL = "https://agoraiq.net/api/v1/providers/itb/signals"
AGORAIQ_TOKEN = "YOUR_ITB_TOKEN_HERE"  # from .env ITB_PROVIDER_TOKEN

def post_signal(symbol: str, timeframe: str, action: str,
                score: float, price: float = None,
                model_version: str = "gb_v2"):
    payload = {
        "schema_version": "1.0",
        "provider_key": "itb-live-01",
        "symbol": symbol.upper(),
        "timeframe": timeframe,
        "action": action,  # BUY | SELL | HOLD
        "score": round(score, 4),
        "confidence": round(score, 4),
        "ts": datetime.now(timezone.utc).isoformat(),
        "meta": {"model_version": model_version},
    }
    if price:
        payload["price"] = round(price, 2)

    resp = requests.post(
        AGORAIQ_URL,
        json=payload,
        headers={
            "Content-Type": "application/json",
            "X-AgoraIQ-Provider-Token": AGORAIQ_TOKEN,
        },
        timeout=10,
    )
    print(f"[ITB→AgoraIQ] {symbol} {action} → {resp.status_code}: {resp.json()}")
    return resp.json()

# Example usage:
if __name__ == "__main__":
    post_signal("BTCUSDT", "5m", "BUY", score=0.72, price=52341.20)
```

---

## 13) Troubleshooting

| Problem | Solution |
|---------|----------|
| `ECONNREFUSED` on API | Check `systemctl status agoraiq-api`, ensure PORT matches .env |
| Migration fails | Ensure DATABASE_URL is correct, Postgres is running |
| 502 from Nginx | Check API/Web are running, ports match Nginx config |
| Webhook returns 403 | Verify `ITB_PROVIDER_TOKEN` matches between ITB and AgoraIQ .env |
| Rate limited (429) | Public proof endpoints have IP rate limits; back off and retry |
| Tracker not resolving | Check `systemctl status agoraiq-tracker` and exchange API access |
| Binance/Bybit price null | SOCKS proxy down — `curl -x socks5://143.198.202.65:1080 https://api.binance.com/api/v3/ping` |
| Proxy timeout/refused | Check `systemctl status danted` on proxy box (143.198.202.65) |
| Kraken works, Binance doesn't | SOCKS proxy issue — only Binance/Bybit route through it |
| Telegram bot not responding | Verify `TELEGRAM_BOT_TOKEN`, check `journalctl -u agoraiq-telegram` |
| Duplicate signal (200) | Normal — idempotency is working. Same signal already ingested. |
| SSE not working | Ensure Nginx has `proxy_buffering off` and `X-Accel-Buffering: no` |
| Prisma client error | Run `pnpm db:generate` then `pnpm build` |

### Useful commands
```bash
# Restart everything
sudo systemctl restart agoraiq-api agoraiq-web agoraiq-tracker agoraiq-telegram

# View live logs
sudo journalctl -u agoraiq-api -f --no-pager
sudo journalctl -u agoraiq-tracker -f --no-pager

# Check database
sudo -u postgres psql agoraiq -c "SELECT count(*) FROM signals;"
sudo -u postgres psql agoraiq -c "SELECT count(*), status FROM trades GROUP BY status;"

# Check active trades
sudo -u postgres psql agoraiq -c "SELECT symbol, direction, status, \"createdAt\" FROM trades WHERE status='ACTIVE' ORDER BY \"createdAt\" DESC LIMIT 10;"
```
