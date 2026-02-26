"""
═══════════════════════════════════════════════════════════════
AgoraIQ Output Plugin for Intelligent Trading Bot (ITB)

Drop this file into ITB's  outputs/  directory and add the
following output_set to your ITB config:

    {
      "generator": "notifier_agoraiq",
      "config": {
          "agoraiq_url": "https://agoraiq.net/api/v1/providers/itb/signals",
          "agoraiq_token": "<your-provider-token>",
          "provider_key": "itb-btc-1h-svc",
          "include_transaction": true,
          "include_diagram_flag": false
      }
    }

Then register the generator in ITB's  common/generators.py  inside
the  output_feature_set()  function:

    elif generator == "notifier_agoraiq":
        generator_fn = send_agoraiq_signal

Signal lifecycle:
  1. ITB produces buy_signal_column / sell_signal_column + trade_score
  2. This plugin captures the signal + all scoring metadata
  3. POSTs to AgoraIQ's ingestion API (idempotent, safe to retry)
  4. AgoraIQ creates Signal → Trade → alerts paid subscribers

═══════════════════════════════════════════════════════════════
"""

import logging
from datetime import datetime, timezone
from typing import Optional

import requests
import pandas as pd
import pandas.api.types as ptypes

from service.App import App
from common.model_store import ModelStore

log = logging.getLogger("notifier_agoraiq")


# ── Main Entry Point ───────────────────────────────────────────
# Signature matches ITB's output_feature_set dispatcher:
#   async def fn(df, config, app_config, model_store)

async def send_agoraiq_signal(
    df: pd.DataFrame,
    model: dict,
    config: dict,
    model_store: ModelStore,
) -> None:
    """
    Extract the latest signal from ITB's DataFrame and POST it
    to AgoraIQ's ingestion endpoint.

    Expected model (config) keys:
        agoraiq_url       – Full ingestion URL
        agoraiq_token     – X-AgoraIQ-Provider-Token value
        provider_key      – Unique key for this ITB instance
        buy_signal_column – Bool column name (default: buy_signal_column)
        sell_signal_column– Bool column name (default: sell_signal_column)
        score_column      – Signed score column (default: trade_score)
        secondary_score_column – Optional 2nd score column
        include_transaction – Include profit data from App.transaction
    """

    agoraiq_url = model.get("agoraiq_url")
    agoraiq_token = model.get("agoraiq_token")
    provider_key = model.get("provider_key", "itb")

    if not agoraiq_url or not agoraiq_token:
        log.error("agoraiq_url and agoraiq_token are required in config")
        return

    symbol = config.get("symbol", "BTCUSDT")
    freq = config.get("freq", "1h")

    # ── Extract signal from last row ───────────────────────────

    buy_col = model.get("buy_signal_column", "buy_signal_column")
    sell_col = model.get("sell_signal_column", "sell_signal_column")
    score_col = model.get("score_column", "trade_score")
    secondary_col = model.get("secondary_score_column")

    row = df.iloc[-1]

    # Resolve timestamp
    interval_length = pd.Timedelta(freq).to_pytimedelta()
    if ptypes.is_datetime64_any_dtype(df.index):
        close_time = row.name + interval_length
    elif config.get("time_column") in df.columns:
        close_time = row[config["time_column"]] + interval_length
    else:
        close_time = datetime.now(timezone.utc)

    # Determine action
    buy_signal = bool(row.get(buy_col, False)) if buy_col in df.columns else False
    sell_signal = bool(row.get(sell_col, False)) if sell_col in df.columns else False

    if buy_signal and sell_signal:
        action = "HOLD"  # conflicting — skip or mark as HOLD
    elif buy_signal:
        action = "BUY"
    elif sell_signal:
        action = "SELL"
    else:
        action = "HOLD"

    # If HOLD and config says skip holds, return early
    if action == "HOLD" and not model.get("send_holds", False):
        return

    # ── Extract scores ─────────────────────────────────────────

    close_price = float(row.get("close", 0))
    trade_score = float(row.get(score_col, 0)) if score_col in df.columns else None

    # Derive confidence from absolute score magnitude [0..1]
    # ITB scores typically range [-1, +1], so abs(score) is a
    # natural confidence proxy
    confidence = min(abs(trade_score), 1.0) if trade_score is not None else None

    secondary_score = (
        float(row.get(secondary_col, 0))
        if secondary_col and secondary_col in df.columns
        else None
    )

    # ── Resolve band from score (mirrors ITB's _find_score_band) ─

    band_no, band_sign, band_text = _resolve_band(trade_score, model)

    # ── Build meta with full ITB context ───────────────────────

    meta = {
        "source": "itb",
        "itb_version": "1.0",
        "description": config.get("description", ""),
        "trade_score": trade_score,
        "secondary_score": secondary_score,
        "band_no": band_no,
        "band_sign": band_sign,
        "band_text": band_text,
        "close_price": close_price,
        "open": float(row.get("open", 0)) if "open" in df.columns else None,
        "high": float(row.get("high", 0)) if "high" in df.columns else None,
        "low": float(row.get("low", 0)) if "low" in df.columns else None,
        "volume": float(row.get("volume", 0)) if "volume" in df.columns else None,
    }

    # Add transaction profit data if available
    if model.get("include_transaction", False) and App.transaction:
        meta["transaction"] = {
            "status": App.transaction.get("status"),
            "price": App.transaction.get("price"),
            "profit": App.transaction.get("profit"),
        }

    # ── Build AgoraIQ payload ──────────────────────────────────

    payload = {
        "schema_version": "1.1",
        "provider_key": provider_key,
        "symbol": symbol,
        "timeframe": _freq_to_timeframe(freq),
        "action": action,
        "score": _clamp01(confidence),
        "confidence": _clamp01(confidence),
        "ts": close_time.isoformat() if hasattr(close_time, "isoformat") else str(close_time),
        "price": close_price if close_price > 0 else None,
        "meta": meta,
    }

    # ── POST to AgoraIQ ────────────────────────────────────────

    headers = {
        "Content-Type": "application/json",
        "X-AgoraIQ-Provider-Token": agoraiq_token,
    }

    try:
        resp = requests.post(
            agoraiq_url,
            json=payload,
            headers=headers,
            timeout=10,
        )

        if resp.status_code == 201:
            data = resp.json()
            log.info(
                f"Signal ingested → signalId={data.get('signalId')} "
                f"tradeId={data.get('tradeId')} "
                f"[{action} {symbol} score={trade_score:.3f}]"
            )
        elif resp.status_code == 200:
            log.info(f"Duplicate signal (idempotent skip) [{action} {symbol}]")
        else:
            log.error(
                f"AgoraIQ ingestion failed: {resp.status_code} {resp.text[:200]}"
            )

    except requests.exceptions.Timeout:
        log.error("AgoraIQ ingestion timeout (10s)")
    except requests.exceptions.ConnectionError as e:
        log.error(f"AgoraIQ connection error: {e}")
    except Exception as e:
        log.error(f"AgoraIQ ingestion error: {e}")


