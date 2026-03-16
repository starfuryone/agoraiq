import { proxyFetch } from './proxyFetch';
// ============================================================
// AgoraIQ Market Intel — Volatility Engine
// /services/volatilityEngine.ts
//
// Detects volatility + volume spikes across exchanges.
// Cron: every 60 seconds.
// ============================================================


import type {
  VolatilitySnapshot,
  VolatilityAlert,
  AlertSeverity,
} from './index.js';

// ── Config (from env vars) ────────────────────────────────────
const VOL_MULTIPLIER    = parseFloat(process.env.MARKET_INTEL_VOLATILITY_MULTIPLIER ?? '2');
const VOLUME_MULTIPLIER = parseFloat(process.env.MARKET_INTEL_VOLUME_MULTIPLIER    ?? '1.5');

// Tracked symbols (extend as needed)
const WATCHED_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT',
  'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT',
];

// ── Exchange adapter interfaces ───────────────────────────────
interface ExchangeTickerData {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number; // 24h
  volume24h: number;          // in base asset
  highPrice: number;
  lowPrice: number;
}

// ── Binance adapter ───────────────────────────────────────────
async function fetchBinanceTicker(symbol: string): Promise<ExchangeTickerData | null> {
  try {
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
    const res = await proxyFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json() as Record<string, string>;
    return {
      symbol,
      lastPrice:          parseFloat(d.lastPrice),
      priceChangePercent: parseFloat(d.priceChangePercent),
      volume24h:          parseFloat(d.volume),
      highPrice:          parseFloat(d.highPrice),
      lowPrice:           parseFloat(d.lowPrice),
    };
  } catch (err) {
    console.warn(`[volatilityEngine] Binance ticker fail for ${symbol}:`, err);
    return null;
  }
}

// ── Bybit adapter ─────────────────────────────────────────────
async function fetchBybitTicker(symbol: string): Promise<ExchangeTickerData | null> {
  try {
    const url = `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`;
    const res = await proxyFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { result?: { list?: Record<string, string>[] } };
    const d    = json.result?.list?.[0];
    if (!d) return null;
    return {
      symbol,
      lastPrice:          parseFloat(d.lastPrice),
      priceChangePercent: parseFloat(d.price24hPcnt) * 100,
      volume24h:          parseFloat(d.volume24h),
      highPrice:          parseFloat(d.highPrice24h),
      lowPrice:           parseFloat(d.lowPrice24h),
    };
  } catch (err) {
    console.warn(`[volatilityEngine] Bybit ticker fail for ${symbol}:`, err);
    return null;
  }
}

// ── Kraken adapter ────────────────────────────────────────────
// Kraken uses different pair naming; best-effort mapping
const krakenSymbolMap: Record<string, string> = {
  BTCUSDT: 'XBTUSD',
  ETHUSDT: 'ETHUSD',
  SOLUSDT: 'SOLUSD',
  XRPUSDT: 'XRPUSD',
};

