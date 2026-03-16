// ============================================================
// AgoraIQ Market Intel — Sentiment Provider Adapter
// /services/sentimentProvider.ts
//
// Stable interface for plugging in real sentiment sources.
// TODO markers show where to wire real providers.
// ============================================================

import type { SentimentResult } from './index.js';

// ── Provider interface ────────────────────────────────────────
export interface SentimentProviderAdapter {
  name: string;
  fetchSentiment(symbol: string): Promise<SentimentResult>;
  isAvailable(): Promise<boolean>;
}

// ── Neutral stub (always available, returns 0.5) ─────────────
class StubSentimentProvider implements SentimentProviderAdapter {
  name = 'stub';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async fetchSentiment(symbol: string): Promise<SentimentResult> {
    // TODO: Replace with real sentiment feed.
    // Candidates:
    //   - LunarCrush API  (social sentiment)
    //   - CryptoCompare News Sentiment
    //   - Santiment API
    //   - Internal AgoraIQ channel tone analysis
    return {
      symbol,
      score:     0.5,
      label:     'neutral',
      source:    'stub',
      fetchedAt: new Date(),
    };
  }
}

// ── Fear & Greed Index adapter (placeholder) ─────────────────
class FearGreedAdapter implements SentimentProviderAdapter {
  name = 'fear_greed';
  private baseUrl = 'https://api.alternative.me/fng/';

  async isAvailable(): Promise<boolean> {
    // TODO: ping endpoint and check response
    return false; // disabled until configured
  }

  async fetchSentiment(_symbol: string): Promise<SentimentResult> {
    // TODO: implement fetch from alternative.me/fng
    // This is a global BTC-centric index; use as BTCUSDT proxy.
    // Response: { data: [{ value: "72", value_classification: "Greed" }] }
    throw new Error('FearGreedAdapter not yet implemented');
  }
}

// ── LunarCrush adapter (placeholder) ─────────────────────────
class LunarCrushAdapter implements SentimentProviderAdapter {
  name = 'lunarcrush';

  constructor(private apiKey: string) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async fetchSentiment(symbol: string): Promise<SentimentResult> {
    // TODO: implement LunarCrush v2 coins endpoint
    // GET https://lunarcrush.com/api3/coins/:symbol/time-series/v2
    // Use galaxy_score or alt_rank as proxy for sentiment (0..100 → 0..1)
    throw new Error('LunarCrushAdapter not yet implemented — set LUNARCRUSH_API_KEY');
  }
}

// ── Provider registry & routing ───────────────────────────────
const PROVIDERS: SentimentProviderAdapter[] = [
  new LunarCrushAdapter(process.env.LUNARCRUSH_API_KEY ?? ''),
  new FearGreedAdapter(),
  new StubSentimentProvider(),   // always last — final fallback
];

/**
 * Fetch sentiment for a symbol from the first available provider.
 * Falls back down the chain automatically.
 */
export async function getSentiment(symbol: string): Promise<SentimentResult> {
  for (const provider of PROVIDERS) {
    try {
      if (await provider.isAvailable()) {
        const result = await provider.fetchSentiment(symbol);
        return result;
      }
    } catch (err) {
      console.warn(`[sentimentProvider] ${provider.name} failed for ${symbol}:`, err);
    }
  }

  // Should never reach here (stub always succeeds), but defensive:
  return {
    symbol,
    score:     0.5,
    label:     'neutral',
    source:    'fallback',
    fetchedAt: new Date(),
  };
}

/**
 * Batch-fetch sentiment for multiple symbols.
 */
export async function getBatchSentiment(
  symbols: string[],
): Promise<Map<string, SentimentResult>> {
  const results = await Promise.allSettled(
    symbols.map(s => getSentiment(s)),
  );

  const map = new Map<string, SentimentResult>();
  symbols.forEach((sym, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') {
      map.set(sym, r.value);
    } else {
      map.set(sym, {
        symbol:    sym,
        score:     0.5,
        label:     'neutral',
        source:    'error-fallback',
        fetchedAt: new Date(),
      });
    }
  });

  return map;
}

export default { getSentiment, getBatchSentiment };
