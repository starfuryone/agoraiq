/**
 * Options that may be passed to a Telegram sendMessage call.
 * We only care about `parse_mode` — the rest pass through unchanged.
 */
export interface TelegramSendOptions {
    parse_mode?: string;
    disable_web_page_preview?: boolean;
    [key: string]: unknown;
}
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
export declare function assertCornixTelegramOptions(opts: TelegramSendOptions): void;
/**
 * Returns the safe options object for a Cornix Telegram post.
 * Use this instead of constructing options inline — it can never
 * accidentally include parse_mode.
 */
export declare function cornixTelegramOptions(extras?: Omit<TelegramSendOptions, 'parse_mode'>): TelegramSendOptions;
/**
 * Discord embed object (minimal shape — enough to type the payload builder).
 */
export interface DiscordEmbed {
    title: string;
    color: number;
    fields: {
        name: string;
        value: string;
        inline: boolean;
    }[];
    footer: {
        text: string;
    };
    timestamp: string;
    [key: string]: unknown;
}
/**
 * The payload shape accepted by Discord's channel.send() / REST API.
 */
export interface DiscordMessagePayload {
    content: string;
    embeds?: DiscordEmbed[];
}
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
export declare function assertUntypedCodeFence(content: string): void;
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
export declare function buildDiscordCornixPayload(cornixText: string, embed?: DiscordEmbed): DiscordMessagePayload;
//# sourceMappingURL=publish-guards.d.ts.map