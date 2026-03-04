export type MarketStatus = 'ONLINE' | 'POST_ONLY' | 'LIMIT_ONLY' | 'REDUCE_ONLY' | 'CANCEL_ONLY' | 'DELISTED' | 'UNKNOWN';
export type SortDir = 'asc' | 'desc';
export interface SortSpec {
    col: string;
    dir: SortDir;
}
export interface MarketStat {
    bid: number | null;
    ask: number | null;
    last: number | null;
    spreadAbs: number | null;
    spreadBps: number | null;
    volume24h: number | null;
    volume24hUsd: number | null;
    fundingRate: number | null;
    liquidityScore: number | null;
    volatilityScore: number | null;
    statTs: string | null;
}
export interface MarketRow extends MarketStat {
    id: string;
    exchange: string;
    exchangeDisplayName: string;
    exchangeTier: number;
    pairId: string;
    symbol: string;
    baseCanonical: string;
    quoteCanonical: string;
    tvSymbol: string | null;
    status: MarketStatus;
    tickSize: string | null;
    orderMin: string | null;
    orderMinValue: string | null;
    pairDecimals: number | null;
    lotDecimals: number | null;
    marginAvailable: boolean;
    lastSyncedAt: string;
}
export interface CompareRow extends MarketStat {
    exchange: string;
    pairId: string;
    symbol: string;
    tvSymbol: string | null;
    status: MarketStatus;
    marginAvailable: boolean;
    displayName: string;
    tier: number;
    isBestSpread: boolean;
    isBestVolume: boolean;
    isBestLiq: boolean;
}
export interface ChangelogRow {
    id: string;
    changeType: string;
    fieldName: string;
    oldValue: string | null;
    newValue: string | null;
    detectedAt: string;
}
export interface SyncRow {
    id: string;
    status: string;
    totalFetched: number;
    totalUpserted: number;
    totalSkipped: number;
    totalDelisted: number;
    totalChanges: number;
    durationMs: number | null;
    errorMessage: string | null;
    startedAt: string;
    completedAt: string | null;
}
export interface ExchangeMeta {
    exchange: string;
    displayName: string;
    tier: number;
    region: string | null;
    totalPairs: number;
    onlinePairs: number;
    uptimeScore: number | null;
    latencyScore: number | null;
    reliabilityScore: number | null;
    avgSpreadBps: number | null;
}
export interface FilterState {
    exchanges: string[];
    search: string;
    bases: string[];
    quotes: string[];
    status: MarketStatus[];
    marginAvailable: boolean;
    minVolume: number | null;
    maxSpreadBps: number | null;
}
export interface ColumnDef {
    key: string;
    label: string;
    width: number;
    align?: 'left' | 'right' | 'center';
    sortable?: boolean;
    group: 'identity' | 'specs' | 'live' | 'ops';
    visible: boolean;
    mono?: boolean;
}
//# sourceMappingURL=market.d.ts.map