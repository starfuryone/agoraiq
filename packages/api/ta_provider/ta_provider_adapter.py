#!/usr/bin/env python3
"""
AgoraIQ TA Engine → Signal Provider Adapter
Polls /ta/events per symbol/tf, computes direction from event weights,
fetches /ta/snapshot for price levels, inserts into signals table.
Run via systemd timer every 5 min.
"""
import asyncio, hashlib, httpx, json, logging, os, sys
from datetime import datetime, timezone, timedelta
import psycopg2
from psycopg2.extras import RealDictCursor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [TA-ADAPTER] %(levelname)s %(message)s"
)
log = logging.getLogger("ta-adapter")

TA_BASE      = "https://app.agoraiq.net"
PROVIDER_ID  = "ta-engine-agoraiq"
PROVIDER_KEY = "ta-engine-agoraiq"
WORKSPACE_ID = "proof-workspace-default"
DB_URL       = os.getenv("DATABASE_URL", "postgresql://agoraiq:Desf19848@127.0.0.1:5432/agoraiq")

SYMBOLS = [
    "BTC/USDT","ETH/USDT","SOL/USDT","BNB/USDT","XRP/USDT",
    "ADA/USDT","AVAX/USDT","DOT/USDT","LINK/USDT","LTC/USDT",
    "DOGE/USDT","ATOM/USDT","UNI/USDT","MATIC/USDT","FIL/USDT",
]
TIMEFRAMES = ["15m", "1h", "4h", "1d"]

LONG_EVENTS  = {"rsi_oversold","golden_cross","macd_bullish_cross",
                "bb_lower_touch","ichimoku_bullish_cross","stoch_oversold"}
SHORT_EVENTS = {"rsi_overbought","death_cross","macd_bearish_cross",
                "bb_upper_touch","stoch_overbought"}
WEIGHTS = {
    "golden_cross":3,"death_cross":3,"ichimoku_bullish_cross":3,
    "macd_bullish_cross":2,"macd_bearish_cross":2,"strong_trend":2,
    "rsi_oversold":1,"rsi_overbought":1,"bb_lower_touch":1,
    "bb_upper_touch":1,"stoch_oversold":1,"stoch_overbought":1,
    "bb_squeeze":0,
}
TF_CONF = {"15m":40.0,"1h":60.0,"4h":80.0,"1d":85.0}

def make_cuid_like():
    import random, string, time
    ts = hex(int(time.time()*1000))[2:]
    rand = ''.join(random.choices(string.ascii_lowercase + string.digits, k=20))
    return f"c{ts}{rand}"

def compute_signal(events, snap):
    long_s = short_s = 0
    names = [e.get("event_type","") for e in events]
    for n in names:
        w = WEIGHTS.get(n, 1)
        if n in LONG_EVENTS:      long_s  += w
        elif n in SHORT_EVENTS:   short_s += w
        elif n == "strong_trend":
            close = float(snap.get("price") or 0)
            ema21 = float(((snap.get("indicators") or {}).get("ema_21") or 0))
            if close > ema21: long_s  += w
            else:              short_s += w
    if long_s == 0 and short_s == 0: return None
    if long_s == short_s:            return None
    direction = "LONG" if long_s > short_s else "SHORT"
    close = float(snap.get("price") or 0)
    atr   = float(((snap.get("indicators") or {}).get("atr_14") or 0))
    bb_up = float(((snap.get("indicators") or {}).get("bb_upper") or 0))
    bb_lo = float(((snap.get("indicators") or {}).get("bb_lower") or 0))
    if close == 0 or atr == 0: return None
    if direction == "LONG":
        sl  = round(close - 1.5*atr, 6)
        tp1 = round(close + 1.5*atr, 6)
        tp2 = round(close + 3.0*atr, 6)
        tp3 = round(bb_up, 6) if bb_up > close else round(close + 4.5*atr, 6)
    else:
        sl  = round(close + 1.5*atr, 6)
        tp1 = round(close - 1.5*atr, 6)
        tp2 = round(close - 3.0*atr, 6)
        tp3 = round(bb_lo, 6) if 0 < bb_lo < close else round(close - 4.5*atr, 6)
    return {
        "direction": direction,
        "entry": round(close, 6),
        "sl": sl, "targets": [tp1, tp2, tp3],
        "events": names, "long_s": long_s, "short_s": short_s,
    }

