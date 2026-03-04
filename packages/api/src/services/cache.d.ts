export declare class MemoryCache {
    private store;
    private defaultTtlMs;
    constructor(defaultTtlMs?: number);
    get<T>(key: string): T | null;
    set<T>(key: string, data: T, ttlMs?: number): void;
    delete(key: string): void;
    clear(): void;
    /** Remove expired entries (call periodically) */
    prune(): number;
}
export declare const proofCache: MemoryCache;
export declare const dashboardCache: MemoryCache;
//# sourceMappingURL=cache.d.ts.map