# AgoraIQ — Deployment Kit

## Contents

```
agoraiq-market-intelligence-v6.zip   intel.agoraiq.net service (Node.js source + setup)
fix-market-widget.sh                  Fix live market widget — swap to Kraken (no restart)
fix-market-widget-proxy.sh            Fix live market widget — proxy Binance via SOCKS5
```

---

## Issue 1 — Deploy intel.agoraiq.net

```bash
scp agoraiq-market-intelligence-v6.zip root@your-server:/tmp/
# on server:
cd /tmp && unzip agoraiq-market-intelligence-v6.zip && cd agoraiq-mi
bash setup.sh
```

**Verify:**
```bash
systemctl status agoraiq-market-intelligence
curl https://intel.agoraiq.net/health
node /opt/agoraiq-market-intelligence/src/cli.mjs status
```

---

## Issue 2 — Fix Live Market widget (app.agoraiq.net)

Pick **one** of the two options:

### Option A — Kraken swap (recommended: no rebuild, no restart)
```bash
bash fix-market-widget.sh
# Hard-refresh browser: Ctrl+Shift+R
```
Swaps the browser-side Binance fetch for Kraken's equivalent public API.
No backend changes required.

### Option B — Binance proxy via SOCKS5 (keeps real Binance data)
```bash
bash fix-market-widget-proxy.sh
```
Adds a `/api/v1/proxy/binance/ticker/24hr` route to the main API that
tunnels through your existing SOCKS5 proxy. Requires API TypeScript rebuild
and service restart (handled automatically by the script).

---

## What was fixed

### intel.agoraiq.net (setup.sh — 8 bugs)
1. `npm --production` → `npm --omit=dev` (deprecated flag)
2. `npx prisma generate` removed — Prisma is a devDependency, won't be installed
3. `prisma migrate deploy` removed — fails on fresh DBs without migration history; replaced with `node src/cli.mjs migrate` (raw SQL, idempotent)
4. SOCKS5 env var translation — main app uses `SOCKS_PROXY_URL`, adapters expect `SOCKS5_HOST/PORT`; setup now translates automatically
5. `/usr/bin/node` hardcoded in cron → resolved `$NODE_BIN` at setup time
6. `$(which node)` in systemd unit → resolved `$NODE_BIN` (prevents nvm shim breakage)
7. `set -e` removed → service start failure no longer aborts Caddy + cron setup
8. Added pre-flight DB connectivity check before install begins

### fix-market-widget.sh — 3 bugs
1. Unquoted heredoc (`<< PYEOF`) bash-expanded `$vars` and backticks in KRAKEN_PROCESSOR JS code, corrupting template literals → replaced with temp file
2. `BNBUSD` in Kraken request URL — BNB is not on Kraken, causing a 400 error that breaks **all** pairs → replaced with `UNIUSD`
3. Kraken key normalization not handled — `XBTUSD` request returns `XXBTZUSD` response key; map now covers both forms with clear comments

### fix-market-widget-proxy.sh — 5 bugs
1. `set -euo pipefail` → `set -uo pipefail` — build failure no longer aborts HTML patch and service restart
2. Fragile `import` regex assumes specific file structure → now finds last import statement position, works with any index.ts layout
3. Hardcoded IP `143.198.202.65` in TypeScript source → removed; proxy URL comes from env vars only
4. `socks-proxy-agent` never checked/installed → script now verifies and installs it if missing
5. `docker restart agoraiq-api` → `systemctl restart` with service name autodiscovery (docker as last resort only)
