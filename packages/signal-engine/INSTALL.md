# AgoraIQ Signal Engine — Installation & Deployment

## Prerequisites

**On the RackNerd VPS (Ubuntu):**

- Node.js 20+ (`node -v`)
- npm 10+ (`npm -v`)
- Python 3 + pip (for `better-sqlite3` native build)
- build-essential (`gcc`, `g++`, `make`)
- PM2 (process manager, already installed for AgoraIQ)

**Verify build tools:**

```bash
node -v          # v20.x or v22.x
npm -v           # 10.x+
gcc --version    # needed for better-sqlite3 native compilation
make --version
```

If `gcc` or `make` are missing:

```bash
sudo apt update && sudo apt install -y build-essential python3
```

**SOCKS5 proxy at 143.198.202.65** must be running and accepting connections from the VPS IP. Verify:

```bash
curl --socks5 143.198.202.65:1080 https://api.binance.com/api/v3/ping
# Should return: {}
```

If that fails, check the proxy server's firewall and daemon status before proceeding.

---

## 1. Deploy the Package

```bash
# From your monorepo root
cd /path/to/agoraiq
mkdir -p packages/signal-engine
cd packages/signal-engine

# Unzip the archive (or copy files from wherever you downloaded it)
unzip ~/signal-engine-v2.zip -d .
mv signal-engine/* .
mv signal-engine/.* . 2>/dev/null
rmdir signal-engine
```

Or if you're placing it outside the monorepo for now:

```bash
mkdir -p ~/signal-engine && cd ~/signal-engine
unzip ~/signal-engine-v2.zip -d .
mv signal-engine/* .
mv signal-engine/.* . 2>/dev/null
rmdir signal-engine
```

---

## 2. Install Dependencies

```bash
cd ~/signal-engine  # or packages/signal-engine
npm install
```

`better-sqlite3` compiles a native C++ addon. If this fails:

```bash
# Missing node headers
sudo apt install -y python3 make g++
npm rebuild better-sqlite3

# If still failing on older Node
npm install --build-from-source better-sqlite3
```

Verify the build:

```bash
node -e "require('better-sqlite3')" && echo "SQLite OK"
```

---

## 3. Configure Environment

```bash
cp .env.example .env
nano .env
```

**Required fields to set:**

```env
# Your AgoraIQ provider token (from seed-provider step below)
AGORAIQ_ENGINE_TOKEN=

# Exchange API keys (Binance)
EXCHANGE_API_KEY=your-binance-api-key
EXCHANGE_API_SECRET=your-binance-api-secret

# SOCKS5 proxy — REQUIRED for Binance from RackNerd
EXCHANGE_SOCKS_PROXY=socks5://143.198.202.65:1080

# AgoraIQ base URL
AGORAIQ_API_BASE_URL=https://app.agoraiq.net/api/v1

# Start in dry run mode (logs signals, does not publish)
ENGINE_DRY_RUN=true
```

**Optional but recommended:**

```env
# CryptoPanic news (free tier, get key at cryptopanic.com/developers/api/)
CRYPTOPANIC_API_KEY=your-key-here

# AI reasoning (advisory only)
AI_REASONING_ENABLED=false
ANTHROPIC_API_KEY=

# Logging
LOG_LEVEL=info
```

**Fields you can leave as defaults:**

```env
EXCHANGE_ID=binance
ENGINE_SYMBOLS=BTC,ETH,SOL,XRP
ENGINE_TIMEFRAMES=15m,1h,4h
ENGINE_SCAN_INTERVAL_MS=300000
ENGINE_MIN_PUBLISH_SCORE=70
ENGINE_MIN_EXPECTED_R=1.3
ENGINE_HEALTH_PORT=9090
ENGINE_DB_PATH=./data/signal-engine.db
```

---

## 4. Create the Data Directory

```bash
mkdir -p data
```

SQLite database is created automatically on first run at `ENGINE_DB_PATH`.

---

## 5. Build TypeScript

```bash
npx tsc
```

This compiles `src/` into `dist/`. Fix any errors before proceeding. Common issues:

- **Missing types**: `npm install` may not have completed. Run `npm install` again.
- **Strict mode errors**: The `tsconfig.json` has `strict: true`. All type errors must be resolved.

---

## 6. Seed the Provider Record

The engine publishes signals as the `agoraiq-engine` provider. This record must exist in the AgoraIQ database.

**Dry run first (see what would be created):**

```bash
npx tsx scripts/seed-provider.ts --dry-run
```

**Create the provider:**

