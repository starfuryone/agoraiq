#!/usr/bin/env python3
"""
AgoraIQ Telegram Channel Listener v2 — Format-Aware Parser
"""

import os, re, json, asyncio, logging
from datetime import datetime, timezone
from typing import Optional
from telethon import TelegramClient, events
from telethon.tl.types import Channel, Message
import aiohttp

API_ID = int(os.environ.get("TG_API_ID", "32452303"))
API_HASH = os.environ.get("TG_API_HASH", "9cf53f422de73e3d9307163739bf6eff")
SESSION_NAME = os.environ.get("TG_SESSION_NAME", "agoraiq_listener")
API_URL = os.environ.get("AGORAIQ_API_URL", "http://127.0.0.1:4000/api/v1/providers")
LOG_LEVEL = os.environ.get("LISTENER_LOG_LEVEL", "INFO")

logging.basicConfig(level=getattr(logging, LOG_LEVEL), format="%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger("tg-listener")

CHANNELS = {
    "RAVENSignalspro_io": {"slug": "raven-signals-pro", "token": "87e40426d96d94078f3486a982902c6b4423883f4708def0dbe087c1abbd44f5"},
    "BTCUSDTRADINGSIGNAL2": {"slug": "btc-usd-trading", "token": "1a1c7758172bfbc0de4a90cf19176905eb084b3294a9138950ee6e1391e95164"},
    "BlackPinkWhale": {"slug": "black-pink-whale", "token": "8333e509cf44b291f660902e68f9341faf777b508af63f3ca01b1f0622923883"},
    "Fat_Pig_Signals1": {"slug": "fat-pig-signals", "token": "0e46e9793bea04d0de71852afbd85798f32693a847eca9653a1ddaae4b08897d"},
    "Crypto_Whales_Pumps_Guide": {"slug": "crypto-whales-pumps", "token": "9ec9f6aed002b84c0a6ead8ceb0382a746138d171b6297a2890fe9e6644915ff"},
    "wolfof_trading_vip": {"slug": "wolf-of-trading", "token": "3d9b557996ef0c4642bfda781abf748677f34a810be541b0e832a6ebb169b45d"},
    "WallStreetqueens_Official": {"slug": "wallstreet-queens", "token": "9c512b36d5c061d00db755d6a51844f02851cf783c9b169430c3b6c362cc29ae"},
    "asac41": {"slug": "asac41", "token": "d9eff7c877c41ad8a5b3b3130eb8137727f3d67b7b1f0d77b18aabb361dce99b"},
    "FedRussianInsidersTG": {"slug": "fed-russian-insiders", "token": "12294441c3c41f29209637c71ecf60982c47d1cf239b7310188a8c17b03330f5"},
    "Crypto_Inner_Circles1": {"slug": "crypto-inner-circles", "token": "40b149a631ab644fca936099f9947c93a8c0bef2a4d9aa85891fcd574b693ced"},
    "Signals_3Commas": {"slug": "signals-3commas", "token": "50b3fccf1f10b47af6509c99f45d2744d1d2e4899c960c4d6fe0af393b1ff629"},
    "JacobCryptoBury_1Live": {"slug": "jacob-crypto-bury", "token": "fa3311a0337a58e1a4d5338ccf866527e87db7be8c4a6d1d269ad2fda5d88aed"},
    "Rocket_Wallet_Officials": {"slug": "rocket-wallet", "token": "e7144987e9014179b30c8e1b380a7b157b73f6e663a24afbab79793b5588cd33"},
}

KNOWN_PAIRS = {
    "BTC","ETH","SOL","XRP","DOGE","ADA","AVAX","DOT","MATIC","LINK","UNI","AAVE","LTC","BCH",
    "ATOM","FIL","APT","ARB","OP","SUI","SEI","TIA","NEAR","FTM","INJ","RUNE","PEPE","WIF",
    "BONK","SHIB","BNB","TRX","ALGO","VET","SAND","MANA","CRV","MKR","COMP","SNX","RENDER",
    "FET","ONDO","JUP","WLD","STRK","PYTH","JTO","DYM","ORDI","NOT","TON","ENA","ETHFI",
    "TAO","KAS","RNDR","AR","THETA","HBAR","XLM","ICP","GRT","AXS","FLOW","NEO","QTUM",
    "EOS","ZEC","DASH","XTZ","IOTA","ONE","ZIL","BAT","DYDX","GMT","JASMY","CHZ","GALA",
    "ENS","IMX","LDO","PENDLE","STX","BLUR","CFX","ACH","HOOK","EDU","BOME","MANTA",
    "PIXEL","PORTAL","AEVO","1000PEPE","1000SHIB","1000BONK","1000FLOKI","PEOPLE","IO",
    "CELO","RSR","ANKR","BAND","SUSHI","YFI","1INCH","MASK","DENT","HOT","WIN","CKB",
}

def clean_text(text):
    t = text.replace("**", "").replace("__", "").replace("``", "")
    t = re.sub(r'\*+', '', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t

def parse_number(s):
    return float(s.replace(",", "").strip())

def extract_signal(text):
    if not text or len(text) < 15:
        return None
    raw = text
    text = clean_text(text)
    upper = text.upper()

    # Skip non-signal messages
    skip_patterns = [
        r"TARGET[S]?\s*\d.*DONE", r"PROFIT\s+IN\s+\d", r"CONGRATULAT",
        r"ALL\s*TARGET", r"CLOSED\s*(IN\s*PROFIT|WITH)", r"RESULT[S]?\s*:",
        r"JOIN\s*(VIP|PREMIUM|NOW)", r"SUBSCRIBE\b", r"PROMOTION",
        r"ADVERTISEMENT", r"FOLLOW\s+US", r"REFERRAL", r"GIVEAWAY",
    ]
    for pat in skip_patterns:
        if re.search(pat, upper):
            return None

    # Skip mostly non-Latin (Korean, Chinese, etc.)
    latin_chars = len(re.findall(r'[a-zA-Z0-9]', text))
    if len(text) > 20 and latin_chars < len(text) * 0.3:
        return None

    # ── Extract pair ──────────────────────────────────
    symbol = None

    # Format: "Coin : #LTC/USDT" or "#BTC/USDT"
    m = re.search(r'#?([A-Z0-9]{2,10})\s*/\s*(USDT?|BUSD|USDC|BTC|ETH)', text, re.IGNORECASE)
    if m:
        base = m.group(1).upper()
        quote = m.group(2).upper()
        if quote == "USD": quote = "USDT"
        symbol = f"{base}{quote}"

    # Format: "BTCUSDT" standalone
    if not symbol:
        m = re.search(r'(?:^|\s|#|\$)([A-Z0-9]{2,10})(USDT|BUSD|USDC)(?:\s|$|[.!?,:])', text, re.IGNORECASE)
        if m:
            symbol = f"{m.group(1).upper()}{m.group(2).upper()}"

    # Format: "#BTC" or "$ETH" known pair
    if not symbol:
        m = re.search(r'[#$]([A-Z0-9]{2,10})\b', text, re.IGNORECASE)
        if m and m.group(1).upper() in KNOWN_PAIRS:
            symbol = f"{m.group(1).upper()}USDT"

    # Known pair mentioned anywhere
    if not symbol:
        for pair in sorted(KNOWN_PAIRS, key=len, reverse=True):
            pat = re.compile(r'(?:^|\s|#|\$|/)' + pair + r'(?:\s|$|/|[.!?,:])', re.IGNORECASE)
            if pat.search(text):
                symbol = f"{pair}USDT"
                break

    if not symbol:
        return None

    # ── Extract direction ─────────────────────────────
    action = None

    if re.search(r'(?:🔴|🟠)\s*SHORT|SHORT\s*(?:🔴|🟠)', text, re.IGNORECASE):
        action = "SELL"
    elif re.search(r'(?:🟢|🟡|🔵)\s*LONG|LONG\s*(?:🟢|🟡|🔵)', text, re.IGNORECASE):
        action = "BUY"
    elif re.search(r'\bLONG\b', upper):
        action = "BUY"
    elif re.search(r'\bSHORT\b', upper):
        action = "SELL"
    elif re.search(r'\b(BUY|BUYING|GO\s+LONG|BULLISH)\b', upper):
        action = "BUY"
    elif re.search(r'\b(SELL|SELLING|GO\s+SHORT|BEARISH)\b', upper):
        action = "SELL"
    elif "🟢" in raw or "🔵" in raw:
        action = "BUY"
    elif "🔴" in raw or "🟠" in raw:
        action = "SELL"

    if not action:
        return None

    # ── Extract entry price ───────────────────────────
    entry_price = None

    # Range: "Entry: 51.16 - 52.69"
    m = re.search(r'(?:entry|enter|buy\s*(?:at|zone|price)?|sell\s*(?:at|zone|price)?)\s*:?\s*\$?\s*(\d+[.,]?\d*)\s*[-–]\s*\$?\s*(\d+[.,]?\d*)', text, re.IGNORECASE)
    if m:
        entry_price = (parse_number(m.group(1)) + parse_number(m.group(2))) / 2

    # Single: "Entry: 51.16"
    if entry_price is None:
        m = re.search(r'(?:entry|enter|buy\s*(?:at|zone|price|@)?|sell\s*(?:at|zone|price|@)?|entry\s*(?:point|zone)?)\s*:?\s*\$?\s*(\d+[.,]?\d*)', text, re.IGNORECASE)
        if m:
            entry_price = parse_number(m.group(1))

    # ── Extract take profit targets ───────────────────
    tp_matches = re.findall(r'(?:target|tp|take\s*profit)\s*\d*\s*:?\s*\$?\s*(\d+[.,]?\d*)', text, re.IGNORECASE)
    tp_prices = [parse_number(t) for t in tp_matches][:5] if tp_matches else []

    # ── Extract stop loss ─────────────────────────────
    sl_price = None
    m = re.search(r'(?:❌\s*)?(?:stop\s*loss|stoploss|sl)\s*:?\s*\$?\s*(\d+[.,]?\d*)', text, re.IGNORECASE)
    if m:
        sl_price = parse_number(m.group(1))

    # ── Extract leverage ──────────────────────────────
    leverage = None
    m = re.search(r'(?:leverage|lev)\s*:?\s*(\d+)\s*[xX]|(\d+)\s*[xX]\s*(?:leverage)?', text, re.IGNORECASE)
    if m:
        leverage = int(m.group(1) or m.group(2))

    # ── Timeframe ─────────────────────────────────────
    tf_match = re.search(r'\b(\d+[mhHdDwW]|1[hH]|4[hH]|15[mM]|30[mM]|1[dD])\b', text)
    timeframe = tf_match.group(1) if tf_match else "1h"

    # ── Confidence ────────────────────────────────────
    score = 0.3
    if entry_price: score += 0.2
    if tp_prices: score += 0.2
    if sl_price: score += 0.2
    if leverage: score += 0.1

    return {
        "symbol": symbol, "action": action, "timeframe": timeframe,
        "entry_price": entry_price, "tp_prices": tp_prices,
        "sl_price": sl_price, "leverage": leverage,
        "confidence": round(min(score, 1.0), 2),
    }

async def post_signal(session, slug, token, signal, raw_text):
    url = f"{API_URL}/{slug}/signals"
    payload = {
        "schema_version": "1.0", "provider_key": slug,
        "symbol": signal["symbol"], "timeframe": signal["timeframe"],
        "action": signal["action"], "confidence": signal["confidence"],
        "ts": datetime.now(timezone.utc).isoformat(),
        "price": signal.get("entry_price"),
        "meta": {
            "source": "telegram", "raw_text": raw_text[:2000],
            "tp_prices": signal.get("tp_prices", []),
            "sl_price": signal.get("sl_price"),
            "leverage": signal.get("leverage"),
            "entry_price": signal.get("entry_price"),
        },
    }
    headers = {"Content-Type": "application/json", "X-AgoraIQ-Provider-Token": token}
    try:
        async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            status = resp.status
            body = await resp.text()
            if status in (200, 201):
                log.info(f"✅ Ingested: {signal['symbol']} {signal['action']} via {slug} entry={signal.get('entry_price')} tp={signal.get('tp_prices')} sl={signal.get('sl_price')}")
            elif status == 409:
                log.debug(f"⏭ Duplicate: {signal['symbol']} via {slug}")
            else:
                log.warning(f"❌ Failed ({status}): {body[:200]}")
    except Exception as e:
        log.error(f"❌ API error for {slug}: {e}")

async def handle_message(event, http_session):
    msg = event.message
    if not msg or not msg.text:
        return
    chat = await event.get_chat()
    username = getattr(chat, "username", None)
    if not username or username not in CHANNELS:
        return
    cfg = CHANNELS[username]
    text = msg.text.strip()
    if len(text) < 15:
        return
    log.debug(f"📩 [{username}] {text[:120]}...")
    signal = extract_signal(text)
    if not signal:
        log.debug(f"⏭ [{username}] No signal detected")
        return
    log.info(f"🔍 [{username}] Parsed: {signal['symbol']} {signal['action']} entry={signal.get('entry_price')} tp={signal.get('tp_prices')} sl={signal.get('sl_price')} lev={signal.get('leverage')}")
    await post_signal(http_session, cfg["slug"], cfg["token"], signal, text)

async def main():
    log.info("🚀 AgoraIQ Telegram Listener v2 starting...")
    log.info(f"📡 Monitoring {len(CHANNELS)} channels")
    client = TelegramClient(SESSION_NAME, API_ID, API_HASH)
    await client.start()
    me = await client.get_me()
    log.info(f"✅ Logged in as {me.first_name} ({me.phone})")
    resolved_ids = []
    for username in CHANNELS:
        try:
            entity = await client.get_entity(f"@{username}")
            resolved_ids.append(entity.id)
            log.info(f"✅ Resolved @{username} → {entity.id}")
        except Exception as e:
            log.warning(f"⚠ Could not resolve @{username}: {e}")
    log.info(f"📡 Listening to {len(resolved_ids)} channels")
    http_session = aiohttp.ClientSession()
    @client.on(events.NewMessage(chats=resolved_ids))
    async def on_new_message(event):
        try:
            await handle_message(event, http_session)
        except Exception as e:
            log.error(f"❌ Handler error: {e}", exc_info=True)
    log.info("🟢 Listener v2 running — waiting for signals...")
    try:
        await client.run_until_disconnected()
    finally:
        await http_session.close()

if __name__ == "__main__":
    asyncio.run(main())
