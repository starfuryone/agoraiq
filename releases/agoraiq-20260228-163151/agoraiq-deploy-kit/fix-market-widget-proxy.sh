#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Fix: Live Market widget — route Binance through server-side proxy
#
# 1. Checks/installs socks-proxy-agent in the API package
# 2. Writes /opt/agoraiq/packages/api/src/routes/binance-proxy.ts
# 3. Registers the route in index.ts
# 4. Rebuilds the API (pnpm --filter @agoraiq/api build)
# 5. Patches the dashboard HTML to call the proxy URL
# 6. Restarts the API service (systemd, not docker)
# ═══════════════════════════════════════════════════════════════
set -uo pipefail  # intentionally no -e — handle failures explicitly

API_DIR="/opt/agoraiq/packages/api/src"
API_PKG="/opt/agoraiq/packages/api"
WEB_DIR="/opt/agoraiq/packages/web/public"
AGORAIQ_DIR="/opt/agoraiq"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC}  $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
die()  { echo -e "${RED}✗${NC}  $1"; exit 1; }
info() { echo -e "   $1"; }

[[ $(id -u) -eq 0 ]] || die "Run as root or with sudo"
[[ -d "$API_DIR" ]]  || die "API src dir not found: $API_DIR"
[[ -d "$WEB_DIR" ]]  || die "Web dir not found: $WEB_DIR"

# ── STEP 1: Ensure socks-proxy-agent is installed ─────────────
# FIX: The original script assumed socks-proxy-agent was already present.
# It may be in the monorepo root but not the API package — check and install.
ok "Checking socks-proxy-agent dependency..."
if node -e "require('socks-proxy-agent')" 2>/dev/null; then
    ok "socks-proxy-agent already available"
elif [[ -f "$AGORAIQ_DIR/package.json" ]] && grep -q "socks-proxy-agent" "$AGORAIQ_DIR/package.json" 2>/dev/null; then
    ok "socks-proxy-agent in monorepo root package.json"
else
    info "Installing socks-proxy-agent in API package..."
    cd "$API_PKG"
    if command -v pnpm &>/dev/null; then
        pnpm add socks-proxy-agent && ok "Installed via pnpm"
    else
        npm install socks-proxy-agent --no-fund --no-audit && ok "Installed via npm"
    fi
fi

# ── STEP 2: Write the proxy route TypeScript file ─────────────
ok "Writing binance-proxy route..."
mkdir -p "$API_DIR/routes"

# FIX: Remove hardcoded IP (143.198.202.65). The proxy config must come
# from environment variables only — the IP is infrastructure config, not code.
# FIX: Read all existing SOCKS env var naming conventions the main app uses.
cat > "$API_DIR/routes/binance-proxy.ts" << 'TSEOF'
// routes/binance-proxy.ts — server-side Binance proxy via SOCKS5
// Reads proxy config from env vars (set in /opt/agoraiq/.env):
//   SOCKS_PROXY_URL=socks5://user:pass@host:port   (preferred, full URL)
//   or SOCKS_PROXY_HOST + SOCKS_PROXY_PORT + optional USERNAME/PASSWORD
import { Router, Request, Response } from 'express';
import { createLogger } from '@agoraiq/db';
import { SocksProxyAgent } from 'socks-proxy-agent';
import https from 'https';

const log = createLogger('binance-proxy');

function getProxyUrl(): string | null {
  // Accept full URL (preferred)
  if (process.env.SOCKS_PROXY_URL) return process.env.SOCKS_PROXY_URL;
  // Build from parts
  const host = process.env.SOCKS_PROXY_HOST;
  if (!host) return null;
  const port = process.env.SOCKS_PROXY_PORT || '1080';
  const user = process.env.SOCKS_PROXY_USERNAME;
  const pass = process.env.SOCKS_PROXY_PASSWORD;
  return user && pass
    ? `socks5://${user}:${pass}@${host}:${port}`
    : `socks5://${host}:${port}`;
}

const cache = new Map<string, { data: unknown; exp: number }>();

