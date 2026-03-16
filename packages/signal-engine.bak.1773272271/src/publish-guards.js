"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// publish-guards.ts
//
// Hard runtime constraints for Cornix-compatible signal publishing.
// These rules are ENFORCEMENT, not documentation — violations throw immediately
// so the bug surfaces at the call site, not silently in the user's Cornix bot.
//
// Two categories:
//   1. Telegram — Cornix must receive plain text. parse_mode must be absent.
//   2. Discord  — Cornix bots read message content, not embeds.
//                 Content must be an untyped triple-backtick code fence.
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertCornixTelegramOptions = assertCornixTelegramOptions;
exports.cornixTelegramOptions = cornixTelegramOptions;
exports.assertUntypedCodeFence = assertUntypedCodeFence;
exports.buildDiscordCornixPayload = buildDiscordCornixPayload;
/**
 * Throws if `parse_mode` is set on a Cornix-targeted Telegram message.
 *
 * Why: Telegram's Markdown/MarkdownV2 parser strips or escapes characters
 * before Cornix sees the message. `TP1 - 96000` silently becomes `TP1 96000`,
 * the target parse fails, and the trade is never set up. No error is thrown;
 * everything looks fine.
 *
 * Call this immediately before every bot.sendMessage() where format === 'cornix'.
 */
function assertCornixTelegramOptions(opts) {
    if (opts.parse_mode !== undefined) {
        throw new Error(`Cornix Telegram posts must be plain text — do not set parse_mode.\n` +
            `Received: parse_mode=${JSON.stringify(opts.parse_mode)}\n` +
            `Reason: Telegram's markdown parser transforms "TP1 - 96000" → "TP1 96000", ` +
            `silently corrupting target prices before Cornix reads them.`);
    }
}
/**
 * Returns the safe options object for a Cornix Telegram post.
 * Use this instead of constructing options inline — it can never
 * accidentally include parse_mode.
 */
function cornixTelegramOptions(extras) {
    const opts = {
        disable_web_page_preview: true,
        ...extras,
    };
    // Belt-and-suspenders: assert even though we control construction
    assertCornixTelegramOptions(opts);
    return opts;
}
// Matches ```<optional-lang-tag>\n...\n```
// We use this to detect and reject typed fences (```json, ```text, etc.)
const TYPED_FENCE_RE = /^```[a-zA-Z]+\n/;
/**
 * Throws if the content string contains a language-tagged code fence.
 *
 * Why: Discord Cornix bots (3Commas, Wunderbit, etc.) scan the raw content
 * field. A typed fence like ```json tells the bot to treat it as JSON, not
 * as a signal. The bot silently ignores the message.
 *
 * Valid:   ```\nTP1 - 96000\n```
 * Invalid: ```json\nTP1 - 96000\n```
 */
function assertUntypedCodeFence(content) {
    if (TYPED_FENCE_RE.test(content)) {
        const tag = content.match(/^```([a-zA-Z]+)\n/)?.[1] ?? 'unknown';
        throw new Error(`Discord Cornix content must use an untyped code fence.\n` +
            `Found language tag: \`\`\`${tag}\n` +
            `Use \`\`\`\\n...\\n\`\`\` (no language tag) so Cornix bots can parse the content.`);
    }
}
/**
 * Builds a Discord message payload that is guaranteed to be parseable
 * by Cornix-compatible bots:
 *
 *   - content = untyped ``` fence wrapping the Cornix plain text
 *   - embeds  = optional rich embed for human readers
 *
 * This is the ONLY function that should be used to construct Discord
 * Cornix payloads. Do not inline the fence construction elsewhere.
 *
 * @param cornixText  Plain Cornix text (no markdown, as from formatCornix())
 * @param embed       Optional Discord embed for human display
 */
function buildDiscordCornixPayload(cornixText, embed) {
    if (!cornixText || cornixText.trim() === '') {
        throw new Error('cornixText must not be empty when building a Discord payload');
    }
    // Enforce: text must not already be wrapped in a code fence (typed or untyped).
    // Catches both ```json\n...``` and ```\n...``` being passed by accident.
    if (cornixText.trimStart().startsWith('```')) {
        const isTyped = TYPED_FENCE_RE.test(cornixText.trimStart());
        throw new Error(isTyped
            ? 'cornixText contains a typed code fence — pass the raw signal text, not a pre-fenced string.'
            : 'cornixText is pre-fenced — pass the raw signal text without ``` wrapping. ' +
                'buildDiscordCornixPayload() adds the ``` fence itself.');
    }
    const content = `\`\`\`\n${cornixText}\n\`\`\``;
    // Verify our own output — paranoid but cheap
    assertUntypedCodeFence(content);
    return embed
        ? { content, embeds: [embed] }
        : { content };
}
//# sourceMappingURL=publish-guards.js.map