```bash
# Set the admin token for your AgoraIQ instance
export AGORAIQ_ADMIN_TOKEN=your-admin-token
export AGORAIQ_API_BASE_URL=https://app.agoraiq.net/api/v1

npx tsx scripts/seed-provider.ts
```

If the provider already exists (409), that's fine. If a token is returned, add it to `.env`:

```bash
# Add the returned token
echo "AGORAIQ_ENGINE_TOKEN=returned-token-here" >> .env
```

If you prefer to seed via Prisma directly:

```bash
npx tsx scripts/seed-provider.ts --mode=prisma
```

---

## 7. Verify Connectivity

**Test SOCKS5 proxy → Binance:**

```bash
node -e "
const { SocksProxyAgent } = require('socks-proxy-agent');
const axios = require('axios');
const agent = new SocksProxyAgent('socks5://143.198.202.65:1080');
axios.get('https://api.binance.com/api/v3/ping', { httpAgent: agent, httpsAgent: agent, proxy: false })
  .then(() => console.log('Binance via SOCKS5: OK'))
  .catch(e => console.error('Binance via SOCKS5: FAILED', e.message));
"
```

**Test SOCKS5 proxy → Binance Futures:**

```bash
node -e "
const { SocksProxyAgent } = require('socks-proxy-agent');
const axios = require('axios');
const agent = new SocksProxyAgent('socks5://143.198.202.65:1080');
axios.get('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT', { httpAgent: agent, httpsAgent: agent, proxy: false })
  .then(r => console.log('Futures via SOCKS5: OK, funding=' + r.data.lastFundingRate))
  .catch(e => console.error('Futures via SOCKS5: FAILED', e.message));
"
```

**Test SOCKS5 proxy → AgoraIQ:**

```bash
node -e "
const { SocksProxyAgent } = require('socks-proxy-agent');
const axios = require('axios');
const agent = new SocksProxyAgent('socks5://143.198.202.65:1080');
axios.get('https://app.agoraiq.net/api/v1/health', { httpAgent: agent, httpsAgent: agent, proxy: false })
  .then(r => console.log('AgoraIQ via SOCKS5: OK'))
  .catch(e => console.error('AgoraIQ via SOCKS5: FAILED', e.message));
"
```

**Test direct → CryptoPanic (no proxy needed):**

```bash
curl -s "https://cryptopanic.com/api/v1/posts/?auth_token=YOUR_KEY&currencies=BTC&limit=1" | head -c 200
```

All four must pass before starting the engine.

---

## 8. Run Tests

```bash
# Unit tests (synthetic data, no network needed)
npx vitest run
```

All strategy and scoring tests should pass. Level detection tests use synthetic candle data.

---

## 9. First Run (Dry Run Mode)

```bash
# Ensure ENGINE_DRY_RUN=true in .env
npx tsx src/index.ts
```

Watch the output. You should see:

1. Banner with config summary
2. Health endpoint listening on :9090
3. First scan cycle starting
4. Snapshot building for each symbol/timeframe
5. Strategy evaluation results
6. `[DRY RUN] Would publish: ...` for any signals that pass the gate

Let it run for 2-3 cycles (10-15 minutes). Check:

- No proxy errors (connection refused, timeout to Binance)
- Candle data loading (`Snapshot: BTC 1h | $XXXXX`)
- Regime detection working (`regime=TRENDING_BULL` etc.)
- No consecutive failure escalation

Press `Ctrl+C` to stop.

**Check the health endpoint:**

```bash
curl http://localhost:9090/
```

Should return JSON with `"status": "healthy"`.

---

## 10. Run Backtests

Before going live, validate the strategies against historical data:

```bash
# Single symbol
npx tsx scripts/run-backtest.ts --symbol=BTC --tf=1h --days=30

# All symbols and timeframes
npx tsx scripts/run-backtest.ts --all --days=30

# Custom slippage/fee assumptions
npx tsx scripts/run-backtest.ts --symbol=BTC --tf=1h --days=30 --slip=10 --fee=20
```

**Run the full validation suite:**

```bash
npx tsx scripts/run-validation.ts --symbol=BTC --tf=1h --days=30
```

This runs baseline comparisons, factor ablation, breakout evaluation, and AI audit in sequence.

**Run factor ablation:**

```bash
npx tsx scripts/run-ablation.ts --symbol=BTC --tf=1h --days=30
```

Review results before going live. If any factor shows HURTS, disable it.

---

## 11. Go Live

Once backtests look acceptable:

```bash
# Edit .env
nano .env
# Set: ENGINE_DRY_RUN=false
```

**Run with PM2:**