function fetchViaProxy(url: string): Promise<unknown> {
  const proxyUrl = getProxyUrl();
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = proxyUrl
      ? { agent: new SocksProxyAgent(proxyUrl) as any }
      : {};
    const req = https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Binance HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const buf: Buffer[] = [];
      res.on('data', (c: Buffer) => buf.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(buf).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

export function createBinanceProxyRoutes(): Router {
  const r = Router();

  if (!getProxyUrl()) {
    log.warn('No SOCKS_PROXY_URL / SOCKS_PROXY_HOST configured — Binance requests will go direct');
  }

  r.get('/binance/ticker/24hr', async (req: Request, res: Response) => {
    const syms = (req.query.symbols as string | undefined)
      ?.toUpperCase().split(',').filter(Boolean);
    const key  = `24hr:${syms?.sort().join(',') ?? 'all'}`;
    const hit  = cache.get(key);
    if (hit && Date.now() < hit.exp) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(hit.data);
    }

    try {
      const url = syms?.length === 1
        ? `https://api.binance.com/api/v3/ticker/24hr?symbol=${syms[0]}`
        : 'https://api.binance.com/api/v3/ticker/24hr';
      const data = await fetchViaProxy(url) as any;
      const result = syms && syms.length > 1 && Array.isArray(data)
        ? data.filter((t: any) => syms.includes(t.symbol))
        : data;
      cache.set(key, { data: result, exp: Date.now() + 15_000 });
      res.setHeader('X-Cache', 'MISS');
      log.info('binance proxy ok', { key, count: Array.isArray(result) ? result.length : 1 });
      return res.json(result);
    } catch (err: any) {
      log.error('binance proxy fail', { error: err.message });
      return res.status(502).json({ error: 'proxy_error', detail: err.message });
    }
  });

  return r;
}
TSEOF
ok "Route file written: $API_DIR/routes/binance-proxy.ts"

# ── STEP 3: Register route in index.ts ────────────────────────
INDEX="$API_DIR/index.ts"
[[ -f "$INDEX" ]] || die "Cannot find $INDEX — API source structure may differ"

if grep -q "binance-proxy\|createBinanceProxyRoutes" "$INDEX"; then
    warn "Route already registered in index.ts — skipping"
else
    # FIX: Write Python to a temp file to avoid heredoc bash-expansion of
    # $variables and `backticks` in the Python/regex strings.
    PYSCRIPT=$(mktemp /tmp/patch-index.XXXXXX.py)
    trap 'rm -f "$PYSCRIPT"' EXIT

    cat > "$PYSCRIPT" << 'PYEOF'
import sys, re

index_path = sys.argv[1]
with open(index_path) as f:
    src = f.read()

original = src

import_line = "import { createBinanceProxyRoutes } from './routes/binance-proxy';"
mount_line  = "  app.use('/api/v1/proxy', createBinanceProxyRoutes());"

# Insert import: find the last consecutive import block and append after it.
# More robust than matching a specific import name — works regardless of what
# other route imports look like.
if import_line not in src:
    # Find position after the last import statement
    last_import = None
    for m in re.finditer(r'^import .+;$', src, re.MULTILINE):
        last_import = m
    if last_import:
        insert_at = last_import.end()
        src = src[:insert_at] + '\n' + import_line + src[insert_at:]
        print("✓ Added import to index.ts")
    else:
        print("⚠  Could not find import block in index.ts — add manually:")
        print(f"   {import_line}")

# Mount the route: insert before the first app.use('/api/v1/...') call.
# Try multiple patterns to handle different index.ts layouts.
if mount_line not in src:
    patterns = [
        r"(  app\.use\('/api/v1/health')",
        r"(  app\.use\('/api/v1/auth')",
        r"(  app\.use\('/api/v1/)",
        r"(  app\.use\('/api/)",
    ]
    mounted = False
    for pattern in patterns:
        if re.search(pattern, src):
            src = re.sub(pattern, mount_line + '\n' + r'\1', src, count=1)
            print(f"✓ Mounted proxy route before {pattern}")
            mounted = True
            break
    if not mounted:
        print("⚠  Could not find app.use('/api/v1/...') in index.ts — add manually:")
        print(f"   {mount_line}")
else:
    print("  mount line already present")

if src != original:
    with open(index_path, 'w') as f:
        f.write(src)
    print(f"✓ index.ts updated: {index_path}")
else:
    print("  No changes needed in index.ts")
PYEOF

    python3 "$PYSCRIPT" "$INDEX"
    ok "Route registration complete"
fi

# ── STEP 4: Rebuild the API ────────────────────────────────────
# FIX: Don't abort if build fails — log clearly and continue so the
# HTML patch and service restart still run (or the operator can fix + re-run).
ok "Rebuilding API package..."
cd "$AGORAIQ_DIR"
BUILD_OUTPUT=""
BUILD_OK=false

if command -v pnpm &>/dev/null; then
    if BUILD_OUTPUT=$(pnpm --filter @agoraiq/api build 2>&1); then
        BUILD_OK=true
    fi
else
    warn "pnpm not found — trying npm run build"
    if BUILD_OUTPUT=$(cd "$API_PKG" && npm run build 2>&1); then
        BUILD_OK=true
    fi
fi

if $BUILD_OK; then
    ok "API build succeeded"
    echo "$BUILD_OUTPUT" | tail -3
else
    warn "API build failed. Output:"
    echo "$BUILD_OUTPUT" | tail -20
    warn "Fix the build error then re-run this script, or restart the service manually."
    warn "Continuing with HTML patch and service restart anyway..."
fi

# ── STEP 5: Patch the dashboard HTML ──────────────────────────
TARGET=""
for f in "$WEB_DIR/index.html" "$WEB_DIR/dashboard.html" "$WEB_DIR/dashboard/index.html"; do
    if [[ -f "$f" ]] && grep -q "api.binance.com" "$f" 2>/dev/null; then
        TARGET="$f"; break
    fi
done
[[ -z "$TARGET" ]] && TARGET=$(grep -rl "api.binance.com" "$WEB_DIR" 2>/dev/null | head -1 || true)
[[ -n "$TARGET" ]] || die "Could not find dashboard HTML with api.binance.com — already patched?"

BACKUP="${TARGET}.bak.$(date +%Y%m%d-%H%M%S)"
cp "$TARGET" "$BACKUP"
ok "Dashboard backed up: $BACKUP"

# FIX: Write Python to a temp file (same reason as above — heredoc expansion
# would corrupt any $ or ` characters in the replacement string).
PYSCRIPT2=$(mktemp /tmp/patch-dashboard.XXXXXX.py)
trap 'rm -f "$PYSCRIPT" "$PYSCRIPT2"' EXIT

cat > "$PYSCRIPT2" << 'PYEOF'
import sys, re

path = sys.argv[1]
with open(path) as f:
    src = f.read()
orig = src

# Swap fetch URL: api.binance.com → /api/v1/proxy/binance
# The proxy returns the identical Binance response shape, so no JS changes needed.
src = src.replace(
    "fetch('https://api.binance.com/api/v3/ticker/24hr')",
    "fetch('/api/v1/proxy/binance/ticker/24hr')"
)
src = src.replace(
    'fetch("https://api.binance.com/api/v3/ticker/24hr")',
    "fetch('/api/v1/proxy/binance/ticker/24hr')"
)

# Fix error message
src = src.replace("throw new Error('Binance API error')",  "throw new Error('Market data unavailable')")
src = src.replace('throw new Error("Binance API error")',   "throw new Error('Market data unavailable')")

if src != orig:
    with open(path, 'w') as f:
        f.write(src)
    print("✓ Dashboard HTML patched — proxy URL substituted")
else:
    print("⚠  No changes made — may already be patched or code structure differs")
    print("   Manual fix: replace 'api.binance.com/api/v3/ticker/24hr'")
    print("            with '/api/v1/proxy/binance/ticker/24hr'")
PYEOF

python3 "$PYSCRIPT2" "$TARGET"

# ── STEP 6: Restart the API service ───────────────────────────
# FIX: Use systemctl, not docker. The AgoraIQ main app is a systemd service.
# Try common service names; fall back to docker as a last resort.
ok "Restarting API service..."
RESTARTED=false

for SVC_NAME in "agoraiq-api" "agoraiq" "agoraiq-api.service"; do
    if systemctl is-active --quiet "$SVC_NAME" 2>/dev/null || \
       systemctl status "$SVC_NAME" &>/dev/null; then
        if systemctl restart "$SVC_NAME"; then
            ok "Restarted systemd service: $SVC_NAME"
            RESTARTED=true
            break
        fi
    fi
done

if ! $RESTARTED; then
    # Last resort: try docker
    if docker inspect agoraiq-api &>/dev/null 2>&1; then
        docker restart agoraiq-api && ok "Restarted docker container: agoraiq-api" && RESTARTED=true
    fi
fi

if ! $RESTARTED; then
    warn "Could not auto-restart the API service."
    warn "Find your service name and restart manually:"
    warn "  systemctl list-units | grep agoraiq"
    warn "  systemctl restart <service-name>"
fi

# ── STEP 7: Smoke test ─────────────────────────────────────────
if $RESTARTED; then
    info "Waiting 4s for service to start..."
    sleep 4
fi

echo ""
ok "Testing proxy endpoint..."
HTTP=$(curl -so /dev/null -w "%{http_code}" --max-time 8 \
    "http://localhost:4000/api/v1/proxy/binance/ticker/24hr?symbols=BTCUSDT" 2>/dev/null || echo "000")

if [[ "$HTTP" == "200" ]]; then
    BTC=$(curl -s --max-time 8 \
        "http://localhost:4000/api/v1/proxy/binance/ticker/24hr?symbols=BTCUSDT" \
        | python3 -c "
import sys, json
d = json.load(sys.stdin)
item = d[0] if isinstance(d, list) else d
print('BTC last=' + item.get('lastPrice','?'))
" 2>/dev/null || echo "parse error")
    ok "Proxy endpoint responding — $BTC"
elif [[ "$HTTP" == "000" ]]; then
    warn "Could not reach localhost:4000 — service may not be running"
    warn "Check: journalctl -u agoraiq-api -n 50  (or your service name)"
else
    warn "Proxy returned HTTP $HTTP"
    warn "Check: journalctl -u agoraiq-api -n 50"
fi

echo ""
echo "════════════════════════════════════════════════════"
echo " Done."
echo " No Caddy reload needed — HTML file and API changed only."
echo " Hard-refresh browser: Ctrl+Shift+R"
echo " Backup: $BACKUP"
echo "════════════════════════════════════════════════════"
