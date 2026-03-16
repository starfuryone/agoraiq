export type Direction = 'LONG' | 'SHORT';
export type FormatType = 'cornix' | 'discord_embed' | 'plain_telegram';
/**
 * The canonical, normalised representation of a trading signal.
 * All formatters and validators operate on this shape.
 */
export interface SignalFields {
    /** Uppercase, no slash — e.g. "BTCUSDT", "ETHUSDT" */
    symbol: string;
    direction: Direction;
    /** Exchange display name — e.g. "Binance Futures", "Bybit" */
    exchange: string;
    /**
     * Entry prices. One element = single price, two elements = range.
     * Range order: [lower, upper] regardless of direction.
     */
    entries: [number] | [number, number];
    stopLoss: number;
    /** At least one TP required. Must be ascending (LONG) or descending (SHORT). */
    targets: [number, ...number[]];
    /** Cornix leverage string — e.g. "Cross 10x" | "Isolated 5x" */
    leverage?: string;
    /** Footer line — e.g. "By @MyChannel" */
    footer?: string;
}
export type ErrorCode = 'MISSING' | 'INVALID_FORMAT' | 'INVALID' | 'TOO_MANY' | 'NOT_SEQUENTIAL' | 'INVALID_DIRECTION' | 'TP_BEYOND_ENTRY' | 'RISK_REWARD_POOR';
export interface ValidationError {
    field: keyof SignalFields | string;
    code: ErrorCode;
    message: string;
}
export interface ValidationWarning {
    field: keyof SignalFields | string;
    message: string;
}
export interface ValidationResult {
    /** True only when there are zero errors. Warnings do NOT affect validity. */
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    /** Convenience: risk/reward ratio if calculable, else null */
    riskReward: number | null;
}
export interface DiscordEmbedField {
    name: string;
    value: string;
    inline: boolean;
}
export interface DiscordEmbed {
    title: string;
    /** Hex color as integer — 0x00c896 (green) or 0xff4757 (red) */
    color: number;
    fields: DiscordEmbedField[];
    footer: {
        text: string;
    };
    timestamp: string;
}
export interface FormattedSignal {
    format: FormatType;
    /** Rendered text (cornix / plain_telegram). Undefined for discord_embed. */
    text?: string;
    /** Discord embed object. Undefined for text formats. */
    embed?: DiscordEmbed;
    /**
     * Always a clean Cornix-compatible plain text string, regardless of format.
     * This is the safe string to put on the clipboard — Cornix, MEX bots,
     * and most Telegram parsers can consume it without modification.
     */
    copyText: string;
}
//# sourceMappingURL=types.d.ts.map