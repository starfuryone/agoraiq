from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    HOST: str = "0.0.0.0"
    PORT: int = 3200
    LOG_LEVEL: str = "INFO"

    # Exchange config
    EXCHANGE: str = "kraken"           # primary exchange for OHLCV
    EXCHANGE_FALLBACK: str = "binance" # fallback
    BINANCE_PROXY: str = ""            # socks5://... if geo-blocked

    # Default symbols to track
    SYMBOLS: List[str] = [
        "BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT",
        "ADA/USDT", "AVAX/USDT", "DOGE/USDT", "DOT/USDT", "LINK/USDT",
        "MATIC/USDT", "UNI/USDT", "ATOM/USDT", "LTC/USDT", "ARB/USDT",
    ]

    # Default timeframes
    TIMEFRAMES: List[str] = ["15m", "1h", "4h", "1d"]

    # Cache TTL in seconds per timeframe
    CACHE_TTL_15M: int = 120
    CACHE_TTL_1H: int = 300
    CACHE_TTL_4H: int = 600
    CACHE_TTL_1D: int = 1800

    # AgoraIQ integration
    AGORAIQ_API_URL: str = "http://127.0.0.1:4000"
    AGORAIQ_INTERNAL_API_KEY: str = ""

    # Event detection thresholds
    RSI_OVERSOLD: float = 30.0
    RSI_OVERBOUGHT: float = 70.0
    BB_SQUEEZE_THRESHOLD: float = 0.02  # bandwidth %

    class Config:
        env_file = ".env"
        env_prefix = "TA_"


settings = Settings()
