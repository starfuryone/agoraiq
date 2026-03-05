import ccxt
import pandas as pd
import logging
from typing import Optional
from cachetools import TTLCache
from src.config.settings import settings

log = logging.getLogger("ta-engine.exchange")

# Cache: (symbol, timeframe) -> DataFrame
_ohlcv_cache: TTLCache = TTLCache(maxsize=500, ttl=120)

_exchanges = {}


def _get_exchange(name: str) -> ccxt.Exchange:
    if name not in _exchanges:
        params = {"enableRateLimit": True}
        if name == "binance" and settings.BINANCE_PROXY:
            params["proxies"] = {
                "http": settings.BINANCE_PROXY,
                "https": settings.BINANCE_PROXY,
            }
        cls = getattr(ccxt, name)
        _exchanges[name] = cls(params)
    return _exchanges[name]


def _cache_ttl(tf: str) -> int:
    m = {
        "15m": settings.CACHE_TTL_15M,
        "1h": settings.CACHE_TTL_1H,
        "4h": settings.CACHE_TTL_4H,
        "1d": settings.CACHE_TTL_1D,
    }
    return m.get(tf, 300)


async def fetch_ohlcv(
    symbol: str,
    timeframe: str = "1h",
    limit: int = 200,
    exchange_name: Optional[str] = None,
) -> Optional[pd.DataFrame]:
    cache_key = f"{symbol}:{timeframe}:{exchange_name or settings.EXCHANGE}"
    if cache_key in _ohlcv_cache:
        return _ohlcv_cache[cache_key]

    for exch_name in [exchange_name or settings.EXCHANGE, settings.EXCHANGE_FALLBACK]:
        try:
            exch = _get_exchange(exch_name)
            ohlcv = exch.fetch_ohlcv(symbol, timeframe, limit=limit)
            if not ohlcv or len(ohlcv) < 20:
                continue

            df = pd.DataFrame(ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"])
            df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
            df.set_index("timestamp", inplace=True)
            df = df.astype(float)

            _ohlcv_cache[cache_key] = df
            log.debug(f"Fetched {len(df)} candles for {symbol} {timeframe} from {exch_name}")
            return df

        except ccxt.BadSymbol:
            log.warning(f"{symbol} not found on {exch_name}")
            continue
        except Exception as e:
            log.warning(f"Failed {symbol} {timeframe} on {exch_name}: {e}")
            continue

    log.error(f"Could not fetch {symbol} {timeframe} from any exchange")
    return None


def get_current_price(df: pd.DataFrame) -> float:
    return float(df["close"].iloc[-1])


def get_24h_stats(df: pd.DataFrame) -> dict:
    if len(df) < 2:
        return {}
    last = df.iloc[-1]
    return {
        "price": float(last["close"]),
        "open_24h": float(df["open"].iloc[-24]) if len(df) >= 24 else float(df["open"].iloc[0]),
        "high_24h": float(df["high"].iloc[-24:].max()) if len(df) >= 24 else float(df["high"].max()),
        "low_24h": float(df["low"].iloc[-24:].min()) if len(df) >= 24 else float(df["low"].min()),
        "volume_24h": float(df["volume"].iloc[-24:].sum()) if len(df) >= 24 else float(df["volume"].sum()),
    }
