#!/usr/bin/env python3
"""
AgoraIQ Historical Backfill
Fetches past messages from all monitored Telegram channels,
runs them through the signal parser, and ingests via the API.

Usage:
  python3 backfill.py                    # default: last 30 days
  python3 backfill.py --days 7           # last 7 days
  python3 backfill.py --days 90          # last 90 days
  python3 backfill.py --channel BlackPinkWhale --days 14
  python3 backfill.py --dry-run          # parse only, don't POST
"""

import asyncio
import argparse
import logging
import os
import sys
from datetime import datetime, timezone, timedelta

import aiohttp
from telethon import TelegramClient

# ── Import the parser from the listener ───────────────────────
# Add the listener directory to sys.path so we can reuse extract_signal
LISTENER_DIR = "/opt/agoraiq/packages/listener"
sys.path.insert(0, LISTENER_DIR)
from listener import extract_signal, CHANNELS

# ── Config ────────────────────────────────────────────────────
API_ID = 32452303
API_HASH = "9cf53f422de73e3d9307163739bf6eff"
SESSION = os.path.join(LISTENER_DIR, "agoraiq_listener")
API_URL = os.environ.get("AGORAIQ_API_URL", "http://127.0.0.1:4000/api/v1/providers")

LOG_LEVEL = os.environ.get("BACKFILL_LOG_LEVEL", "INFO")
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("backfill")

# ── Stats ─────────────────────────────────────────────────────
stats = {
    "channels_processed": 0,
    "messages_scanned": 0,
    "signals_parsed": 0,
    "signals_ingested": 0,
    "duplicates": 0,
    "errors": 0,
    "skipped_no_parse": 0,
}


async def post_signal(session, slug, token, signal, raw_text, msg_date, dry_run=False):
    """Post a parsed signal to the AgoraIQ ingestion API."""
    # Use the original message timestamp, not now()
    ts = msg_date.strftime("%Y-%m-%dT%H:%M:%SZ")

    payload = {
        "schema_version": "1.0",
        "provider_key": slug,
        "symbol": signal["symbol"],
        "timeframe": signal.get("timeframe", "1h"),
        "action": signal["action"],
        "confidence": signal.get("confidence", 0.5),
        "ts": ts,
        "price": signal.get("entry_price"),
        "meta": {
            "source": "telegram_backfill",
            "raw_text": raw_text[:2000],
            "tp_prices": signal.get("tp_prices", []),
            "sl_price": signal.get("sl_price"),
            "leverage": signal.get("leverage"),
            "entry_price": signal.get("entry_price"),
            "backfill": True,
            "original_date": ts,
        },
    }
    headers = {
        "Content-Type": "application/json",
        "X-AgoraIQ-Provider-Token": token,
    }

    if dry_run:
        log.info(f"  [DRY-RUN] Would ingest: {signal['symbol']} {signal['action']} @ {ts} entry={signal.get('entry_price')} tp={signal.get('tp_prices')} sl={signal.get('sl_price')}")
        stats["signals_ingested"] += 1
        return

    url = f"{API_URL}/{slug}/signals"
    try:
        async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            status = resp.status
            body = await resp.text()
            if status in (200, 201):
                stats["signals_ingested"] += 1
                log.info(f"  ✅ Ingested: {signal['symbol']} {signal['action']} @ {ts}")
            elif status == 409:
                stats["duplicates"] += 1
                log.debug(f"  ⏭ Duplicate: {signal['symbol']} @ {ts}")
            elif status == 429:
                stats["errors"] += 1
                log.warning(f"  ⏳ Rate limited — waiting 30s...")
                await asyncio.sleep(30)
                # Retry once
                async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as retry_resp:
                    if retry_resp.status in (200, 201):
                        stats["signals_ingested"] += 1
                        stats["errors"] -= 1
                        log.info(f"  ✅ Retry OK: {signal['symbol']} {signal['action']} @ {ts}")
                    else:
                        log.warning(f"  ❌ Retry failed ({retry_resp.status})")
            else:
                stats["errors"] += 1
                log.warning(f"  ❌ Failed ({status}): {body[:200]}")
    except Exception as e:
        stats["errors"] += 1
        log.error(f"  ❌ API error: {e}")