# ── Helpers ────────────────────────────────────────────────────


def _resolve_band(
    score: Optional[float], model: dict
) -> tuple:
    """
    Mirror ITB's _find_score_band logic to include band info
    in the AgoraIQ payload.
    """
    if score is None:
        return (0, "", "neutral")

    # Check positive bands (buy side)
    bands = model.get("positive_bands", [])
    bands = sorted(bands, key=lambda x: x.get("edge", 0), reverse=True)
    for i, band in enumerate(bands):
        if score >= band.get("edge", 0):
            return (
                len(bands) - i,
                band.get("sign", ""),
                band.get("text", ""),
            )

    # Check negative bands (sell side)
    bands = model.get("negative_bands", [])
    bands = sorted(bands, key=lambda x: x.get("edge", 0), reverse=False)
    for i, band in enumerate(bands):
        if score < band.get("edge", 0):
            return (
                -(len(bands) - i),
                band.get("sign", ""),
                band.get("text", ""),
            )

    return (0, "", "neutral")


def _freq_to_timeframe(freq: str) -> str:
    """Convert ITB pandas frequency to AgoraIQ timeframe string."""
    mapping = {
        "1min": "1m",
        "5min": "5m",
        "15min": "15m",
        "30min": "30m",
        "1h": "1h",
        "4h": "4h",
        "1D": "1d",
        "1W": "1w",
    }
    return mapping.get(freq, freq)


def _clamp01(v: Optional[float]) -> Optional[float]:
    """Clamp a value to [0, 1] or return None."""
    if v is None:
        return None
    return max(0.0, min(1.0, v))