async def fetch(client, url, params=None):
    try:
        r = await client.get(url, params=params, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.warning(f"fetch {url} {params} → {e}")
        return None

def already_exists(cur, symbol, tf, direction):
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=90)
    cur.execute("""
        SELECT id FROM signals
        WHERE "providerId"=%s AND symbol=%s AND timeframe=%s AND action=%s
          AND "signalTs" >= %s
        LIMIT 1
    """, (PROVIDER_ID, symbol.replace("/",""), tf, direction, cutoff))
    return cur.fetchone() is not None

def insert_signal(cur, symbol, tf, sig, snap):
    sym     = symbol.replace("/","")
    entry   = sig["entry"]
    now_ts  = datetime.now(timezone.utc)
    idem    = hashlib.sha256(
        f"{PROVIDER_ID}:{sym}:{tf}:{sig['direction']}:{round(entry,2)}:{now_ts.strftime('%Y%m%d%H')}".encode()
    ).hexdigest()[:32]
    sid     = make_cuid_like()
    meta    = {
        "tf": tf, "events": sig["events"],
        "long_score": sig["long_s"], "short_score": sig["short_s"],
        "sl": sig["sl"], "targets": sig["targets"],
        "atr": ((snap.get("indicators") or {}).get("atr_14")), "rsi_14": ((snap.get("indicators") or {}).get("rsi_14")),
        "adx": ((snap.get("indicators") or {}).get("adx_14")),
    }
    raw     = {
        "source": "ta-engine",
        "symbol": symbol, "timeframe": tf,
        "action": sig["direction"],
        "entry": entry, "sl": sig["sl"],
        "targets": sig["targets"],
        "events": sig["events"],
    }
    cur.execute("""
        INSERT INTO signals (
            id, "idempotencyKey", "schemaVersion",
            "providerKey", "providerId", "workspaceId",
            symbol, timeframe, action,
            confidence, score, price,
            "signalTs", meta, "rawPayload",
            "createdAt"
        ) VALUES (
            %s,%s,'1.0',
            %s,%s,%s,
            %s,%s,%s,
            %s,%s,%s,
            %s,%s,%s,
            NOW()
        )
        ON CONFLICT ("idempotencyKey") DO NOTHING
    """, (
        sid, idem,
        PROVIDER_KEY, PROVIDER_ID, WORKSPACE_ID,
        sym, tf, sig["direction"],
        TF_CONF.get(tf, 60.0),
        float(sig["long_s"] + sig["short_s"]),
        entry,
        now_ts, json.dumps(meta), json.dumps(raw),
    ))
    return cur.rowcount

async def run():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False

    # Health check
    async with httpx.AsyncClient() as client:
        health = await fetch(client, f"{TA_BASE}/ta/health")
        if not health:
            log.error("TA Engine unreachable — aborting")
            conn.close()
            return
        log.info(f"TA Engine healthy: {health}")

        total = 0
        for symbol in SYMBOLS:
            for tf in TIMEFRAMES:
                events_data = await fetch(client, f"{TA_BASE}/ta/events",
                                          {"symbol": symbol, "tf": tf})
                if not events_data:
                    continue
                events = events_data if isinstance(events_data, list) \
                         else events_data.get("events", [])
                if not events:
                    continue

                snap = await fetch(client, f"{TA_BASE}/ta/snapshot",
                                   {"symbol": symbol, "tf": tf})
                if not snap:
                    continue

                sig = compute_signal(events, snap)
                if not sig:
                    log.debug(f"skip {symbol} {tf} — inconclusive")
                    continue

                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    if already_exists(cur, symbol, tf, sig["direction"]):
                        log.info(f"dedup {symbol} {tf} {sig['direction']} (last 90 min)")
                        continue
                    rows = insert_signal(cur, symbol, tf, sig, snap)
                    conn.commit()
                    if rows:
                        total += 1
                        log.info(
                            f"SIGNAL {symbol} {tf} {sig['direction']} "
                            f"entry={sig['entry']} sl={sig['sl']} "
                            f"tps={sig['targets']} events={sig['events']}"
                        )

    conn.close()
    log.info(f"Done — {total} new signals inserted")

if __name__ == "__main__":
    asyncio.run(run())
