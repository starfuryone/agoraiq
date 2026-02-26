// ═══════════════════════════════════════════════════════════════
// @agoraiq/telegram — Bot Entry Point
//
// Premium-only Telegram bot with:
//   - Onboarding: link Telegram user to AgoraIQ account
//   - Watchlists: /watch, /unwatch, /watchprovider
//   - Alerts: new signal notifications with inline buttons
//   - Recaps: daily digest
//   - Commands: /signals, /providers, /provider, /mute, /digest
//
// IMPORTANT: Bot NEVER sends public demo content. Bot is paid-only.
// ═══════════════════════════════════════════════════════════════

import { Telegraf, Markup, Context } from 'telegraf';
import { db, createLogger } from '@agoraiq/db';

const log = createLogger('telegram-bot');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_WORKSPACE_ID = process.env.TELEGRAM_DEFAULT_WORKSPACE_ID || 'proof-workspace-default';

if (!BOT_TOKEN) {
  log.error('TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ── Helpers ───────────────────────────────────────────────────

async function getTelegramUser(telegramId: string) {
  return db.telegramUser.findUnique({
    where: { telegramId },
    include: {
      user: {
        include: { subscription: true },
      },
    },
  });
}

async function requirePaid(ctx: Context): Promise<boolean> {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) { await ctx.reply('❌ Could not identify you.'); return false; }

  const tgUser = await getTelegramUser(telegramId);
  if (!tgUser) {
    await ctx.reply(
      '🔒 You need to link your AgoraIQ account first.\n\n' +
      'Use /start to begin onboarding.',
    );
    return false;
  }

  if (!tgUser.user.subscription || tgUser.user.subscription.status !== 'active') {
    await ctx.reply(
      '🔒 Active subscription required.\n\n' +
      'Visit https://agoraiq.net/settings/billing to subscribe.',
    );
    return false;
  }

  return true;
}

// ── /start — Onboarding ───────────────────────────────────────

bot.start(async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const existing = await getTelegramUser(telegramId);

  if (existing) {
    await ctx.reply(
      `✅ Welcome back! You're linked as ${existing.user.email}.\n\n` +
      'Commands:\n' +
      '/signals — Latest signals\n' +
      '/watch BTCUSDT — Add to watchlist\n' +
      '/providers — Provider leaderboard\n' +
      '/digest on|off — Toggle daily recap\n' +
      '/help — All commands',
    );
    return;
  }

  await ctx.reply(
    '👋 Welcome to AgoraIQ Signals!\n\n' +
    'To get started, link your account:\n' +
    '/link your@email.com your-password\n\n' +
    '(Your credentials are verified once and not stored in chat.)',
  );
});

// ── /link — Account Linking ───────────────────────────────────

bot.command('link', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const existing = await getTelegramUser(telegramId);
  if (existing) {
    await ctx.reply(`✅ Already linked as ${existing.user.email}`);
    return;
  }

  const args = ctx.message.text.split(' ').slice(1);
  if (args.length < 2) {
    await ctx.reply('Usage: /link your@email.com your-password');
    return;
  }

  const [email, password] = args;

  try {
    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      await ctx.reply('❌ Account not found. Sign up at https://agoraiq.net');
      return;
    }

    // Simple password check (in production, use bcrypt)
    const bcrypt = require('bcryptjs');
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await ctx.reply('❌ Invalid credentials.');
      return;
    }

    await db.telegramUser.create({
      data: {
        telegramId,
        userId: user.id,
        chatId: ctx.chat.id.toString(),
        username: ctx.from.username || null,
      },
    });

    // Delete the message containing credentials for security
    try { await ctx.deleteMessage(); } catch {}

    await ctx.reply(
      `✅ Linked to ${email}! Your credentials message has been deleted for security.\n\n` +
      'Use /help to see available commands.',
    );
  } catch (err) {
    log.error({ err }, 'Link command failed');
    await ctx.reply('❌ Something went wrong. Please try again.');
  }
});

// ── /help ─────────────────────────────────────────────────────

bot.help(async (ctx) => {
  await ctx.reply(
    '📋 AgoraIQ Commands:\n\n' +
    '/signals — Latest 10 signals\n' +
    '/watch BTCUSDT — Watch a symbol\n' +
    '/unwatch BTCUSDT — Unwatch a symbol\n' +
    '/watchprovider itb — Watch a provider\n' +
    '/providers — Provider leaderboard\n' +
    '/provider itb — Provider detail\n' +
    '/mute — Mute all alerts\n' +
    '/unmute — Unmute alerts\n' +
    '/digest on|off — Toggle daily recap\n' +
    '/status — Your account status',
  );
});

// ── /signals — Latest Signals ─────────────────────────────────

