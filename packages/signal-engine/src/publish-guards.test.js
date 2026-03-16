"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// publish-guards.test.ts
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const publish_guards_1 = require("./publish-guards");
// ── Fixtures ──────────────────────────────────────────────────────────────────
const CORNIX_TEXT = [
    '📊 #BTCUSDT LONG',
    '',
    '🏦 Exchange: Binance Futures',
    '',
    '📈 Entry: 94500',
    '',
    '🎯 Targets:',
    'TP1 - 96000',
    'TP2 - 97500',
    '',
    '🛡 Stop Loss: 93000',
].join('\n');
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('assertCornixTelegramOptions', () => {
    (0, vitest_1.it)('passes when parse_mode is undefined', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertCornixTelegramOptions)({ disable_web_page_preview: true })).not.toThrow();
    });
    (0, vitest_1.it)('passes when options object is empty', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertCornixTelegramOptions)({})).not.toThrow();
    });
    (0, vitest_1.it)('throws when parse_mode is "Markdown"', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertCornixTelegramOptions)({ parse_mode: 'Markdown' })).toThrow(/plain text/);
    });
    (0, vitest_1.it)('throws when parse_mode is "MarkdownV2"', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertCornixTelegramOptions)({ parse_mode: 'MarkdownV2' })).toThrow(/plain text/);
    });
    (0, vitest_1.it)('throws when parse_mode is "HTML"', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertCornixTelegramOptions)({ parse_mode: 'HTML' })).toThrow(/plain text/);
    });
    (0, vitest_1.it)('error message names the bad parse_mode value', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertCornixTelegramOptions)({ parse_mode: 'MarkdownV2' })).toThrow(/MarkdownV2/);
    });
    (0, vitest_1.it)('error message explains the Cornix corruption reason', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertCornixTelegramOptions)({ parse_mode: 'Markdown' })).toThrow(/TP1/);
    });
    // Regression guard: future developer adds parse_mode to an options spread
    (0, vitest_1.it)('throws even when parse_mode is set alongside other safe options', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertCornixTelegramOptions)({
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
        })).toThrow();
    });
});
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('cornixTelegramOptions', () => {
    (0, vitest_1.it)('returns options without parse_mode', () => {
        const opts = (0, publish_guards_1.cornixTelegramOptions)();
        (0, vitest_1.expect)(opts.parse_mode).toBeUndefined();
    });
    (0, vitest_1.it)('sets disable_web_page_preview: true by default', () => {
        const opts = (0, publish_guards_1.cornixTelegramOptions)();
        (0, vitest_1.expect)(opts.disable_web_page_preview).toBe(true);
    });
    (0, vitest_1.it)('merges extra options', () => {
        const opts = (0, publish_guards_1.cornixTelegramOptions)({ reply_to_message_id: 42 });
        (0, vitest_1.expect)(opts.reply_to_message_id).toBe(42);
    });
    (0, vitest_1.it)('never has parse_mode even with arbitrary spread', () => {
        const opts = (0, publish_guards_1.cornixTelegramOptions)({ some_future_option: true });
        (0, vitest_1.expect)(opts.parse_mode).toBeUndefined();
    });
    // Critical: cannot be tricked into accepting parse_mode via extras
    (0, vitest_1.it)('throws if caller somehow injects parse_mode via extras', () => {
        (0, vitest_1.expect)(() => 
        // Type cast simulates a caller bypassing TypeScript
        (0, publish_guards_1.cornixTelegramOptions)({ parse_mode: 'Markdown' })).toThrow(/plain text/);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('assertUntypedCodeFence', () => {
    (0, vitest_1.it)('passes on a valid untyped fence', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertUntypedCodeFence)('```\nTP1 - 96000\n```')).not.toThrow();
    });
    (0, vitest_1.it)('passes on multi-line untyped fence', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertUntypedCodeFence)(`\`\`\`\n${CORNIX_TEXT}\n\`\`\``)).not.toThrow();
    });
    (0, vitest_1.it)('passes on plain text (no fence at all)', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertUntypedCodeFence)('Some plain text without a fence')).not.toThrow();
    });
    (0, vitest_1.it)('throws on ```json fence', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertUntypedCodeFence)('```json\n{"key": "value"}\n```')).toThrow(/untyped/);
    });
    (0, vitest_1.it)('throws on ```text fence', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertUntypedCodeFence)('```text\nTP1 - 96000\n```')).toThrow();
    });
    (0, vitest_1.it)('throws on ```ts fence', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertUntypedCodeFence)('```ts\nconst x = 1\n```')).toThrow();
    });
    (0, vitest_1.it)('throws on ```javascript fence', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertUntypedCodeFence)('```javascript\ncode here\n```')).toThrow();
    });
    (0, vitest_1.it)('error message includes the offending language tag', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertUntypedCodeFence)('```json\n...\n```')).toThrow(/json/);
    });
    // Regression: ensure we only flag the opening fence, not language words in content
    (0, vitest_1.it)('does not throw when content contains "json" mid-text', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertUntypedCodeFence)('```\nThis message mentions json but fence is untyped\n```')).not.toThrow();
    });
});
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('buildDiscordCornixPayload', () => {
    (0, vitest_1.it)('returns content with an untyped code fence', () => {
        const { content } = (0, publish_guards_1.buildDiscordCornixPayload)(CORNIX_TEXT);
        (0, vitest_1.expect)(content).toMatch(/^```\n/);
        (0, vitest_1.expect)(content).toMatch(/\n```$/);
    });
    (0, vitest_1.it)('wraps the full Cornix text inside the fence', () => {
        const { content } = (0, publish_guards_1.buildDiscordCornixPayload)(CORNIX_TEXT);
        (0, vitest_1.expect)(content).toContain(CORNIX_TEXT);
    });
    (0, vitest_1.it)('fence is untyped — no language tag', () => {
        const { content } = (0, publish_guards_1.buildDiscordCornixPayload)(CORNIX_TEXT);
        // Must not have ```<letters> at the start
        (0, vitest_1.expect)(content).not.toMatch(/^```[a-zA-Z]/);
    });
    (0, vitest_1.it)('does not include embeds when none provided', () => {
        const payload = (0, publish_guards_1.buildDiscordCornixPayload)(CORNIX_TEXT);
        (0, vitest_1.expect)(payload.embeds).toBeUndefined();
    });
    (0, vitest_1.it)('includes embed when provided', () => {
        const embed = {
            title: '🟢 BTCUSDT LONG',
            color: 0x00c896,
            fields: [],
            footer: { text: 'AgoraIQ' },
            timestamp: new Date().toISOString(),
        };
        const payload = (0, publish_guards_1.buildDiscordCornixPayload)(CORNIX_TEXT, embed);
        (0, vitest_1.expect)(payload.embeds).toHaveLength(1);
        (0, vitest_1.expect)(payload.embeds[0].title).toBe('🟢 BTCUSDT LONG');
    });
    (0, vitest_1.it)('content is always present even with embed', () => {
        const embed = {
            title: 'test',
            color: 0x00c896,
            fields: [],
            footer: { text: '' },
            timestamp: new Date().toISOString(),
        };
        const payload = (0, publish_guards_1.buildDiscordCornixPayload)(CORNIX_TEXT, embed);
        (0, vitest_1.expect)(payload.content).toBeTruthy();
        (0, vitest_1.expect)(payload.content).toContain(CORNIX_TEXT);
    });
    (0, vitest_1.it)('throws on empty cornixText', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.buildDiscordCornixPayload)('')).toThrow(/empty/);
    });
    (0, vitest_1.it)('throws on whitespace-only cornixText', () => {
        (0, vitest_1.expect)(() => (0, publish_guards_1.buildDiscordCornixPayload)('   ')).toThrow(/empty/);
    });
    (0, vitest_1.it)('throws if caller passes pre-fenced text', () => {
        const preFenced = '```\nTP1 - 96000\n```';
        (0, vitest_1.expect)(() => (0, publish_guards_1.buildDiscordCornixPayload)(preFenced)).toThrow(/pre-fenced/);
    });
    // THE regression test: catches the ```json introduction
    (0, vitest_1.it)('throws if caller passes text with a typed fence', () => {
        const typedFenced = '```json\n{"price": 96000}\n```';
        (0, vitest_1.expect)(() => (0, publish_guards_1.buildDiscordCornixPayload)(typedFenced)).toThrow();
    });
    // Structural invariant: content always passes its own fence assertion
    (0, vitest_1.it)('content always passes assertUntypedCodeFence', () => {
        const payload = (0, publish_guards_1.buildDiscordCornixPayload)(CORNIX_TEXT);
        (0, vitest_1.expect)(() => (0, publish_guards_1.assertUntypedCodeFence)(payload.content)).not.toThrow();
    });
    // Critical Cornix parsing requirement: TP line survives round-trip
    (0, vitest_1.it)('TP targets are preserved verbatim inside the fence', () => {
        const { content } = (0, publish_guards_1.buildDiscordCornixPayload)(CORNIX_TEXT);
        (0, vitest_1.expect)(content).toContain('TP1 - 96000');
        (0, vitest_1.expect)(content).toContain('TP2 - 97500');
    });
    (0, vitest_1.it)('Stop Loss line is preserved verbatim inside the fence', () => {
        const { content } = (0, publish_guards_1.buildDiscordCornixPayload)(CORNIX_TEXT);
        (0, vitest_1.expect)(content).toContain('Stop Loss: 93000');
    });
});
//# sourceMappingURL=publish-guards.test.js.map