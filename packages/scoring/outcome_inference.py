#!/usr/bin/env python3
"""
Outcome Inference — Resolve EXPIRED trades using Kraken OHLC candles.
"""
import os, sys, asyncio, logging, time, json
import asyncpg
from urllib.request import urlopen, Request
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)-5s %(message)s')
log = logging.getLogger('outcome-inference')

DATABASE_URL = os.environ.get('DATABASE_URL', '').split('?')[0]

# Kraken symbol mapping
KRAKEN_MAP = {
    'BTCUSDT': 'XBTUSDT', 'ETHUSDT': 'ETHUSDT', 'SOLUSDT': 'SOLUSDT',
    'ADAUSDT': 'ADAUSDT', 'LINKUSDT': 'LINKUSDT', 'DOTUSDT': 'DOTUSDT',
    'DOGEUSDT': 'XDGUSDT', 'XRPUSDT': 'XRPUSDT', 'AVAXUSDT': 'AVAXUSDT',
    'MATICUSDT': 'MATICUSDT', 'NEARUSDT': 'NEARUSDT', 'FTMUSDT': 'FTMUSDT',
    'ATOMUSDT': 'ATOMUSDT', 'APTUSDT': 'APTUSDT', 'ARBUSDT': 'ARBUSDT',
    'OPUSDT': 'OPUSDT', 'SUIUSDT': 'SUIUSDT', 'SEIUSDT': 'SEIUSDT',
    'INJUSDT': 'INJUSDT', 'TIAUSDT': 'TIAUSDT', 'RUNEUSDT': 'RUNEUSDT',
    'AAVEUSDT': 'AAVEUSDT', 'MKRUSDT': 'MKRUSDT', 'UNIUSDT': 'UNIUSDT',
    'LTCUSDT': 'XLTCUSDT', 'BCHUSDT': 'BCHUSDT', 'ETCUSDT': 'ETCUSDT',
    'FILUSDT': 'FILUSDT', 'ALGOUSDT': 'ALGOUSDT', 'XLMUSDT': 'XXLMUSDT',
    'TRXUSDT': 'TRXUSDT', 'ICPUSDT': 'ICPUSDT', 'VETUSDT': 'VETUSDT',
    'SANDUSDT': 'SANDUSDT', 'MANAUSDT': 'MANAUSDT', 'AXSUSDT': 'AXSUSDT',
    'GALAUSDT': 'GALAUSDT', 'ENJUSDT': 'ENJUSDT', 'CHZUSDT': 'CHZUSDT',
    'CRVUSDT': 'CRVUSDT', 'COMPUSDT': 'COMPUSDT', 'SNXUSDT': 'SNXUSDT',
    'SUSHIUSDT': 'SUSHIUSDT', 'YFIUSDT': 'YFIUSDT', 'ZECUSDT': 'XZECUSDT',
    'DASHUSDT': 'DASHUSDT', 'EOSUSDT': 'EOSUSDT', 'XTZUSDT': 'XTZUSDT',
    'THETAUSDT': 'THETAUSDT', 'GRTUSDT': 'GRTUSDT', 'PENDLEUSDT': 'PENDLEUSDT',
    'WLDUSDT': 'WLDUSDT', 'PEPEUSDT': 'PEPEUSDT', 'WIFUSDT': 'WIFUSDT',
    'FLOKIUSDT': 'FLOKIUSDT', 'BONKUSDT': 'BONKUSDT', 'SHIBUSDT': 'SHIBUSDT',
    'FETUSDT': 'FETUSDT', 'RENDERUSDT': 'RENDERUSDT', 'ONDOUSDT': 'ONDOUSDT',
    'JUPUSDT': 'JUPUSDT', 'STXUSDT': 'STXUSDT', 'IMXUSDT': 'IMXUSDT',
    'LDOUSDT': 'LDOUSDT', 'RNDRUSDT': 'RNDRUSDT',
}

