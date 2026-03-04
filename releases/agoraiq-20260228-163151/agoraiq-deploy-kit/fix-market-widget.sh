#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Fix: "Live Market" widget — replace Binance browser fetch with Kraken
#
# Root cause: The widget fetches api.binance.com directly from the
# browser. RackNerd is a US datacenter — Binance returns 451/403
# for all US IPs. The SOCKS5 proxy only helps server-side code,
# NOT browser-side fetch() calls.
#
# Fix: Replace Binance API call with Kraken public API.
# Kraken has no geo-restrictions, no auth required, same data shape.
#
# No backend changes. No rebuild. No restart.
#
# Run on server as root:
#   bash fix-market-widget.sh
# ═══════════════════════════════════════════════════════════════
set -uo pipefail  # intentionally no -e so we can report errors cleanly

WEB_DIR="/opt/agoraiq/packages/web/public"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC}  $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
die()  { echo -e "${RED}✗${NC}  $1"; exit 1; }

[[ $(id -u) -eq 0 ]] || die "Run as root or with sudo"
[[ -d "$WEB_DIR"  ]] || die "Web dir not found: $WEB_DIR"

# ── Find the dashboard file ────────────────────────────────────
TARGET=""
for f in "$WEB_DIR/index.html" "$WEB_DIR/dashboard.html" "$WEB_DIR/dashboard/index.html"; do
  if [[ -f "$f" ]] && grep -q "api.binance.com" "$f" 2>/dev/null; then
    TARGET="$f"; break
  fi
done

if [[ -z "$TARGET" ]]; then
  TARGET=$(grep -rl "api.binance.com" "$WEB_DIR" 2>/dev/null | head -1 || true)
fi

[[ -n "$TARGET" ]] || die "Could not find a file containing 'api.binance.com' in $WEB_DIR"

ok "Found target: $TARGET"
echo "   Binance references: $(grep -c 'api.binance.com' "$TARGET" || echo 0)"

# ── Backup ─────────────────────────────────────────────────────
BACKUP="${TARGET}.bak.$(date +%Y%m%d-%H%M%S)"
cp "$TARGET" "$BACKUP"
ok "Backup saved: $BACKUP"

# ── Apply patch via Python written to a temp file ──────────────
# FIX: Write the Python script to a temp file rather than using a heredoc.
# A heredoc with unquoted PYEOF allows bash to expand $variables and `backticks`
# inside the Python code, which corrupts the JS template literals in the
# KRAKEN_PROCESSOR replacement string before Python ever sees them.

PYSCRIPT=$(mktemp /tmp/fix-market-widget.XXXXXX.py)
trap 'rm -f "$PYSCRIPT"' EXIT

cat > "$PYSCRIPT" << 'PYEOF'
import re, sys

target = sys.argv[1]
with open(target, "r", encoding="utf-8") as f:
    src = f.read()
original = src

# ── PATCH 1: Replace Binance fetch URL with Kraken ─────────────────────────────
# FIX: Replace BNBUSD with UNIUSD — BNB is not listed on Kraken and including
# it in the pair list causes Kraken to return a 400 error for the *entire* request,
# silently breaking all 10 pairs, not just BNB.
KRAKEN_PAIRS = "XBTUSD,ETHUSD,SOLUSD,XRPUSD,UNIUSD,XDGUSD,LINKUSD,ADAUSD,AVAXUSD,DOTUSD"
KRAKEN_URL   = f"https://api.kraken.com/0/public/Ticker?pair={KRAKEN_PAIRS}"

src = src.replace(
    "fetch('https://api.binance.com/api/v3/ticker/24hr')",
    f"fetch('{KRAKEN_URL}')"
)
src = src.replace(
    'fetch("https://api.binance.com/api/v3/ticker/24hr")',
    f"fetch('{KRAKEN_URL}')"
)

