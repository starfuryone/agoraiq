import httpx
import logging
from typing import List
from src.models.schemas import TAEvent
from src.config.settings import settings

log = logging.getLogger("ta-engine.forwarder")


async def forward_events_to_agoraiq(events: List[TAEvent]):
    """Push detected TA events to AgoraIQ's SSE feed endpoint."""
    if not events or not settings.AGORAIQ_INTERNAL_API_KEY:
        return

    url = f"{settings.AGORAIQ_API_URL}/api/v1/feed/emit"

    async with httpx.AsyncClient(timeout=10) as client:
        for event in events:
            try:
                payload = {
                    "type": "ta_event",
                    "provider": "TA Engine",
                    "pair": event.symbol,
                    "result": event.title,
                    "metadata": {
                        "event_type": event.event_type,
                        "severity": event.severity,
                        "timeframe": event.timeframe,
                        "description": event.description,
                        "indicator_values": event.indicator_values,
                        "price": event.price_at_event,
                    },
                }
                r = await client.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {settings.AGORAIQ_INTERNAL_API_KEY}"},
                )
                if r.status_code == 200:
                    log.info(f"Forwarded: {event.title}")
                else:
                    log.warning(f"Forward failed ({r.status_code}): {event.title}")
            except Exception as e:
                log.warning(f"Forward error: {e}")
