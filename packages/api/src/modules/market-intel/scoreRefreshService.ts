import { proxyFetch } from './proxyFetch';
// ============================================================
// AgoraIQ Market Intel — Score Refresh Service
// /services/scoreRefreshService.ts
//
// Aggregates market data → runs aiScoreEngine for all symbols.
// Called every 60–120 seconds by the scheduler.
// ============================================================

import { scoreSignalCandidate, type SignalCandidate } from './aiScoreEngine.js';
import { getBatchSentiment } from './sentimentProvider.js';
import type { ScoreResult, Side } from './index.js';

// ── Watched symbols ───────────────────────────────────────────
const SCORE_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT',
  'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT',
];

// ── Provider win-rate cache (from AgoraIQ DB) ─────────────────
export interface ProviderWinRateSource {
  getTopProviderWinRate(symbol: string): Promise<number | null>;
}

// ── Market data fetcher (aggregated from Binance) ─────────────
async function fetchMarketData(symbol: string): Promise<{
  momentumPct: number;
  volumeRatio: number;
  volatilityPct: number;
  fundingRatePct: number;
  side: Side;
} | null> {
  try {
    // 24h ticker for momentum + volume
    const tickerRes = await proxyFetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
    if (!tickerRes.ok) return null;
    const ticker = await tickerRes.json() as Record<string, string>;

    const priceChangePct = parseFloat(ticker.priceChangePercent);
    const volume24h      = parseFloat(ticker.volume);
    const high           = parseFloat(ticker.highPrice);
    const low            = parseFloat(ticker.lowPrice);
    const last           = parseFloat(ticker.lastPrice);
    const prevClose      = parseFloat(ticker.prevClosePrice);

    // Volume ratio: compare to 7-day kline avg
    const klinesRes = await proxyFetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=7`);
    let volumeRatio = 1;
    if (klinesRes.ok) {
      const klines = await klinesRes.json() as string[][];
      const volumes = klines.slice(0, -1).map(k => parseFloat(k[5]));
      const avgVol  = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      volumeRatio   = avgVol > 0 ? volume24h / avgVol : 1;
    }

    // Volatility: (high - low) / low * 100
    const volatilityPct = low > 0 ? ((high - low) / low) * 100 : 0;

    // Momentum: price change vs prevClose (capped at ±10%)
    const momentumPct = Math.max(-10, Math.min(10, priceChangePct));

    // Side inference: positive momentum → LONG, else SHORT
    const side: Side = momentumPct >= 0 ? 'LONG' : 'SHORT';

    // Funding rate (perp) — optional, fallback to 0
    let fundingRatePct = 0;
    try {
      const fundingRes = await proxyFetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`);
      if (fundingRes.ok) {
        const fd = await fundingRes.json() as { fundingRate: string }[];
        fundingRatePct = parseFloat(fd[0]?.fundingRate ?? '0') * 100;
      }
    } catch { /* optional — silent fail */ }

    return { momentumPct, volumeRatio, volatilityPct, fundingRatePct, side };
  } catch (err) {
    console.warn(`[scoreRefresh] fetchMarketData failed for ${symbol}:`, err);
    return null;
  }
}

// ── Persistence interface ─────────────────────────────────────
export interface ScoreRefreshDeps {
  saveScore(result: ScoreResult): Promise<void>;
  getProviderWinRate(symbol: string): Promise<number>;
}

// ── Core run logic ────────────────────────────────────────────
export async function runScoreRefresh(
  deps: ScoreRefreshDeps,
  symbols: string[] = SCORE_SYMBOLS,
): Promise<ScoreResult[]> {
  const start = Date.now();
  console.info(`[scoreRefresh] Run started — ${symbols.length} symbols`);

  // Batch-fetch sentiment for all symbols
  const sentimentMap = await getBatchSentiment(symbols);

  const results: ScoreResult[] = [];

  for (const symbol of symbols) {
    try {
      const [marketData, winRate] = await Promise.all([
        fetchMarketData(symbol),
        deps.getProviderWinRate(symbol),
      ]);

      if (!marketData) {
        console.warn(`[scoreRefresh] No market data for ${symbol}, skipping`);
        continue;
      }

      const sentiment = sentimentMap.get(symbol);

      const candidate: SignalCandidate = {
        symbol,
        side: marketData.side,
        rawInputs: {
          winRatePct:     winRate,
          momentumPct:    marketData.momentumPct,
          volumeRatio:    marketData.volumeRatio,
          volatilityPct:  marketData.volatilityPct,
          sentimentRaw:   sentiment?.score ?? 0.5,
          fundingRatePct: marketData.fundingRatePct,
        },
      };

      const score = scoreSignalCandidate(candidate);
      await deps.saveScore(score);
      results.push(score);

    } catch (err) {
      console.error(`[scoreRefresh] Error scoring ${symbol}:`, err);
    }
  }

  // Sort descending by score for logging
  results.sort((a, b) => b.score - a.score);

  console.info(
    `[scoreRefresh] Run complete in ${Date.now() - start}ms — ` +
    `${results.length} scores computed`,
  );
  if (results.length > 0) {
    console.info(
      `[scoreRefresh] Top: ${results[0].symbol} ${results[0].side} ` +
      `score=${results[0].probabilityPct}% conf=${results[0].confidence}`,
    );
  }

  return results;
}

export default { runScoreRefresh };
