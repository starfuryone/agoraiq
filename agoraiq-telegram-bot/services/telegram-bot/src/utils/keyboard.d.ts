import { Markup } from "telegraf";
export declare const unlinkedMenu: () => Markup.Markup<import("@telegraf/types").InlineKeyboardMarkup>;
export declare const mainMenu: () => Markup.Markup<import("@telegraf/types").InlineKeyboardMarkup>;
export declare const categoryMenu: () => Markup.Markup<import("@telegraf/types").InlineKeyboardMarkup>;
export declare const signalsMenu: () => Markup.Markup<import("@telegraf/types").InlineKeyboardMarkup>;
export declare const accountMenu: () => Markup.Markup<import("@telegraf/types").InlineKeyboardMarkup>;
export declare const supportMenu: () => Markup.Markup<import("@telegraf/types").InlineKeyboardMarkup>;
export declare const signalCardButtons: (signal: {
    proof_url: string;
    provider_id: string;
    signal_id: string;
}) => Markup.Markup<import("@telegraf/types").InlineKeyboardMarkup>;
export declare const sourceListButtons: (sources: Array<{
    id: string;
    name: string;
    locked: boolean;
    tier_min: string;
}>, category: string, page: number, total: number, perPage: number) => Markup.Markup<import("@telegraf/types").InlineKeyboardMarkup>;
export declare const backToMain: () => Markup.Markup<import("@telegraf/types").InlineKeyboardMarkup>;
//# sourceMappingURL=keyboard.d.ts.map