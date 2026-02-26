// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Cache Service
//
// Light in-memory TTL cache. Used by proof endpoints and
// dashboard rollups to avoid hammering DB on hot paths.
// ═══════════════════════════════════════════════════════════════

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class MemoryCache {
  private store = new Map<string, CacheEntry<any>>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 60_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** Remove expired entries (call periodically) */
  prune(): number {
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

// Shared singleton caches
export const proofCache = new MemoryCache(60_000);   // 60s for public proof
export const dashboardCache = new MemoryCache(30_000); // 30s for paid dashboard

// Prune expired entries every 5 minutes
setInterval(() => {
  proofCache.prune();
  dashboardCache.prune();
}, 300_000);
