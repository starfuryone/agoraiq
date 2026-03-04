interface SignalData {
    signal_id: string;
    provider_name: string;
    pair: string;
    direction: string;
    entry: string;
    stop_loss: string;
    targets: string[];
    trust_score: number;
    status: string;
    pnl_percent?: string;
    duration?: string;
}
export declare function formatSignalCard(s: SignalData): string;
export declare function formatProviderSummary(p: {
    name: string;
    trust_score: number;
    total_signals: number;
    win_rate: number;
    avg_pnl_percent: number;
    avg_duration: string;
}): string;
export declare function formatMonthlyBreakdown(name: string, months: Array<{
    month: string;
    signals: number;
    win_rate: number;
    avg_pnl: number;
}>): string;
export declare function formatAccountInfo(me: {
    tier?: string;
    tier_expires_at?: string;
    telegram_username?: string;
    linked_at?: string;
    referral_code?: string;
    referral_count?: number;
}): string;
export declare const MSG: {
    WELCOME: string;
    WELCOME_BACK: (tier: string) => string;
    LINK_PROMPT: string;
    LINK_CODE: (url: string, exp: string) => string;
    NOT_LINKED: string;
    INVITE_SENT: (name: string, link: string, exp: string) => string;
    SOURCE_LOCKED: (tier: string) => string;
    RATE_LIMITED: string;
    ERROR: string;
    TRIAL_INFO: string;
};
export {};
//# sourceMappingURL=format.d.ts.map