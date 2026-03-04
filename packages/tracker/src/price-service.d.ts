export declare function getCurrentPrice(symbol: string, exchange: string): Promise<{
    price: number;
    high: number;
    low: number;
} | null>;
export interface PriceCheck {
    hitTP: boolean;
    hitSL: boolean;
    currentPrice: number;
    high: number;
    low: number;
}
export declare function checkPriceHit(symbol: string, exchange: string, direction: string, // LONG | SHORT
tpPrice: number | null, slPrice: number | null): Promise<PriceCheck | null>;
//# sourceMappingURL=price-service.d.ts.map