#!/usr/bin/env python3
"""Join one pending Telegram channel per run. Designed for hourly cron."""

import asyncio
import json
import os
import sys

from telethon import TelegramClient
from telethon.tl.functions.channels import JoinChannelRequest
from telethon.errors import FloodWaitError, ChannelPrivateError

STATE_FILE = "/opt/agoraiq/packages/listener/pending_joins.json"
SESSION = "/opt/agoraiq/packages/listener/agoraiq_listener"
API_ID = 32452303
API_HASH = "9cf53f422de73e3d9307163739bf6eff"

ALL_PENDING = [
    "cryptosignals0rg",
    "coincodecap",
    "Coin_Signals",
    "forexsignalstrialgroup",
    "sureshot_fx",
    "onwardbtc_official",
    "VerifiedCryptoTraders",
    "Rocket_Wallet_Officials",
]


def load_pending():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return list(ALL_PENDING)


def save_pending(pending):
    with open(STATE_FILE, "w") as f:
        json.dump(pending, f)


async def join_one():
    pending = load_pending()
    if not pending:
        print("✅ All channels joined. Removing cron job.")
        os.system('crontab -l 2>/dev/null | grep -v "join_one_channel" | crontab -')
        if os.path.exists(STATE_FILE):
            os.remove(STATE_FILE)
        return

    channel = pending[0]
    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.start()

    try:
        await client(JoinChannelRequest(channel))
        print(f"✅ Joined @{channel}")
        pending.pop(0)
    except FloodWaitError as e:
        print(f"⏳ @{channel}: flood wait {e.seconds}s — will retry next hour")
    except ChannelPrivateError:
        print(f"🔒 @{channel}: private/invite-only — skipping")
        pending.pop(0)
    except Exception as e:
        print(f"❌ @{channel}: {e} — skipping")
        pending.pop(0)

    save_pending(pending)
    await client.disconnect()

    if not pending:
        print("✅ All done. Removing cron job and restarting listener.")
        os.system('crontab -l 2>/dev/null | grep -v "join_one_channel" | crontab -')
        os.system("systemctl restart agoraiq-listener")
        if os.path.exists(STATE_FILE):
            os.remove(STATE_FILE)
    else:
        print(f"📋 {len(pending)} channels remaining: {pending}")


if __name__ == "__main__":
    asyncio.run(join_one())
