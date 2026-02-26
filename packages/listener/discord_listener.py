#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════
# @agoraiq/listener — Discord Signal Listener
#
# Monitors configured Discord channels for trading signals.
# Reuses the same parser as the Telegram listener.
# ═══════════════════════════════════════════════════════════════

import os
import re
import asyncio
import logging
import aiohttp
import discord
from datetime import datetime, timezone

logging.basicConfig(level=os.environ.get("LISTENER_LOG_LEVEL", "INFO").upper(),
                    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("discord-listener")

# ── Config ─────────────────────────────────────────────────────
DISCORD_TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "")
API_URL = os.environ.get("AGORAIQ_API_URL", "http://127.0.0.1:4000/api/v1/providers")

# ── Channel Config ─────────────────────────────────────────────
# Map Discord channel IDs to provider slugs and webhook secrets
# Format: CHANNEL_ID: { "slug": "provider-slug", "token": "webhookSecret" }
#
# To get channel IDs: Enable Developer Mode in Discord settings,
# right-click a channel → Copy Channel ID
#
# Add your channels here:
CHANNELS = {
    # "1234567890123456789": {"slug": "discord-provider-1", "token": "secret-here"},
    # "9876543210987654321": {"slug": "discord-provider-2", "token": "secret-here"},
}

# Also support env var config: DISCORD_CHANNELS=id1:slug1:token1,id2:slug2:token2
env_channels = os.environ.get("DISCORD_CHANNELS", "")
if env_channels:
    for entry in env_channels.split(","):
        parts = entry.strip().split(":")
        if len(parts) >= 3:
            cid, slug, token = parts[0], parts[1], parts[2]
            CHANNELS[cid] = {"slug": slug, "token": token}

# ── Known Pairs (same as Telegram listener) ────────────────────
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

# ── Parser (identical to Telegram listener) ────────────────────
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

    skip_patterns = [
        r"TARGET[S]?\s*\d.*DONE", r"PROFIT\s+IN\s+\d", r"CONGRATULAT",
        r"ALL\s*TARGET", r"CLOSED\s*(IN\s*PROFIT|WITH)", r"RESULT[S]?\s*:",
        r"JOIN\s*(VIP|PREMIUM|NOW)", r"SUBSCRIBE\b", r"PROMOTION",
        r"ADVERTISEMENT", r"FOLLOW\s+US", r"REFERRAL", r"GIVEAWAY",
    ]
    for pat in skip_patterns:
        if re.search(pat, upper):
            return None

    latin_chars = len(re.findall(r'[a-zA-Z0-9]', text))
    if len(text) > 20 and latin_chars < len(text) * 0.3:
        return None

    # ── Extract pair
    symbol = None
    m = re.search(r'#?([A-Z0-9]{2,10})\s*/\s*(USDT?|BUSD|USDC|BTC|ETH)', text, re.IGNORECASE)
    if m:
        base = m.group(1).upper()
        quote = m.group(2).upper()
        if quote == "USD": quote = "USDT"
        symbol = f"{base}{quote}"

    if not symbol:
        m = re.search(r'(?:^|\s|#|\$)([A-Z0-9]{2,10})(USDT|BUSD|USDC)(?:\s|$|[.!?,:])', text, re.IGNORECASE)
        if m:
            symbol = f"{m.group(1).upper()}{m.group(2).upper()}"

    if not symbol:
        m = re.search(r'[#$]([A-Z0-9]{2,10})\b', text, re.IGNORECASE)
        if m and m.group(1).upper() in KNOWN_PAIRS:
            symbol = f"{m.group(1).upper()}USDT"

    if not symbol:
        for pair in sorted(KNOWN_PAIRS, key=len, reverse=True):
            pat = re.compile(r'(?:^|\s|#|\$|/)' + pair + r'(?:\s|$|/|[.!?,:])', re.IGNORECASE)
            if pat.search(text):
                symbol = f"{pair}USDT"
                break

    if not symbol:
        return None

    # ── Extract direction
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

    # ── Extract entry price
    entry_price = None
    m = re.search(r'(?:entry|enter|buy\s*(?:at|zone|price)?|sell\s*(?:at|zone|price)?)\s*:?\s*\$?\s*(\d+[.,]?\d*)\s*[-–]\s*\$?\s*(\d+[.,]?\d*)', text, re.IGNORECASE)
    if m:
        entry_price = (parse_number(m.group(1)) + parse_number(m.group(2))) / 2
    if entry_price is None:
        m = re.search(r'(?:entry|enter|buy\s*(?:at|zone|price|@)?|sell\s*(?:at|zone|price|@)?|entry\s*(?:point|zone)?)\s*:?\s*\$?\s*(\d+[.,]?\d*)', text, re.IGNORECASE)
        if m:
            entry_price = parse_number(m.group(1))

    # ── Extract take profit targets
    tp_matches = re.findall(r'(?:target|tp|take\s*profit)\s*\d*\s*:?\s*\$?\s*(\d+[.,]?\d*)', text, re.IGNORECASE)
    tp_prices = [parse_number(t) for t in tp_matches][:5] if tp_matches else []

    # ── Extract stop loss
    sl_price = None
    m = re.search(r'(?:❌\s*)?(?:stop\s*loss|stoploss|sl)\s*:?\s*\$?\s*(\d+[.,]?\d*)', text, re.IGNORECASE)
    if m:
        sl_price = parse_number(m.group(1))

    # ── Extract leverage
    leverage = None
    m = re.search(r'(?:leverage|lev)\s*:?\s*(\d+)\s*[xX]|(\d+)\s*[xX]\s*(?:leverage)?', text, re.IGNORECASE)
    if m:
        leverage = int(m.group(1) or m.group(2))

    # ── Timeframe
    tf_match = re.search(r'\b(\d+[mhHdDwW]|1[hH]|4[hH]|15[mM]|30[mM]|1[dD])\b', text)
    timeframe = tf_match.group(1) if tf_match else "1h"

    # ── Confidence
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

