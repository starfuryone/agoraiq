#!/bin/bash
set -e

echo "=== AgoraIQ TA Engine Installer ==="

# 1. Copy files
echo "[1/6] Installing to /opt/agoraiq/ta-engine..."
mkdir -p /opt/agoraiq/ta-engine
cp -r src requirements.txt .env /opt/agoraiq/ta-engine/

# 2. Create venv & install deps
echo "[2/6] Creating Python venv..."
cd /opt/agoraiq/ta-engine
python3 -m venv venv
source venv/bin/activate

echo "[3/6] Installing dependencies (this may take a minute)..."
pip install --upgrade pip -q
pip install -r requirements.txt -q

# 3. Install systemd service
echo "[4/6] Installing systemd service..."
cp agoraiq-ta-engine.service /etc/systemd/system/ 2>/dev/null || \
  cp /opt/agoraiq/ta-engine/agoraiq-ta-engine.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable agoraiq-ta-engine

# 4. Add Caddy route
echo "[5/6] Checking Caddy config..."
if ! grep -q 'ta-engine' /etc/caddy/Caddyfile 2>/dev/null; then
  echo "  Add this block to your app.agoraiq.net section in /etc/caddy/Caddyfile:"
  echo "    handle /ta/* {"
  echo "        reverse_proxy 127.0.0.1:3200"
  echo "    }"
  echo "  Then: systemctl reload caddy"
else
  echo "  Caddy route already exists"
fi

# 5. Start
echo "[6/6] Starting TA Engine..."
systemctl start agoraiq-ta-engine
sleep 2

# Verify
if curl -sf http://127.0.0.1:3200/health > /dev/null; then
  echo ""
  echo "=== TA Engine is LIVE on port 3200 ==="
  echo "  Health:   curl http://127.0.0.1:3200/health"
  echo "  Snapshot: curl 'http://127.0.0.1:3200/ta/snapshot?symbol=BTC/USDT&tf=1h'"
  echo "  Events:   curl 'http://127.0.0.1:3200/ta/events?symbol=BTC/USDT&tf=15m'"
  echo "  Batch:    curl -X POST http://127.0.0.1:3200/ta/batch -H 'Content-Type: application/json' -d '{\"symbols\":[\"BTC/USDT\",\"ETH/USDT\"],\"timeframes\":[\"1h\"]}'"
  echo "  Docs:     http://127.0.0.1:3200/docs"
else
  echo "WARNING: Health check failed. Check: journalctl -u agoraiq-ta-engine -n 30"
fi