bot.command('signals', async (ctx) => {
  if (!(await requirePaid(ctx))) return;

  const telegramId = ctx.from!.id.toString();
  const tgUser = await getTelegramUser(telegramId);
  if (!tgUser) return;

  try {
    const signals = await db.signal.findMany({
      where: { workspaceId: tgUser.user.workspaceId },
      orderBy: { signalTs: 'desc' },
      take: 10,
      include: {
        trade: { select: { status: true, rMultiple: true, direction: true } },
        provider: { select: { slug: true } },
      },
    });

    if (signals.length === 0) {
      await ctx.reply('📭 No signals yet.');
      return;
    }

    const lines = signals.map((s, i) => {
      const emoji = s.action === 'BUY' ? '🟢' : s.action === 'SELL' ? '🔴' : '⚪';
      const status = s.trade?.status || 'PENDING';
      const r = s.trade?.rMultiple ? ` R:${s.trade.rMultiple.toFixed(1)}` : '';
      return `${i + 1}. ${emoji} ${s.symbol} ${s.timeframe} ${s.action} [${status}]${r} — ${s.provider.slug}`;
    });

    await ctx.reply(`📊 Latest Signals:\n\n${lines.join('\n')}`);
  } catch (err) {
    log.error({ err }, '/signals command failed');
    await ctx.reply('❌ Failed to fetch signals.');
  }
});

// ── /watch / /unwatch ─────────────────────────────────────────

bot.command('watch', async (ctx) => {
  if (!(await requirePaid(ctx))) return;
  const tgUser = await getTelegramUser(ctx.from!.id.toString());
  if (!tgUser) return;

  const symbol = ctx.message.text.split(' ')[1]?.toUpperCase();
  if (!symbol) { await ctx.reply('Usage: /watch BTCUSDT'); return; }

  try {
    await db.watchlist.upsert({
      where: { userId_type_value: { userId: tgUser.user.id, type: 'symbol', value: symbol } },
      update: { isActive: true },
      create: { userId: tgUser.user.id, type: 'symbol', value: symbol },
    });
    await ctx.reply(`✅ Watching ${symbol}`);
  } catch (err) {
    log.error({ err }, '/watch failed');
    await ctx.reply('❌ Failed to add watchlist.');
  }
});

bot.command('unwatch', async (ctx) => {
  if (!(await requirePaid(ctx))) return;
  const tgUser = await getTelegramUser(ctx.from!.id.toString());
  if (!tgUser) return;

  const symbol = ctx.message.text.split(' ')[1]?.toUpperCase();
  if (!symbol) { await ctx.reply('Usage: /unwatch BTCUSDT'); return; }

  try {
    await db.watchlist.updateMany({
      where: { userId: tgUser.user.id, type: 'symbol', value: symbol },
      data: { isActive: false },
    });
    await ctx.reply(`✅ Unwatched ${symbol}`);
  } catch (err) {
    log.error({ err }, '/unwatch failed');
    await ctx.reply('❌ Failed.');
  }
});

bot.command('watchprovider', async (ctx) => {
  if (!(await requirePaid(ctx))) return;
  const tgUser = await getTelegramUser(ctx.from!.id.toString());
  if (!tgUser) return;

  const slug = ctx.message.text.split(' ')[1]?.toLowerCase();
  if (!slug) { await ctx.reply('Usage: /watchprovider itb'); return; }

  try {
    await db.watchlist.upsert({
      where: { userId_type_value: { userId: tgUser.user.id, type: 'provider', value: slug.toUpperCase() } },
      update: { isActive: true },
      create: { userId: tgUser.user.id, type: 'provider', value: slug.toUpperCase() },
    });
    await ctx.reply(`✅ Watching provider: ${slug}`);
  } catch (err) {
    log.error({ err }, '/watchprovider failed');
    await ctx.reply('❌ Failed.');
  }
});

// ── /providers — Leaderboard ──────────────────────────────────

bot.command('providers', async (ctx) => {
  if (!(await requirePaid(ctx))) return;

  try {
    const providers = await db.provider.findMany({ where: { isActive: true } });
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600_000);

    const board = await Promise.all(
      providers.map(async (p) => {
        const trades = await db.trade.findMany({
          where: {
            providerId: p.id,
            status: { in: ['HIT_TP', 'HIT_SL'] },
            exitedAt: { gte: thirtyDaysAgo },
            rMultiple: { not: null },
          },
          select: { rMultiple: true },
        });
        const avgR = trades.length > 0
          ? trades.reduce((s, t) => s + (t.rMultiple || 0), 0) / trades.length
          : 0;
        const wins = trades.filter(t => (t.rMultiple || 0) > 0).length;
        const winRate = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(0) : '0';
        return { name: p.name, slug: p.slug, avgR, winRate, total: trades.length };
      }),
    );

    board.sort((a, b) => b.avgR - a.avgR);

    const lines = board.map((p, i) =>
      `${i + 1}. ${p.name} — WR: ${p.winRate}% | Avg R: ${p.avgR.toFixed(2)} | Trades: ${p.total}`,
    );

    await ctx.reply(`🏆 Provider Leaderboard (30d):\n\n${lines.join('\n') || 'No data yet.'}`);
  } catch (err) {
    log.error({ err }, '/providers failed');
    await ctx.reply('❌ Failed to load providers.');
  }
});