def fetch_candles_kraken(symbol: str, start_ts: int) -> list:
    """Fetch 1h candles from Kraken. Returns [(high, low, timestamp_s), ...]"""
    kraken_sym = KRAKEN_MAP.get(symbol)
    if not kraken_sym:
        # Try direct
        kraken_sym = symbol
    url = f"https://api.kraken.com/0/public/OHLC?pair={kraken_sym}&interval=60&since={start_ts}"
    try:
        req = Request(url, headers={'User-Agent': 'AgoraIQ/1.0'})
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            if data.get('error') and len(data['error']) > 0:
                return []
            result = data.get('result', {})
            # Get first key that's not 'last'
            for k, v in result.items():
                if k != 'last' and isinstance(v, list):
                    # Each: [time, open, high, low, close, vwap, volume, count]
                    return [(float(c[2]), float(c[3]), int(c[0])) for c in v]
        return []
    except Exception as e:
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
               "enteredAt", "timeoutAt", "providerId"
        FROM trades
        WHERE status = 'EXPIRED'
          AND "entryPrice" IS NOT NULL AND "slPrice" IS NOT NULL AND "tpPrice" IS NOT NULL
        ORDER BY "enteredAt" DESC
    """)
    log.info(f'Found {len(trades)} expired trades to check')

    resolved = 0; failed = 0; no_hit = 0; unsupported = 0
    seen_symbols = {}

    for i, t in enumerate(trades):
        symbol = t['symbol'].replace('/', '').upper()
        entry = float(t['entryPrice'])
        sl = float(t['slPrice'])
        tp = float(t['tpPrice'])
        direction = t['direction'] or 'LONG'
        entered = t['enteredAt']
        start_ts = int(entered.timestamp())

        # Skip symbols we already know Kraken doesn't have
        if symbol in seen_symbols and seen_symbols[symbol] == 'fail':
            unsupported += 1
            continue

        candles = fetch_candles_kraken(symbol, start_ts)
        time.sleep(SLEEP_BETWEEN)

        if not candles:
            seen_symbols[symbol] = 'fail'
            failed += 1
            continue
        seen_symbols[symbol] = 'ok'

        status, exit_price, exit_ts = check_outcome(candles, entry, sl, tp, direction)

        if status:
            risk = abs(entry - sl)
            if risk > 0:
                r_mult = (exit_price - entry) / risk if direction.upper() in ('LONG','BUY','') else (entry - exit_price) / risk
            else:
                r_mult = 0
            pnl = ((exit_price - entry) / entry * 100) if direction.upper() in ('LONG','BUY','') else ((entry - exit_price) / entry * 100)
            exit_at = datetime.utcfromtimestamp(exit_ts) if exit_ts > 1e9 else datetime.utcnow()

            await pool.execute("""
                UPDATE trades SET status=$1, "exitPrice"=$2, "exitedAt"=$3, "rMultiple"=$4, "pnlPct"=$5,
                    notes = COALESCE(notes,'') || ' [inferred]'
                WHERE id=$6
            """, status, exit_price, exit_at, round(r_mult, 4), round(pnl, 4), t['id'])
            resolved += 1
        else:
            no_hit += 1

        if (i + 1) % 25 == 0:
            log.info(f'Progress: {i+1}/{len(trades)} resolved={resolved} no_hit={no_hit} failed={failed} unsupported={unsupported}')

    log.info(f'DONE: {resolved} resolved, {no_hit} no TP/SL hit, {failed} no candle data, {unsupported} unsupported symbol')

    counts = await pool.fetch("SELECT status, COUNT(*) as cnt FROM trades GROUP BY 1 ORDER BY cnt DESC")
    for r in counts:
        log.info(f'  {r["status"]}: {r["cnt"]}')
    await pool.close()

SLEEP_BETWEEN = 0.35

if __name__ == '__main__':
    asyncio.run(run())
