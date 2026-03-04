export declare function broadcastSignalAlert(signal: {
    symbol: string;
    timeframe: string;
    action: string;
    providerSlug: string;
    confidence?: number | null;
    signalId: string;
    tradeId?: string | null;
    price?: number | null;
    tradeScore?: number | null;
    bandNo?: number | null;
    bandSign?: string | null;
    bandText?: string | null;
    ohlc?: {
        open: number;
        high: number;
        low: number;
        close?: number | null;
    } | null;
    source?: string | null;
    description?: string | null;
}): Promise<void>;
//# sourceMappingURL=index.d.ts.map