// ── /provider <slug> — Detail ─────────────────────────────────

bot.command('provider', async (ctx) => {
  if (!(await requirePaid(ctx))) return;

  const slug = ctx.message.text.split(' ')[1]?.toLowerCase();
  if (!slug) { await ctx.reply('Usage: /provider itb'); return; }

  try {
    const provider = await db.provider.findUnique({ where: { slug } });
    if (!provider) { await ctx.reply('❌ Provider not found.'); return; }

    const recent = await db.signal.findMany({
      where: { providerId: provider.id },
      orderBy: { signalTs: 'desc' },
      take: 5,
      include: { trade: { select: { status: true, rMultiple: true } } },
    });

    const lines = recent.map((s) => {
      const emoji = s.action === 'BUY' ? '🟢' : '🔴';
      const status = s.trade?.status || 'PENDING';
      return `${emoji} ${s.symbol} ${s.timeframe} [${status}]`;
    });

    await ctx.reply(
      `📡 ${provider.name}\n` +
      `Category: ${provider.proofCategory}\n\n` +
      `Recent signals:\n${lines.join('\n') || 'None yet.'}`,
    );
  } catch (err) {
    log.error({ err }, '/provider failed');
    await ctx.reply('❌ Failed.');
  }
});

// ── /mute, /unmute, /digest ───────────────────────────────────

bot.command('mute', async (ctx) => {
  const tgUser = await getTelegramUser(ctx.from!.id.toString());
  if (!tgUser) { await ctx.reply('Not linked. Use /start'); return; }
  await db.telegramUser.update({ where: { id: tgUser.id }, data: { muteAll: true } });
  await ctx.reply('🔇 Alerts muted.');
});

bot.command('unmute', async (ctx) => {
  const tgUser = await getTelegramUser(ctx.from!.id.toString());
  if (!tgUser) { await ctx.reply('Not linked. Use /start'); return; }
  await db.telegramUser.update({ where: { id: tgUser.id }, data: { muteAll: false } });
  await ctx.reply('🔊 Alerts unmuted.');
});

bot.command('digest', async (ctx) => {
  const tgUser = await getTelegramUser(ctx.from!.id.toString());
  if (!tgUser) { await ctx.reply('Not linked. Use /start'); return; }

  const arg = ctx.message.text.split(' ')[1]?.toLowerCase();
  const enabled = arg !== 'off';

  await db.telegramUser.update({ where: { id: tgUser.id }, data: { digestEnabled: enabled } });
  await ctx.reply(enabled ? '📬 Daily digest enabled.' : '📭 Daily digest disabled.');
});

// ── /status ───────────────────────────────────────────────────

bot.command('status', async (ctx) => {
  const tgUser = await getTelegramUser(ctx.from!.id.toString());
  if (!tgUser) { await ctx.reply('Not linked. Use /start'); return; }

  const sub = tgUser.user.subscription;
  const watchlists = await db.watchlist.findMany({
    where: { userId: tgUser.user.id, isActive: true },
  });

  const symbols = watchlists.filter(w => w.type === 'symbol').map(w => w.value);
  const providers = watchlists.filter(w => w.type === 'provider').map(w => w.value);

  await ctx.reply(
    `👤 ${tgUser.user.email}\n` +
    `📦 Plan: ${sub?.tier || 'none'} (${sub?.status || 'inactive'})\n` +
    `🔔 Alerts: ${tgUser.muteAll ? 'muted' : 'active'}\n` +
    `📬 Digest: ${tgUser.digestEnabled ? 'on' : 'off'}\n` +
    `📊 Watching symbols: ${symbols.join(', ') || 'none'}\n` +
    `📡 Watching providers: ${providers.join(', ') || 'none'}`,
  );
});

// ── Signal Alert Broadcaster ──────────────────────────────────
// Called externally when a new signal is ingested

