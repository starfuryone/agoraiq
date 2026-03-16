"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// formatter.ts — SignalFormatter
//
// Converts a validated SignalFields object into three publishable formats:
//   1. cornix          → plain text, Cornix/MEX bot-compatible
//   2. discord_embed   → Discord embed object + code-block fallback
//   3. plain_telegram  → Telegram MarkdownV2 (for human-readable posts)
//
// IMPORTANT: copyText is ALWAYS the Cornix plain-text format.
//   - No markdown
//   - No parse_mode
//   - This is what Cornix, WunderBit, and most signal bots parse
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalFormatter = void 0;
// Discord colors
const COLOR_LONG = 0x00c896; // AgoraIQ green
const COLOR_SHORT = 0xff4757; // AgoraIQ red
class SignalFormatter {
    // ─────────────────────────────────────────────────────────────────────────
    // 1. Cornix format
    //    Cornix's parser is line-sensitive. Rules:
    //    - No markdown, no bold, no parse_mode
    //    - Targets as "TP1 - <price>" on separate lines
    //    - Blank lines between sections
    //    - Leverage (optional): "Cross 10x" or "Isolated 5x"
    // ─────────────────────────────────────────────────────────────────────────
    formatCornix(signal) {
        const lines = [];
        lines.push(`📊 #${signal.symbol} ${signal.direction}`);
        lines.push('');
        lines.push(`🏦 Exchange: ${signal.exchange}`);
        lines.push('');
        lines.push(`${signal.direction === 'LONG' ? '📈' : '📉'} Entry: ${this.entryStr(signal)}`);
        lines.push('');
        lines.push('🎯 Targets:');
        signal.targets.forEach((tp, i) => {
            lines.push(`TP${i + 1} - ${tp}`);
        });
        lines.push('');
        lines.push(`🛡 Stop Loss: ${signal.stopLoss}`);
        if (signal.leverage) {
            lines.push('');
            lines.push(`⚡️ Leverage: ${signal.leverage}`);
        }
        if (signal.footer) {
            lines.push('');
            lines.push(signal.footer);
        }
        const text = lines.join('\n');
        return {
            format: 'cornix',
            text,
            copyText: text,
        };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // 2. Discord embed
    //    Rich embed with colored sidebar, inline fields.
    //    copyText is still Cornix plain text — Discord Cornix bots read the
    //    code block in the message content, not the embed.
    // ─────────────────────────────────────────────────────────────────────────
    formatDiscordEmbed(signal) {
        const isLong = signal.direction === 'LONG';
        const dirEmoji = isLong ? '🟢' : '🔴';
        const targetsValue = signal.targets
            .map((tp, i) => `**TP${i + 1}** → ${tp}`)
            .join('\n');
        const fields = [
            { name: '🏦 Exchange', value: signal.exchange, inline: true },
        ];
        if (signal.leverage) {
            fields.push({ name: '⚡️ Leverage', value: signal.leverage, inline: true });
        }
        fields.push({
            name: `${isLong ? '📈' : '📉'} Entry`,
            value: this.entryStr(signal),
            inline: false,
        }, {
            name: '🎯 Targets',
            value: targetsValue,
            inline: true,
        }, {
            name: '🛡 Stop Loss',
            value: `${signal.stopLoss}`,
            inline: true,
        });
        const embed = {
            title: `${dirEmoji} ${signal.symbol} ${signal.direction}`,
            color: isLong ? COLOR_LONG : COLOR_SHORT,
            fields,
            footer: { text: signal.footer ?? 'AgoraIQ Signal Intelligence' },
            timestamp: new Date().toISOString(),
        };
        return {
            format: 'discord_embed',
            embed,
            copyText: this.formatCornix(signal).copyText,
        };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // 3. Plain Telegram (MarkdownV2)
    //    Human-readable post for Telegram channels.
    //    NOT for Cornix — parse_mode breaks Cornix's line parser.
    //    copyText is still Cornix plain text for safe pasting.
    //
    //    MarkdownV2 requires escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
    // ─────────────────────────────────────────────────────────────────────────
    formatPlainTelegram(signal) {
        const isLong = signal.direction === 'LONG';
        const dirEmoji = isLong ? '🟢' : '🔴';
        const targetsStr = signal.targets
            .map((tp, i) => `TP${i + 1} \\- \`${tp}\``)
            .join('\n');
        const lines = [
            `📊 *\\#${this.escMd(signal.symbol)} ${signal.direction}*`,
            '',
            `🏦 Exchange: ${this.escMd(signal.exchange)}`,
            '',
            `${dirEmoji} Entry: \`${this.entryStr(signal)}\``,
            '',
            '*🎯 Targets:*',
            targetsStr,
            '',
            `🛡 Stop Loss: \`${signal.stopLoss}\``,
        ];
        if (signal.leverage) {
            lines.push('');
            lines.push(`⚡️ Leverage: ${this.escMd(signal.leverage)}`);
        }
        if (signal.footer) {
            lines.push('');
            lines.push(this.escMd(signal.footer));
        }
        const text = lines.join('\n');
        return {
            format: 'plain_telegram',
            text,
            copyText: this.formatCornix(signal).copyText, // always Cornix for copy
        };
    }
    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────
    entryStr(signal) {
        return signal.entries.length === 2
            ? `${signal.entries[0]} - ${signal.entries[1]}`
            : `${signal.entries[0]}`;
    }
    /** Escape special characters for Telegram MarkdownV2 */
    escMd(text) {
        return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, (c) => `\\${c}`);
    }
}
exports.SignalFormatter = SignalFormatter;
//# sourceMappingURL=formatter.js.map