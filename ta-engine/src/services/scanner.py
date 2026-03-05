import asyncio
import logging
from datetime import datetime, timezone
from src.config.settings import settings
from src.services.compute import compute_events
from src.services.forwarder import forward_events_to_agoraiq

log = logging.getLogger("ta-engine.scanner")

_running = False


async def scan_all_symbols():
    """Scan all configured symbols across all timeframes for events."""
    global _running
    if _running:
        log.debug("Scan already in progress, skipping")
        return
    _running = True
    all_events = []
    start = datetime.now(timezone.utc)

    try:
        for symbol in settings.SYMBOLS:
            for tf in settings.TIMEFRAMES:
                try:
                    events = await compute_events(symbol, tf)
                    if events:
                        all_events.extend(events)
                        log.info(f"{symbol} {tf}: {len(events)} events")
                except Exception as e:
                    log.warning(f"Scan error {symbol} {tf}: {e}")
                # Small delay to respect rate limits
                await asyncio.sleep(0.3)

        elapsed = (datetime.now(timezone.utc) - start).total_seconds()
        log.info(f"Scan complete: {len(settings.SYMBOLS)} symbols × {len(settings.TIMEFRAMES)} tf = {len(all_events)} events in {elapsed:.1f}s")

        # Forward critical/warning events to AgoraIQ
        important = [e for e in all_events if e.severity in ("critical", "warning")]
        if important:
            await forward_events_to_agoraiq(important)
            log.info(f"Forwarded {len(important)} important events to AgoraIQ")

    except Exception as e:
        log.error(f"Scan failed: {e}")
    finally:
        _running = False

    return all_events


async def start_scanner():
    """Run the scanner on intervals matching timeframes."""
    log.info("TA Scanner started")
    while True:
        try:
            await scan_all_symbols()
        except Exception as e:
            log.error(f"Scanner loop error: {e}")
        # Scan every 5 minutes
        await asyncio.sleep(300)