export async function broadcastSignalAlert(signal: {
  symbol: string;
  timeframe: string;
  action: string;
  providerSlug: string;
  confidence?: number | null;
  signalId: string;
  // ITB-specific extended fields
  tradeId?: string | null;
  price?: number | null;
  tradeScore?: number | null;
  bandNo?: number | null;
  bandSign?: string | null;
  bandText?: string | null;
  ohlc?: { open: number; high: number; low: number; close?: number | null } | null;
  source?: string | null;
  description?: string | null;
}): Promise<void> {
  try {
    // Find all telegram users who watch this symbol or provider
    const watchingSymbol = await db.watchlist.findMany({
      where: { type: 'symbol', value: signal.symbol, isActive: true },
      include: {
        user: {
          include: {
            telegramUser: true,
            subscription: true,
          },
        },
      },
    });

    const watchingProvider = await db.watchlist.findMany({
      where: { type: 'provider', value: signal.providerSlug.toUpperCase(), isActive: true },
      include: {
        user: {
          include: {
            telegramUser: true,
            subscription: true,
          },
        },
      },
    });

    // Combine unique users
    const userMap = new Map<string, any>();
    for (const w of [...watchingSymbol, ...watchingProvider]) {
      if (w.user.telegramUser && !w.user.telegramUser.muteAll &&
          w.user.subscription?.status === 'active') {
        userMap.set(w.user.id, {
          tgUser: w.user.telegramUser,
          tier: w.user.subscription.tier,
        });
      }
    }

    // ── Build messages by tier ──────────────────────────────
    // Pro+ users get full signal data; Starter gets basic

    const isItb = signal.source === 'itb';
    const actionEmoji = signal.action === 'BUY' ? '🟢' : signal.action === 'SELL' ? '🔴' : '⚪';

    for (const [_, { tgUser, tier }] of userMap) {
      try {
        let message: string;

        if ((tier === 'pro' || tier === 'team' || tier === 'vendor') && isItb) {
          // ── Full ITB signal (Pro+) ──────────────────────
          const scoreLine = signal.tradeScore !== null && signal.tradeScore !== undefined
            ? `Score: \`${signal.tradeScore >= 0 ? '+' : ''}${signal.tradeScore.toFixed(3)}\``
            : '';
          const bandLine = signal.bandSign || signal.bandText
            ? `Band: ${signal.bandSign || ''} ${signal.bandText || ''}`
            : '';
          const priceLine = signal.price
            ? `Price: \`$${signal.price.toLocaleString()}\``
            : '';
          const confLine = signal.confidence
            ? `Confidence: ${(signal.confidence * 100).toFixed(0)}%`
            : '';
          const ohlcLine = signal.ohlc
            ? `O: ${signal.ohlc.open.toFixed(2)} H: ${signal.ohlc.high.toFixed(2)} L: ${signal.ohlc.low.toFixed(2)}`
            : '';

          message =
            `${actionEmoji} *${signal.action} ${signal.symbol}* ${signal.timeframe}\n` +
            `Provider: ${signal.providerSlug}\n` +
            [priceLine, scoreLine, bandLine, confLine, ohlcLine]
              .filter(Boolean)
              .join('\n');

        } else {
          // ── Basic signal (Starter) ──────────────────────
          const conf = signal.confidence ? ` (${(signal.confidence * 100).toFixed(0)}%)` : '';
          message =
            `${actionEmoji} New Signal: ${signal.symbol} ${signal.timeframe}\n` +
            `Action: ${signal.action}${conf}\n` +
            `Provider: ${signal.providerSlug}`;
        }

        await bot.telegram.sendMessage(tgUser.chatId, message, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '📊 Open', url: `https://agoraiq.net/dashboard/signals/${signal.signalId}` },
              { text: '🔇 Mute', callback_data: `mute:${signal.symbol}` },
            ]],
          },
        });
      } catch (err) {
        log.warn({ err, chatId: tgUser.chatId }, 'Failed to send alert');
      }
    }
  } catch (err) {
    log.error({ err }, 'Broadcast alert failed');
  }
}

// ── Callback Query Handler (inline buttons) ───────────────────

bot.on('callback_query', async (ctx) => {
  const data = (ctx.callbackQuery as any).data;
  if (!data) return;

  if (data.startsWith('mute:')) {
    const symbol = data.slice(5);
    const tgUser = await getTelegramUser(ctx.from!.id.toString());
    if (tgUser) {
      await db.watchlist.updateMany({
        where: { userId: tgUser.userId, type: 'symbol', value: symbol },
        data: { isActive: false },
      });
      await ctx.answerCbQuery(`🔇 Muted ${symbol}`);
    }
  }
});

// ── Launch Bot ────────────────────────────────────────────────

async function main() {
  log.info('🤖 Starting Telegram bot...');
  await bot.launch();
  log.info('✅ Telegram bot running');

  process.once('SIGTERM', () => bot.stop('SIGTERM'));
  process.once('SIGINT', () => bot.stop('SIGINT'));
}

main().catch((err) => {
  log.error({ err }, 'Telegram bot fatal error');
  process.exit(1);
});
