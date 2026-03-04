"use strict";
// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Cache Service
//
// Light in-memory TTL cache. Used by proof endpoints and
// dashboard rollups to avoid hammering DB on hot paths.
// ═══════════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardCache = exports.proofCache = exports.MemoryCache = void 0;
class MemoryCache {
    store = new Map();
    defaultTtlMs;
    constructor(defaultTtlMs = 60_000) {
        this.defaultTtlMs = defaultTtlMs;
    }
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return entry.data;
    }
    set(key, data, ttlMs) {
        this.store.set(key, {
            data,
            expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
        });
    }
    delete(key) {
        this.store.delete(key);
    }
    clear() {
        this.store.clear();
    }
    /** Remove expired entries (call periodically) */
    prune() {
        const now = Date.now();
        let pruned = 0;
        for (const [key, entry] of this.store.entries()) {
            if (now > entry.expiresAt) {
                this.store.delete(key);
                pruned++;
            }
        }
        return pruned;
    }
}
exports.MemoryCache = MemoryCache;
// Shared singleton caches
exports.proofCache = new MemoryCache(60_000); // 60s for public proof
exports.dashboardCache = new MemoryCache(30_000); // 30s for paid dashboard
// Prune expired entries every 5 minutes
setInterval(() => {
    exports.proofCache.prune();
    exports.dashboardCache.prune();
}, 300_000);
//# sourceMappingURL=cache.js.map