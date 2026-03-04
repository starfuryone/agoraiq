export declare const SAFE_MODE_CONFIG: {
    activeDelayMinutes: number;
    maxFeedItems: number;
    maxMonths: number;
    maxStatsDays: number;
    maxRevealedProviders: number;
    cacheTtlMs: number;
};
interface RawFeedItem {
    id: string;
    symbol: string;
    timeframe: string;
    direction: string;
    status: string;
    entryPrice?: number | null;
    exitPrice?: number | null;
    tpPrice?: number | null;
    slPrice?: number | null;
    rMultiple?: number | null;
    pnlPct?: number | null;
    providerId: string;
    providerSlug?: string;
    providerName?: string;
    createdAt: Date | string;
    exitedAt?: Date | string | null;
    notes?: string | null;
    [key: string]: any;
}
interface SafeFeedItem {
    id: string;
    symbol: string;
    timeframe: string;
    direction: string;
    status: string;
    rMultiple: number | null;
    pnlPct: number | null;
    provider: string;
    strength: {
        label: string;
        indicator: string;
    } | null;
    source: string | null;
    createdAt: string;
    exitedAt: string | null;
}
interface ProviderRanking {
    providerId: string;
    slug: string;
    name: string;
    rank: number;
    [key: string]: any;
}
interface SafeProviderRanking {
    rank: number;
    name: string;
    [key: string]: any;
}
export declare function redactObject<T extends Record<string, any>>(obj: T): Partial<T>;
export declare function filterByDelay<T extends {
    status: string;
    createdAt: Date | string;
}>(items: T[]): T[];
/**
 * Given a ranked list of providers, returns a map from providerId to display name.
 * Top N providers keep their real name; rest are masked.
 */
export declare function buildProviderMask(rankings: ProviderRanking[]): Map<string, string>;
export declare function safeModeFeed(items: RawFeedItem[], providerMask: Map<string, string>): SafeFeedItem[];
export declare function safeModeProviders(rankings: ProviderRanking[]): SafeProviderRanking[];
export declare function assertSafe(data: any): void;
export declare function isSafeMode(query: Record<string, any>): boolean;
export {};
//# sourceMappingURL=safe-mode.d.ts.map