async def backfill_channel(client, http_session, username, cfg, since, dry_run=False):
    """Fetch historical messages from a single channel and process them."""
    slug = cfg["slug"]
    token = cfg["token"]

    log.info(f"📥 [{username}] Fetching messages since {since.strftime('%Y-%m-%d')}...")

    try:
        entity = await client.get_entity(f"@{username}")
    except Exception as e:
        log.warning(f"⚠ [{username}] Could not resolve: {e}")
        return

    msg_count = 0
    signal_count = 0

    async for message in client.iter_messages(entity, offset_date=datetime.now(timezone.utc), reverse=False):
        # Stop if we've gone past our date range
        if message.date.replace(tzinfo=timezone.utc) < since:
            break

        if not message.text or len(message.text.strip()) < 15:
            continue

        msg_count += 1
        stats["messages_scanned"] += 1

        text = message.text.strip()
        signal = extract_signal(text)

        if not signal:
            stats["skipped_no_parse"] += 1
            continue

        signal_count += 1
        stats["signals_parsed"] += 1

        await post_signal(
            http_session, slug, token, signal, text,
            message.date.replace(tzinfo=timezone.utc),
            dry_run=dry_run,
        )

        # Small delay to avoid hammering the API
        await asyncio.sleep(0.5)

    stats["channels_processed"] += 1
    log.info(f"📊 [{username}] Done — {msg_count} messages scanned, {signal_count} signals parsed")


async def main():
    parser = argparse.ArgumentParser(description="AgoraIQ Historical Backfill")
    parser.add_argument("--days", type=int, default=30, help="Number of days to backfill (default: 30)")
    parser.add_argument("--channel", type=str, help="Specific channel username to backfill (default: all)")
    parser.add_argument("--dry-run", action="store_true", help="Parse only, don't POST to API")
    parser.add_argument("--limit", type=int, help="Max messages per channel")
    args = parser.parse_args()

    since = datetime.now(timezone.utc) - timedelta(days=args.days)
    channels_to_process = CHANNELS

    if args.channel:
        if args.channel in CHANNELS:
            channels_to_process = {args.channel: CHANNELS[args.channel]}
        else:
            log.error(f"Channel '{args.channel}' not found in CHANNELS config")
            log.info(f"Available: {', '.join(CHANNELS.keys())}")
            return

    log.info("=" * 60)
    log.info(f"🚀 AgoraIQ Historical Backfill")
    log.info(f"   Period: last {args.days} days (since {since.strftime('%Y-%m-%d')})")
    log.info(f"   Channels: {len(channels_to_process)}")
    log.info(f"   Mode: {'DRY-RUN (no API calls)' if args.dry_run else 'LIVE (posting to API)'}")
    log.info(f"   API: {API_URL}")
    log.info("=" * 60)

    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.start()
    me = await client.get_me()
    log.info(f"✅ Logged in as {me.first_name}")

    http_session = aiohttp.ClientSession()

    try:
        for username, cfg in channels_to_process.items():
            try:
                await backfill_channel(client, http_session, username, cfg, since, dry_run=args.dry_run)
            except Exception as e:
                log.error(f"❌ [{username}] Channel error: {e}")
                stats["errors"] += 1

            # Delay between channels to avoid Telegram rate limits
            await asyncio.sleep(5)
    finally:
        await http_session.close()
        await client.disconnect()

    # ── Summary ───────────────────────────────────────────────
    log.info("")
    log.info("=" * 60)
    log.info("📊 BACKFILL SUMMARY")
    log.info("=" * 60)
    log.info(f"   Channels processed:  {stats['channels_processed']}")
    log.info(f"   Messages scanned:    {stats['messages_scanned']}")
    log.info(f"   Signals parsed:      {stats['signals_parsed']}")
    log.info(f"   Signals ingested:    {stats['signals_ingested']}")
    log.info(f"   Duplicates skipped:  {stats['duplicates']}")
    log.info(f"   Parse failures:      {stats['skipped_no_parse']}")
    log.info(f"   Errors:              {stats['errors']}")
    log.info(f"   Parse rate:          {(stats['signals_parsed']/max(stats['messages_scanned'],1)*100):.1f}%")
    log.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
