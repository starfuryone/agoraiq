import type { SignalFields, FormattedSignal } from './types';
export declare class SignalFormatter {
    formatCornix(signal: SignalFields): FormattedSignal;
    formatDiscordEmbed(signal: SignalFields): FormattedSignal;
    formatPlainTelegram(signal: SignalFields): FormattedSignal;
    private entryStr;
    /** Escape special characters for Telegram MarkdownV2 */
    private escMd;
}
//# sourceMappingURL=formatter.d.ts.map