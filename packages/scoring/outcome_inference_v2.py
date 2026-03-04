#!/usr/bin/env python3
"""
Outcome Inference v2 — Kraken first, Binance-via-SOCKS5 fallback.
"""
import os, sys, asyncio, logging, time, json, socket
import asyncpg
from urllib.request import urlopen, Request
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)-5s %(message)s')
log = logging.getLogger('outcome-inference-v2')

DATABASE_URL = os.environ.get('DATABASE_URL', '').split('?')[0]

# Setup SOCKS5 proxy for Binance
import socks
_orig_socket = socket.socket

def enable_proxy():
    socks.set_default_proxy(socks.SOCKS5, '143.198.202.65', 1080)
    socket.socket = socks.socksocket

def disable_proxy():
    socket.socket = _orig_socket

def fetch_kraken(symbol: str, start_ts: int) -> list:
    KMAP = {
        'BTCUSDT':'XBTUSDT','ETHUSDT':'ETHUSDT','SOLUSDT':'SOLUSDT','ADAUSDT':'ADAUSDT',
        'LINKUSDT':'LINKUSDT','DOTUSDT':'DOTUSDT','DOGEUSDT':'XDGUSDT','XRPUSDT':'XRPUSDT',
        'AVAXUSDT':'AVAXUSDT','NEARUSDT':'NEARUSDT','ATOMUSDT':'ATOMUSDT','APTUSDT':'APTUSDT',
        'ARBUSDT':'ARBUSDT','SUIUSDT':'SUIUSDT','INJUSDT':'INJUSDT','AAVEUSDT':'AAVEUSDT',
        'UNIUSDT':'UNIUSDT','LTCUSDT':'XLTCUSDT','BCHUSDT':'BCHUSDT','TRXUSDT':'TRXUSDT',
        'SHIBUSDT':'SHIBUSDT','PEPEUSDT':'PEPEUSDT','BONKUSDT':'BONKUSDT',
    }
    ksym = KMAP.get(symbol)
    if not ksym:
        return []
    disable_proxy()
    try:
        url = f"https://api.kraken.com/0/public/OHLC?pair={ksym}&interval=60&since={start_ts}"
        with urlopen(Request(url, headers={'User-Agent':'AgoraIQ/1.0'}), timeout=10) as r:
            data = json.loads(r.read())
            if data.get('error') and len(data['error']) > 0:
                return []
            for k, v in data.get('result', {}).items():
                if k != 'last' and isinstance(v, list):
                    return [(float(c[2]), float(c[3]), int(c[0])) for c in v]
    except:
        pass
    return []

def fetch_binance(symbol: str, start_ms: int, end_ms: int) -> list:
    enable_proxy()
    # Try spot first
    for base in ['https://api.binance.com/api/v3/klines', 'https://fapi.binance.com/fapi/v1/klines']:
        try:
            url = f"{base}?symbol={symbol}&interval=1h&startTime={start_ms}&endTime={end_ms}&limit=1000"
            with urlopen(Request(url, headers={'User-Agent':'AgoraIQ/1.0'}), timeout=12) as r:
                data = json.loads(r.read())
                if data:
                    return [(float(c[2]), float(c[3]), int(c[0])//1000) for c in data]
        except:
            continue
    disable_proxy()
    return []

def check_outcome(candles, entry, sl, tp, direction):
    is_long = direction.upper() in ('LONG', 'BUY', '')
    for high, low, ts in candles:
        if is_long:
            sl_hit = low <= sl if sl > 0 else False
            tp_hit = high >= tp if tp > 0 else False
        else:
            sl_hit = high >= sl if sl > 0 else False
            tp_hit = low <= tp if tp > 0 else False
        if sl_hit and tp_hit:
            return ('HIT_SL', sl, ts)
        elif tp_hit:
            return ('HIT_TP', tp, ts)
        elif sl_hit:
            return ('HIT_SL', sl, ts)
    return (None, None, None)

async def run():
    if not DATABASE_URL:
        log.error('DATABASE_URL not set'); sys.exit(1)
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=3)

    trades = await pool.fetch("""
        SELECT id, symbol, direction, "entryPrice", "slPrice", "tpPrice",
               "enteredAt", "timeoutAt"
        FROM trades
        WHERE status = 'EXPIRED'
          AND "entryPrice" IS NOT NULL AND "slPrice" IS NOT NULL AND "tpPrice" IS NOT NULL
        ORDER BY "enteredAt" DESC
    """)
    log.info(f'Found {len(trades)} remaining expired trades')

    resolved = 0; no_hit = 0; failed = 0
    sym_cache = {}  # symbol -> 'kraken'|'binance'|'fail'

    for i, t in enumerate(trades):
        symbol = t['symbol'].replace('/', '').upper()
        entry = float(t['entryPrice'])
        sl = float(t['slPrice'])
        tp = float(t['tpPrice'])
        direction = t['direction'] or 'LONG'
        entered = t['enteredAt']
        timeout = t['timeoutAt'] or entered
        start_ts = int(entered.timestamp())
        start_ms = start_ts * 1000
        end_ms = int(timeout.timestamp()) * 1000
        if end_ms <= start_ms:
            end_ms = start_ms + 72 * 3600_000

        candles = []
        source = sym_cache.get(symbol)

        if source == 'fail':
            failed += 1
            continue

        # Try Kraken first (no proxy needed)
        if source is None or source == 'kraken':
            candles = fetch_kraken(symbol, start_ts)
            if candles:
                sym_cache[symbol] = 'kraken'

        # Fallback to Binance via proxy
        if not candles and source != 'kraken':
            candles = fetch_binance(symbol, start_ms, end_ms)
            if candles:
                sym_cache[symbol] = 'binance'
            time.sleep(0.4)

        if not candles:
            sym_cache[symbol] = 'fail'
            failed += 1
            continue

        status, exit_price, exit_ts = check_outcome(candles, entry, sl, tp, direction)

        if status:
            risk = abs(entry - sl)
            r_mult = ((exit_price - entry) / risk if direction.upper() in ('LONG','BUY','') else (entry - exit_price) / risk) if risk > 0 else 0
            pnl = ((exit_price - entry) / entry * 100) if direction.upper() in ('LONG','BUY','') else ((entry - exit_price) / entry * 100)
            exit_at = datetime.utcfromtimestamp(exit_ts)

            await pool.execute("""
                UPDATE trades SET status=$1, "exitPrice"=$2, "exitedAt"=$3, "rMultiple"=$4, "pnlPct"=$5,
                    notes = COALESCE(notes,'') || ' [inferred]'
                WHERE id=$6
            """, status, exit_price, exit_at, round(r_mult, 4), round(pnl, 4), t['id'])
            resolved += 1
        else:
            no_hit += 1

        if (i + 1) % 25 == 0:
            log.info(f'Progress: {i+1}/{len(trades)} resolved={resolved} no_hit={no_hit} failed={failed}')

    disable_proxy()
    log.info(f'DONE: {resolved} resolved, {no_hit} no TP/SL hit, {failed} no candles')
    counts = await pool.fetch("SELECT status, COUNT(*) as cnt FROM trades GROUP BY 1 ORDER BY cnt DESC")
    for r in counts:
        log.info(f'  {r["status"]}: {r["cnt"]}')
    await pool.close()

if __name__ == '__main__':
    asyncio.run(run())
