"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// formatter.test.ts
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const formatter_1 = require("../src/formatter");
// ── Fixtures ──────────────────────────────────────────────────────────────────
const fullLong = {
    symbol: 'BTCUSDT',
    direction: 'LONG',
    exchange: 'Binance Futures',
    entries: [94500],
    stopLoss: 93000,
    targets: [96000, 97500, 99000],
    leverage: 'Cross 10x',
    footer: 'By @AgoraIQ',
};
const fullShort = {
    symbol: 'ETHUSDT',
    direction: 'SHORT',
    exchange: 'Bybit',
    entries: [3200],
    stopLoss: 3350,
    targets: [3100, 3000, 2900],
    leverage: 'Isolated 5x',
    footer: 'By @TestChannel',
};
const rangeEntry = {
    ...fullLong,
    entries: [94000, 95000],
};
const minimal = {
    symbol: 'SOLUSDT',
    direction: 'LONG',
    exchange: 'OKX',
    entries: [150],
    stopLoss: 145,
    targets: [160],
};
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('SignalFormatter', () => {
    let f;
    (0, vitest_1.beforeEach)(() => {
        f = new formatter_1.SignalFormatter();
    });
    // ── formatCornix ────────────────────────────────────────────────────────────
    (0, vitest_1.describe)('formatCornix', () => {
        (0, vitest_1.it)('returns format: cornix', () => {
            (0, vitest_1.expect)(f.formatCornix(fullLong).format).toBe('cornix');
        });
        (0, vitest_1.it)('includes symbol with hash prefix', () => {
            const { text } = f.formatCornix(fullLong);
            (0, vitest_1.expect)(text).toContain('#BTCUSDT LONG');
        });
        (0, vitest_1.it)('includes exchange', () => {
            const { text } = f.formatCornix(fullLong);
            (0, vitest_1.expect)(text).toContain('Exchange: Binance Futures');
        });
        (0, vitest_1.it)('formats single entry correctly', () => {
            const { text } = f.formatCornix(fullLong);
            (0, vitest_1.expect)(text).toContain('Entry: 94500');
            (0, vitest_1.expect)(text).not.toContain('94500 - 94500');
        });
        (0, vitest_1.it)('formats range entry correctly', () => {
            const { text } = f.formatCornix(rangeEntry);
            (0, vitest_1.expect)(text).toContain('Entry: 94000 - 95000');
        });
        (0, vitest_1.it)('formats targets as TP1, TP2, TP3', () => {
            const { text } = f.formatCornix(fullLong);
            (0, vitest_1.expect)(text).toContain('TP1 - 96000');
            (0, vitest_1.expect)(text).toContain('TP2 - 97500');
            (0, vitest_1.expect)(text).toContain('TP3 - 99000');
        });
        (0, vitest_1.it)('includes stop loss', () => {
            const { text } = f.formatCornix(fullLong);
            (0, vitest_1.expect)(text).toContain('Stop Loss: 93000');
        });
        (0, vitest_1.it)('includes leverage when provided', () => {
            const { text } = f.formatCornix(fullLong);
            (0, vitest_1.expect)(text).toContain('Leverage: Cross 10x');
        });
        (0, vitest_1.it)('omits leverage section when not provided', () => {
            const { text } = f.formatCornix(minimal);
            (0, vitest_1.expect)(text).not.toContain('Leverage');
        });
        (0, vitest_1.it)('includes footer when provided', () => {
            const { text } = f.formatCornix(fullLong);
            (0, vitest_1.expect)(text).toContain('By @AgoraIQ');
        });
        (0, vitest_1.it)('omits footer when not provided', () => {
            const { text } = f.formatCornix(minimal);
            (0, vitest_1.expect)(text).not.toContain('By @');
        });
        (0, vitest_1.it)('copyText equals text for cornix format', () => {
            const result = f.formatCornix(fullLong);
            (0, vitest_1.expect)(result.copyText).toBe(result.text);
        });
        (0, vitest_1.it)('contains no markdown characters (asterisk, underscore, backtick)', () => {
            const { text } = f.formatCornix(fullLong);
            (0, vitest_1.expect)(text).not.toMatch(/[*_`]/);
        });
        (0, vitest_1.it)('uses SHORT direction in title', () => {
            const { text } = f.formatCornix(fullShort);
            (0, vitest_1.expect)(text).toContain('#ETHUSDT SHORT');
        });
        (0, vitest_1.it)('uses 📉 emoji for SHORT entry', () => {
            const { text } = f.formatCornix(fullShort);
            (0, vitest_1.expect)(text).toContain('📉 Entry');
        });
        (0, vitest_1.it)('uses 📈 emoji for LONG entry', () => {
            const { text } = f.formatCornix(fullLong);
            (0, vitest_1.expect)(text).toContain('📈 Entry');
        });
        (0, vitest_1.it)('formats a single TP correctly', () => {
            const { text } = f.formatCornix(minimal);
            (0, vitest_1.expect)(text).toContain('TP1 - 160');
            (0, vitest_1.expect)(text).not.toContain('TP2');
        });
        // Critical: Cornix line-parser test
        (0, vitest_1.it)('has entry line before targets section', () => {
            const { text } = f.formatCornix(fullLong);
            const entryIdx = text.indexOf('Entry:');
            const targetsIdx = text.indexOf('Targets:');
            (0, vitest_1.expect)(entryIdx).toBeLessThan(targetsIdx);
        });
        (0, vitest_1.it)('has targets section before stop loss', () => {
            const { text } = f.formatCornix(fullLong);
            const targetsIdx = text.indexOf('Targets:');
            const slIdx = text.indexOf('Stop Loss:');
            (0, vitest_1.expect)(targetsIdx).toBeLessThan(slIdx);
        });
    });
    // ── formatDiscordEmbed ──────────────────────────────────────────────────────
    (0, vitest_1.describe)('formatDiscordEmbed', () => {
        (0, vitest_1.it)('returns format: discord_embed', () => {
            (0, vitest_1.expect)(f.formatDiscordEmbed(fullLong).format).toBe('discord_embed');
        });
        (0, vitest_1.it)('has no text property', () => {
            const result = f.formatDiscordEmbed(fullLong);
            (0, vitest_1.expect)(result.text).toBeUndefined();
        });
        (0, vitest_1.it)('has embed property', () => {
            const result = f.formatDiscordEmbed(fullLong);
            (0, vitest_1.expect)(result.embed).toBeDefined();
        });
        (0, vitest_1.it)('embed title contains symbol and direction for LONG', () => {
            const { embed } = f.formatDiscordEmbed(fullLong);
            (0, vitest_1.expect)(embed.title).toContain('BTCUSDT');
            (0, vitest_1.expect)(embed.title).toContain('LONG');
            (0, vitest_1.expect)(embed.title).toContain('🟢');
        });
        (0, vitest_1.it)('embed title uses red emoji for SHORT', () => {
            const { embed } = f.formatDiscordEmbed(fullShort);
            (0, vitest_1.expect)(embed.title).toContain('🔴');
        });
        (0, vitest_1.it)('uses green color for LONG (0x00c896)', () => {
            const { embed } = f.formatDiscordEmbed(fullLong);
            (0, vitest_1.expect)(embed.color).toBe(0x00c896);
        });
        (0, vitest_1.it)('uses red color for SHORT (0xff4757)', () => {
            const { embed } = f.formatDiscordEmbed(fullShort);
            (0, vitest_1.expect)(embed.color).toBe(0xff4757);
        });
        (0, vitest_1.it)('includes exchange field', () => {
            const { embed } = f.formatDiscordEmbed(fullLong);
            (0, vitest_1.expect)(embed.fields.some((f) => f.value === 'Binance Futures')).toBe(true);
        });
        (0, vitest_1.it)('includes leverage field when provided', () => {
            const { embed } = f.formatDiscordEmbed(fullLong);
            (0, vitest_1.expect)(embed.fields.some((f) => f.value === 'Cross 10x')).toBe(true);
        });
        (0, vitest_1.it)('omits leverage field when not provided', () => {
            const { embed } = f.formatDiscordEmbed(minimal);
            const leverageField = embed.fields.find((f) => f.name.includes('Leverage'));
            (0, vitest_1.expect)(leverageField).toBeUndefined();
        });
        (0, vitest_1.it)('includes all targets in targets field', () => {
            const { embed } = f.formatDiscordEmbed(fullLong);
            const targetsField = embed.fields.find((f) => f.name.includes('Targets'));
            (0, vitest_1.expect)(targetsField?.value).toContain('96000');
            (0, vitest_1.expect)(targetsField?.value).toContain('97500');
            (0, vitest_1.expect)(targetsField?.value).toContain('99000');
        });
        (0, vitest_1.it)('includes stop loss field', () => {
            const { embed } = f.formatDiscordEmbed(fullLong);
            const slField = embed.fields.find((f) => f.name.includes('Stop Loss'));
            (0, vitest_1.expect)(slField?.value).toBe('93000');
        });
        (0, vitest_1.it)('uses footer text from signal', () => {
            const { embed } = f.formatDiscordEmbed(fullLong);
            (0, vitest_1.expect)(embed.footer.text).toBe('By @AgoraIQ');
        });
        (0, vitest_1.it)('uses default footer when not provided', () => {
            const { embed } = f.formatDiscordEmbed(minimal);
            (0, vitest_1.expect)(embed.footer.text).toBe('AgoraIQ Signal Intelligence');
        });
        (0, vitest_1.it)('has a valid ISO timestamp', () => {
            const { embed } = f.formatDiscordEmbed(fullLong);
            (0, vitest_1.expect)(() => new Date(embed.timestamp)).not.toThrow();
            (0, vitest_1.expect)(new Date(embed.timestamp).getTime()).toBeGreaterThan(0);
        });
        (0, vitest_1.it)('copyText is Cornix-compatible plain text (no markdown)', () => {
            const { copyText } = f.formatDiscordEmbed(fullLong);
            (0, vitest_1.expect)(copyText).not.toMatch(/[*_`]/);
            (0, vitest_1.expect)(copyText).toContain('#BTCUSDT LONG');
            (0, vitest_1.expect)(copyText).toContain('TP1 - 96000');
        });
    });
    // ── formatPlainTelegram ─────────────────────────────────────────────────────
    (0, vitest_1.describe)('formatPlainTelegram', () => {
        (0, vitest_1.it)('returns format: plain_telegram', () => {
            (0, vitest_1.expect)(f.formatPlainTelegram(fullLong).format).toBe('plain_telegram');
        });
        (0, vitest_1.it)('contains symbol in bold markdown', () => {
            const { text } = f.formatPlainTelegram(fullLong);
            (0, vitest_1.expect)(text).toContain('*'); // MarkdownV2 bold
            (0, vitest_1.expect)(text).toContain('BTCUSDT');
        });
        (0, vitest_1.it)('formats single entry in backtick code', () => {
            const { text } = f.formatPlainTelegram(fullLong);
            (0, vitest_1.expect)(text).toContain('`94500`');
        });
        (0, vitest_1.it)('formats range entry in backtick code', () => {
            const { text } = f.formatPlainTelegram(rangeEntry);
            (0, vitest_1.expect)(text).toContain('`94000 - 95000`');
        });
        (0, vitest_1.it)('formats targets with escaped dash (MarkdownV2)', () => {
            const { text } = f.formatPlainTelegram(fullLong);
            // MarkdownV2 requires - to be escaped as \-
            (0, vitest_1.expect)(text).toContain('TP1 \\-');
        });
        (0, vitest_1.it)('includes stop loss in backtick', () => {
            const { text } = f.formatPlainTelegram(fullLong);
            (0, vitest_1.expect)(text).toContain('`93000`');
        });
        (0, vitest_1.it)('copyText is Cornix plain text, not Telegram markdown', () => {
            const { copyText } = f.formatPlainTelegram(fullLong);
            // copyText should be plain Cornix, not markdown
            (0, vitest_1.expect)(copyText).not.toMatch(/\\\-/); // no escaped dashes
            (0, vitest_1.expect)(copyText).toContain('TP1 - 96000');
        });
        (0, vitest_1.it)('copyText matches formatCornix output', () => {
            const telegramResult = f.formatPlainTelegram(fullLong);
            const cornixResult = f.formatCornix(fullLong);
            (0, vitest_1.expect)(telegramResult.copyText).toBe(cornixResult.text);
        });
    });
    // ── Cross-format consistency ────────────────────────────────────────────────
    (0, vitest_1.describe)('cross-format consistency', () => {
        (0, vitest_1.it)('all formats produce copyText identical to Cornix text', () => {
            const cornix = f.formatCornix(fullLong);
            const discord = f.formatDiscordEmbed(fullLong);
            const telegram = f.formatPlainTelegram(fullLong);
            (0, vitest_1.expect)(discord.copyText).toBe(cornix.text);
            (0, vitest_1.expect)(telegram.copyText).toBe(cornix.text);
        });
        (0, vitest_1.it)('all formats include all 3 TPs in their respective outputs', () => {
            const tps = [96000, 97500, 99000];
            const cornixText = f.formatCornix(fullLong).text;
            tps.forEach((tp) => (0, vitest_1.expect)(cornixText).toContain(String(tp)));
            const discordEmbed = f.formatDiscordEmbed(fullLong).embed;
            const targetsField = discordEmbed.fields.find((f) => f.name.includes('Targets'));
            tps.forEach((tp) => (0, vitest_1.expect)(targetsField.value).toContain(String(tp)));
            const telegramText = f.formatPlainTelegram(fullLong).text;
            tps.forEach((tp) => (0, vitest_1.expect)(telegramText).toContain(String(tp)));
        });
    });
});
//# sourceMappingURL=formatter.test.js.map