# ── PATCH 2: Replace Binance data-processing block with Kraken ─────────────────
# Match the Binance response processor:
#   const tickers = await res.json();
#   const map = Object.fromEntries(tickers.map(t => [t.symbol, t]));
#   const signals = WATCHED_PAIRS.map(sym => {
#     ...t.priceChangePercent, t.lastPrice, t.openPrice...
#   }).filter(Boolean);
BINANCE_PROCESSOR = re.compile(
    r"""const tickers = await res\.json\(\);\s*"""
    r"""const map = Object\.fromEntries\(tickers\.map\(t => \[t\.symbol, t\]\)\);\s*"""
    r"""const signals = WATCHED_PAIRS\.map\(sym => \{.*?const chg = parseFloat\(t\.priceChangePercent\);"""
    r""".*?const price = parseFloat\(t\.lastPrice\);.*?const open\s+=\s+parseFloat\(t\.openPrice\);"""
    r"""[\s\S]*?\.filter\(Boolean\);""",
    re.DOTALL
)

KRAKEN_PROCESSOR = r"""const json = await res.json();
      if (json.error && json.error.length) throw new Error(json.error[0]);

      // Kraken normalizes pair keys in responses (e.g. XBTUSD -> XXBTZUSD).
      // We map both the normalized and the original requested forms.
      const KRAKEN_MAP = {
        XXBTZUSD: 'BTC/USDT', XETHZUSD: 'ETH/USDT', SOLUSD:  'SOL/USDT',
        XXRPZUSD: 'XRP/USDT', UNIUSD:   'UNI/USDT',  XDGUSD:  'DOGE/USDT',
        LINKUSD:  'LINK/USDT', ADAUSD:  'ADA/USDT',  AVAXUSD: 'AVAX/USDT',
        DOTUSD:   'DOT/USDT',
        // fallbacks for non-normalized keys (newer assets aren't prefixed)
        XBTUSD: 'BTC/USDT', ETHUSD: 'ETH/USDT', XRPUSD: 'XRP/USDT',
      };
      const PROVIDER_MAP = {
        'BTC/USDT': 'AlphaWave',      'ETH/USDT': 'CryptoEdge Pro', 'SOL/USDT':  'QuantPulse',
        'XRP/USDT': 'AlphaWave',      'UNI/USDT': 'CryptoEdge Pro', 'DOGE/USDT': 'FuturesTribe',
        'LINK/USDT':'AlphaWave',      'ADA/USDT': 'CryptoEdge Pro', 'AVAX/USDT': 'QuantPulse',
        'DOT/USDT': 'FuturesTribe',
      };
      const EXCHANGE_MAP = {
        'BTC/USDT': 'Binance Futures', 'ETH/USDT': 'Bybit',           'SOL/USDT':  'Binance Futures',
        'XRP/USDT': 'Bybit',           'UNI/USDT': 'Binance Spot',    'DOGE/USDT': 'Bybit',
        'LINK/USDT':'Binance Futures', 'ADA/USDT': 'Bybit',           'AVAX/USDT': 'Binance Futures',
        'DOT/USDT': 'Binance Futures',
      };

      const fmt = (n) => {
        if (n >= 10000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
        if (n >= 10)    return n.toFixed(2);
        if (n >= 1)     return n.toFixed(3);
        return n.toFixed(4);
      };

      const signals = [];
      for (const [krakenKey, ticker] of Object.entries(json.result)) {
        const pair = KRAKEN_MAP[krakenKey];
        if (!pair) continue;

        const price  = parseFloat(ticker.c[0]);  // last trade price
        const open   = parseFloat(ticker.o);      // 24h open
        const high   = parseFloat(ticker.h[1]);   // 24h high
        const low    = parseFloat(ticker.l[1]);   // 24h low
        const chgPct = ((price - open) / open) * 100;
        const atr    = (high - low) * 0.4;
        const direction = chgPct >= 0 ? 'LONG' : 'SHORT';
        const absChg = Math.abs(chgPct);
        const status = absChg < 0.4 ? 'active' : chgPct >= 0 ? 'win' : 'loss';
        const rr     = atr > 0 ? (absChg / ((atr * 0.8 / price) * 100)).toFixed(1) : '\u2014';
        const result = status === 'active' ? 'Active' : `${chgPct >= 0 ? '+' : '\u2013'}${rr}R`;
        const pct    = `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%`;
        const tp     = direction === 'LONG'  ? fmt(price + atr * 1.8) : fmt(price - atr * 1.8);
        const sl     = direction === 'LONG'  ? fmt(price - atr * 0.8) : fmt(price + atr * 0.8);

        signals.push({
          pair, direction,
          exchange:   EXCHANGE_MAP[pair]   || 'Binance Futures',
          source:     PROVIDER_MAP[pair]   || 'AlphaWave',
          entryPrice: fmt(open),
          tp, sl, result, pct, status,
          time: '24h window',
        });
      }"""