async function fetchKrakenTicker(symbol: string): Promise<ExchangeTickerData | null> {
  const krakenPair = krakenSymbolMap[symbol];
  if (!krakenPair) return null;
  try {
    const url = `https://api.kraken.com/0/public/Ticker?pair=${krakenPair}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as { result: Record<string, { c: string[]; v: string[]; h: string[]; l: string[] }> };
    const key  = Object.keys(json.result)[0];
    const d    = json.result[key];
    const last  = parseFloat(d.c[0]);
    const high  = parseFloat(d.h[1]);
    const low   = parseFloat(d.l[1]);
    const vol   = parseFloat(d.v[1]);
    const chg   = ((last - low) / low) * 100;
    return {
      symbol,
      lastPrice:          last,
      priceChangePercent: chg,
      volume24h:          vol,
      highPrice:          high,
      lowPrice:           low,
    };
  } catch (err) {
    console.warn(`[volatilityEngine] Kraken ticker fail for ${symbol}:`, err);
    return null;
  }
}

// ── Volatility computation helpers ───────────────────────────
/**
 * Approximate 24h volatility as (High - Low) / Low * 100.
 * Simple and exchange-agnostic.
 */
function computeVolatility24h(ticker: ExchangeTickerData): number {
  if (ticker.lowPrice === 0) return 0;
  return ((ticker.highPrice - ticker.lowPrice) / ticker.lowPrice) * 100;
}

/**
 * Determine market regime label from volatility ratio and direction.
 */
function classifyRegime(
  volRatio: number,
  priceChangePct: number,
): string {
  if (volRatio >= 3)   return 'extreme expansion';
  if (volRatio >= 2)   return priceChangePct > 0 ? 'breakout likely' : 'breakdown likely';
  if (volRatio >= 1.5) return 'high compression';
  return 'normal';
}

/**
 * Map regime + ratios to severity level.
 */
function classifySeverity(volRatio: number, volumeRatio: number): AlertSeverity {
  if (volRatio >= 3 && volumeRatio >= 2.5) return 'critical';
  if (volRatio >= 2 && volumeRatio >= 1.5) return 'high';
  if (volRatio >= 1.5)                     return 'medium';
  return 'low';
}

// ── In-memory rolling average store ──────────────────────────
// Maps "exchange:symbol" → rolling 30-day approximation.
// In production this should be persisted in market_intel_snapshots.
const rollingAvgStore = new Map<string, { vol30dAvg: number; volAvg30d: number; count: number }>();

function updateRollingAvg(key: string, vol24h: number, vol24hVolume: number): {
  vol30dAvg: number;
  volAvg30d: number;
} {
  const existing = rollingAvgStore.get(key);
  if (!existing) {
    rollingAvgStore.set(key, { vol30dAvg: vol24h, volAvg30d: vol24hVolume, count: 1 });
    return { vol30dAvg: vol24h, volAvg30d: vol24hVolume };
  }
  // Exponential moving average approximation (α = 1/30)
  const alpha      = 1 / 30;
  const vol30dAvg  = existing.vol30dAvg  * (1 - alpha) + vol24h        * alpha;
  const volAvg30d  = existing.volAvg30d  * (1 - alpha) + vol24hVolume  * alpha;
  rollingAvgStore.set(key, { vol30dAvg, volAvg30d, count: existing.count + 1 });
  return { vol30dAvg, volAvg30d };
}

// ── Snapshot + alert persistence (injected DB client) ─────────
export interface VolatilityEngineDeps {
  /** Persist a raw snapshot */
  saveSnapshot(snap: VolatilitySnapshot): Promise<void>;
  /** Persist a triggered alert */
  saveAlert(alert: VolatilityAlert): Promise<void>;
  /** (Optional) Emit real-time alert to WebSocket clients */
  broadcastAlert?(alert: VolatilityAlert): void;
}

// ── Core run logic ────────────────────────────────────────────
async function analyseSymbol(
  symbol: string,
  deps: VolatilityEngineDeps,
): Promise<VolatilityAlert[]> {
  const alerts: VolatilityAlert[] = [];

  const fetchers: Array<[string, () => Promise<ExchangeTickerData | null>]> = [
    ['binance', () => fetchBinanceTicker(symbol)],
    ['bybit',   () => fetchBybitTicker(symbol)],
    ['kraken',  () => fetchKrakenTicker(symbol)],
  ];

  for (const [exchange, fetchFn] of fetchers) {
    try {
      const ticker = await fetchFn();
      if (!ticker) continue;

      const volatility24h = computeVolatility24h(ticker);
      const key           = `${exchange}:${symbol}`;
      const { vol30dAvg, volAvg30d } = updateRollingAvg(
        key,
        volatility24h,
        ticker.volume24h,
      );

      const snap: VolatilitySnapshot = {
        symbol,
        exchange,
        volatility24h,
        volatility30dAvg: vol30dAvg,
        volume24h:        ticker.volume24h,
        volumeAvg:        volAvg30d,
        fetchedAt:        new Date(),
      };

      await deps.saveSnapshot(snap);

      // ── Trigger logic ─────────────────────────────────────
      const volRatio    = vol30dAvg > 0 ? volatility24h / vol30dAvg : 1;
      const volumeRatio = volAvg30d  > 0 ? ticker.volume24h / volAvg30d : 1;

      if (volRatio >= VOL_MULTIPLIER && volumeRatio >= VOLUME_MULTIPLIER) {
        const regime   = classifyRegime(volRatio, ticker.priceChangePercent);
        const severity = classifySeverity(volRatio, volumeRatio);

        const alert: VolatilityAlert = {
          symbol,
          exchange,
          volatilityRatio: Math.round(volRatio * 100) / 100,
          volumeRatio:     Math.round(volumeRatio * 100) / 100,
          regime,
          severity,
          message: [
            `${symbol} volatility spike detected on ${exchange.toUpperCase()}`,
            `Volatility: +${Math.round(volatility24h * 10) / 10}%`,
            `Volume spike: ${Math.round(volumeRatio * 10) / 10}x`,
            `Market regime: ${regime}`,
          ].join('\n'),
          triggeredAt: new Date(),
        };

        await deps.saveAlert(alert);
        deps.broadcastAlert?.(alert);
        alerts.push(alert);
        console.info(`[volatilityEngine] 🔔 Alert: ${alert.message.split('\n')[0]}`);
      }
    } catch (err) {
      console.error(`[volatilityEngine] Error processing ${exchange}:${symbol}:`, err);
    }
  }

  return alerts;
}

/**
 * Main entry point — called by the scheduler every 60s.
 * Returns all alerts triggered in this run.
 */
export async function runVolatilityEngine(
  deps: VolatilityEngineDeps,
  symbols: string[] = WATCHED_SYMBOLS,
): Promise<VolatilityAlert[]> {
  const start  = Date.now();
  console.info(`[volatilityEngine] Run started — ${symbols.length} symbols`);

  const allAlerts: VolatilityAlert[] = [];

  // Process symbols in parallel (cap at 5 concurrent to respect rate limits)
  const CONCURRENCY = 5;
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(sym => analyseSymbol(sym, deps)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') allAlerts.push(...r.value);
    }
  }

  console.info(
    `[volatilityEngine] Run complete in ${Date.now() - start}ms — ` +
    `${allAlerts.length} alert(s) triggered`,
  );

  return allAlerts;
}

export default { runVolatilityEngine };
