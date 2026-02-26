# How to Run the Tracker Worker

## What It Does

The tracker worker is a long-running process that resolves paper trades:

1. **Polls** all trades with status `ACTIVE` every 30 seconds
2. **Fetches** current price from exchange APIs (Binance by default)
3. **Checks** if price hit Take Profit (TP) or Stop Loss (SL)
4. **Updates** trade status to `HIT_TP`, `HIT_SL`, or `EXPIRED`
5. **Calculates** R-multiple and P&L percentage
6. **Logs** resolution to audit trail

## Configuration

```env
TRACKER_POLL_INTERVAL_MS=30000      # Poll every 30s
TRACKER_DEFAULT_TIMEOUT_HOURS=72    # Expire after 72h
TRACKER_DEFAULT_TP_PCT=3.0          # Default TP distance
TRACKER_DEFAULT_SL_PCT=1.5          # Default SL distance
BINANCE_API_BASE=https://api.binance.com
BINANCE_FUTURES_API_BASE=https://fapi.binance.com
```

## Running

### Development
```bash
cd /opt/agoraiq
pnpm dev:tracker
```

### Production (systemd)
```bash
sudo systemctl start agoraiq-tracker
sudo systemctl status agoraiq-tracker
sudo journalctl -u agoraiq-tracker -f
```

## Resolution Rules

### Entry Price
- Uses the price provided in the signal payload
- If no price: trade stays ACTIVE until price is fetched (future enhancement)

### Exit Conditions
| Condition | Status | Exit Price |
|-----------|--------|------------|
| Price hits TP | `HIT_TP` | TP price |
| Price hits SL | `HIT_SL` | SL price |
| Both hit same candle | `HIT_SL` | SL price (conservative) |
| Timeout exceeded | `EXPIRED` | null |

### R-Multiple Calculation
- **LONG**: `(exitPrice - entryPrice) / (entryPrice - slPrice)`
- **SHORT**: `(entryPrice - exitPrice) / (slPrice - entryPrice)`

### P&L Percentage
- **LONG**: `((exitPrice - entryPrice) / entryPrice) × 100 × leverage`
- **SHORT**: `((entryPrice - exitPrice) / entryPrice) × 100 × leverage`

## Monitoring

```bash
# Check active trade count
sudo -u postgres psql agoraiq -c "SELECT count(*) FROM trades WHERE status='ACTIVE';"

# Check recent resolutions
sudo -u postgres psql agoraiq -c "
  SELECT symbol, direction, status, \"rMultiple\", \"pnlPct\", \"exitedAt\"
  FROM trades WHERE status != 'ACTIVE'
  ORDER BY \"exitedAt\" DESC LIMIT 10;
"

# Check tracker logs
sudo journalctl -u agoraiq-tracker --since '1 hour ago' | grep -E 'hit|expired|resolv'
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Trades not resolving | Check tracker is running, exchange APIs accessible |
| Price fetch failing | Check BINANCE_API_BASE, network access, rate limits |
| All trades expiring | Check TP/SL calculations, price accuracy |
| High latency | Increase poll interval or reduce batch size |