patched = BINANCE_PROCESSOR.sub(lambda m: KRAKEN_PROCESSOR, src)
if patched != src:
    print("✓ Patch 2: replaced Binance data processor with Kraken")
    src = patched
else:
    print("⚠  Patch 2 skipped: Binance processor block not found")
    print("   The widget code structure may differ — check manually:")
    print("   grep -n 'priceChangePercent\\|lastPrice\\|openPrice' " + target)

# ── PATCH 3: Update error/label strings ───────────────────────────────────────
replacements = [
    ("throw new Error('Binance API error')",  "throw new Error('Market data unavailable')"),
    ('throw new Error("Binance API error")',   "throw new Error('Market data unavailable')"),
    ("Binance prices · updates every 30s",    "Kraken prices · updates every 30s"),
    ("Binance · updates every 30s",           "Kraken · updates every 30s"),
    ("Live 24h data · Binance prices",        "Live 24h data · Kraken prices"),
    ("Binance prices",                         "Kraken prices"),
]
for old, new in replacements:
    if old in src:
        src = src.replace(old, new)
        print(f"✓ Patch 3: '{old}' → '{new}'")

# Also fix signalsLabel.textContent references
src = re.sub(
    r"(signalsLabel\.textContent\s*=\s*[`'\"][^`'\"]*)(Binance)([^`'\"]*[`'\"])",
    r"\1Kraken\3",
    src
)

# ── Write result ───────────────────────────────────────────────────────────────
if src != original:
    with open(target, "w", encoding="utf-8") as f:
        f.write(src)
    print("")
    print("✅ File saved successfully")
else:
    print("")
    print("⚠  No changes were made.")
    print("   The file may already be patched, or its structure differs from expected.")
    print("   Check: grep -n 'binance\\|Binance' " + target + " | head -20")
PYEOF

python3 "$PYSCRIPT" "$TARGET"
PATCH_EXIT=$?

if [[ $PATCH_EXIT -ne 0 ]]; then
    warn "Python patch script exited with errors — check output above"
    warn "Backup preserved at: $BACKUP"
    exit 1
fi

# ── Verification ───────────────────────────────────────────────
echo ""
echo "── Verification ─────────────────────────────────────────"
REMAINING=$(grep -ic "api.binance.com" "$TARGET" 2>/dev/null || echo 0)
KRAKEN_REFS=$(grep -ic "api.kraken.com" "$TARGET" 2>/dev/null || echo 0)

if [[ "$REMAINING" -eq 0 ]]; then
    ok "No remaining api.binance.com references ✓"
else
    warn "$REMAINING api.binance.com reference(s) still present — check manually"
fi

if [[ "$KRAKEN_REFS" -gt 0 ]]; then
    ok "Kraken API reference present ($KRAKEN_REFS occurrence(s)) ✓"
else
    warn "No api.kraken.com found — patch may not have applied"
fi

echo ""
echo "── Live test ─────────────────────────────────────────────"
echo -n "   Kraken API reachable from server: "
HTTP=$(curl -so /dev/null -w "%{http_code}" --max-time 5 \
    "https://api.kraken.com/0/public/Ticker?pair=XBTUSD" 2>/dev/null || echo "000")
if [[ "$HTTP" == "200" ]]; then
    BTC=$(curl -s --max-time 5 "https://api.kraken.com/0/public/Ticker?pair=XBTUSD" \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print('BTC=' + d['result']['XXBTZUSD']['c'][0])" \
        2>/dev/null || echo "parse error")
    ok "HTTP $HTTP — $BTC"
else
    warn "HTTP $HTTP — unexpected (Kraken should be globally accessible)"
fi

echo ""
echo "════════════════════════════════════════════════════"
echo " Done. No server restart needed."
echo " Hard-refresh browser: Ctrl+Shift+R  (or Cmd+Shift+R)"
echo " Backup: $BACKUP"
echo "════════════════════════════════════════════════════"