# ── Post Signal to API ─────────────────────────────────────────
async def post_signal(session, slug, token, signal, raw_text):
    url = f"{API_URL}/{slug}/signals"
    payload = {
        "schema_version": "1.0", "provider_key": slug,
        "symbol": signal["symbol"], "timeframe": signal["timeframe"],
        "action": signal["action"], "confidence": signal["confidence"],
        "ts": datetime.now(timezone.utc).isoformat(),
        "price": signal.get("entry_price"),
        "meta": {
            "source": "discord", "raw_text": raw_text[:2000],
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

# ── Discord Bot ────────────────────────────────────────────────
intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents)
http_session = None

@client.event
async def on_ready():
    global http_session
    http_session = aiohttp.ClientSession()
    log.info(f"🟢 Discord listener ready as {client.user}")
    log.info(f"📡 Monitoring {len(CHANNELS)} channels")
    log.info(f"🏠 Connected to {len(client.guilds)} servers:")
    for guild in client.guilds:
        log.info(f"   • {guild.name} ({guild.id})")
        for channel in guild.text_channels:
            if str(channel.id) in CHANNELS:
                log.info(f"     ✅ #{channel.name} ({channel.id}) — mapped to {CHANNELS[str(channel.id)]['slug']}")

@client.event
async def on_message(message):
    global http_session
    if message.author == client.user:
        return
    if not message.content:
        return

    channel_id = str(message.channel.id)
    if channel_id not in CHANNELS:
        return

    cfg = CHANNELS[channel_id]
    text = message.content.strip()

    if len(text) < 15:
        return

    log.debug(f"📩 [#{message.channel.name}] {text[:120]}...")

    signal = extract_signal(text)
    if not signal:
        log.debug(f"⏭ [#{message.channel.name}] No signal detected")
        return

    log.info(f"🔍 [#{message.channel.name}] Parsed: {signal['symbol']} {signal['action']} entry={signal.get('entry_price')} tp={signal.get('tp_prices')} sl={signal.get('sl_price')} lev={signal.get('leverage')}")

    if http_session is None:
        http_session = aiohttp.ClientSession()

    await post_signal(http_session, cfg["slug"], cfg["token"], signal, text)

    # Also check embeds (some bots post signals as embeds)
    for embed in message.embeds:
        embed_text = ""
        if embed.title: embed_text += embed.title + " "
        if embed.description: embed_text += embed.description + " "
        for field in embed.fields:
            embed_text += f"{field.name}: {field.value} "
        if len(embed_text.strip()) >= 15:
            embed_signal = extract_signal(embed_text.strip())
            if embed_signal:
                log.info(f"🔍 [#{message.channel.name}] Parsed embed: {embed_signal['symbol']} {embed_signal['action']}")
                await post_signal(http_session, cfg["slug"], cfg["token"], embed_signal, embed_text.strip())

# ── Main ───────────────────────────────────────────────────────
if __name__ == "__main__":
    if not DISCORD_TOKEN:
        log.error("❌ DISCORD_BOT_TOKEN not set")
        exit(1)
    if not CHANNELS:
        log.warning("⚠ No channels configured — set DISCORD_CHANNELS env var or edit CHANNELS dict")
    log.info(f"🚀 AgoraIQ Discord Listener starting...")
    client.run(DISCORD_TOKEN, log_handler=None)