```bash
# Build first
npx tsc

# Start with PM2
pm2 start dist/index.js --name signal-engine --cwd ~/signal-engine

# Save PM2 process list
pm2 save

# Check logs
pm2 logs signal-engine

# Check status
pm2 status signal-engine
```

**PM2 ecosystem file (optional, for more control):**

```bash
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'signal-engine',
    script: 'dist/index.js',
    cwd: '/root/signal-engine',
    env: {
      NODE_ENV: 'production',
    },
    max_memory_restart: '512M',
    restart_delay: 5000,
    max_restarts: 20,
    autorestart: true,
  }]
};
EOF

pm2 start ecosystem.config.js
pm2 save
```

---

## 12. Verify Live Operation

**Check signals are flowing:**

```bash
# Health endpoint
curl http://localhost:9090/ | jq .

# SQLite: recent signals
sqlite3 data/signal-engine.db "SELECT signal_id, symbol, strategy_type, final_score, confidence, published_at FROM signal_analysis ORDER BY published_at DESC LIMIT 10;"

# SQLite: OI history (should populate within 1 hour)
sqlite3 data/signal-engine.db "SELECT symbol, value, recorded_at FROM oi_history ORDER BY recorded_at DESC LIMIT 10;"
```

**Check signals appear in AgoraIQ:**

```bash
# Via the AgoraIQ API
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://app.agoraiq.net/api/v1/signals?provider=agoraiq-engine&limit=5"
```

---

## 13. Enable AI Reasoning (Optional)

Only after the engine has been running and you've confirmed rule-based signals are working:

```bash
nano .env
# Set:
# AI_REASONING_ENABLED=true
# ANTHROPIC_API_KEY=sk-ant-...
# AI_MODEL=claude-sonnet-4-20250514

# Restart
pm2 restart signal-engine
```

AI is advisory only. It cannot block signals. Check the audit trail:

```bash
sqlite3 data/signal-engine.db "
  SELECT
    ai_enabled,
    count(*) as n,
    avg(base_final_score) as avg_base,
    avg(post_ai_final_score) as avg_post,
    avg(ai_reasoning_latency_ms) as avg_latency_ms
  FROM signal_analysis
  WHERE published_at > datetime('now', '-7 days')
  GROUP BY ai_enabled;
"
```

---

## 14. Caddy / Reverse Proxy (Optional)

If you want to expose the health endpoint externally:

```caddyfile
signal-health.yourdomain.com {
    reverse_proxy localhost:9090
}
```

---

## Troubleshooting

**"Connection refused" to Binance:**
SOCKS5 proxy is down or not accepting connections from VPS IP.
```bash
# Test from VPS
nc -zv 143.198.202.65 1080
```

**"Insufficient candle data":**
Exchange API returned fewer than 200 bars. Check if the symbol/timeframe is valid and the exchange is responding.

**better-sqlite3 build fails:**
```bash
sudo apt install -y build-essential python3
npm rebuild better-sqlite3
```

**PM2 restarts in a loop:**
Check `pm2 logs signal-engine --lines 50` for the error. Common causes:
- Missing `.env` values (AGORAIQ_ENGINE_TOKEN empty with DRY_RUN=false)
- SQLite permission error on `data/` directory
- Port 9090 already in use

**Signals not appearing in AgoraIQ:**
1. Check `ENGINE_DRY_RUN` is `false`
2. Check `AGORAIQ_ENGINE_TOKEN` is valid
3. Check publisher logs for HTTP status codes
4. Verify the `agoraiq-engine` provider record exists

**Learning loop not updating:**
The learning loop runs every 6 hours. It needs at least 3 resolved signals per strategy/symbol/timeframe/regime group to produce expectancy data. Check:
```bash
sqlite3 data/signal-engine.db "SELECT * FROM strategy_expectancy;"
```

---

## File Locations

| What | Where |
|------|-------|
| Engine source | `~/signal-engine/src/` |
| Compiled output | `~/signal-engine/dist/` |
| SQLite database | `~/signal-engine/data/signal-engine.db` |
| Environment config | `~/signal-engine/.env` |
| PM2 logs | `~/.pm2/logs/signal-engine-*.log` |
| Health endpoint | `http://localhost:9090/` |

---

## Update Procedure

```bash
cd ~/signal-engine
pm2 stop signal-engine

# Back up database
cp data/signal-engine.db data/signal-engine.db.bak

# Deploy new code (unzip, git pull, etc.)
npm install
npx tsc

# Run tests
npx vitest run

pm2 start signal-engine
pm2 logs signal-engine --lines 20
```

The SQLite database is forward-compatible. New tables are created automatically via `CREATE TABLE IF NOT EXISTS`. Existing data is preserved.
