export type Direction = 'LONG' | 'SHORT';
export type MarketType = 'SPOT' | 'FUTURES_PERP' | 'FUTURES_DATED';
export interface CornixParseResult {
    success: boolean;
    confidence: number;
    explanation: string;
    data?: CornixSignal;
    errors: string[];
}
export interface CornixSignal {
    pair: string;
    direction: Direction;
    marketType: MarketType;
    exchange: string | null;
    entryMin: number | null;
    entryMax: number | null;
    stopLoss: number | null;
    takeProfits: number[];
    leverage: number | null;
    leverageType: 'cross' | 'isolated' | null;
    rawMessage: string;
}
export declare function parseCornix(raw: string): CornixParseResult;
//# sourceMappingURL=cornix.d.ts.map