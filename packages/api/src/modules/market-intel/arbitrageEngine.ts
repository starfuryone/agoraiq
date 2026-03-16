import { proxyFetch } from './proxyFetch';
// ============================================================
// AgoraIQ Market Intel — Exchange Arbitrage Detection Engine
// /services/arbitrageEngine.ts
//
// Detects price differences across exchanges for the same pair.
// Cron: every 60 seconds (configurable to 30s).
// ============================================================

import type {
  ExchangePrice,
  ArbitrageAlert,
  AlertSeverity,
} from './index.js';

// ── Config ────────────────────────────────────────────────────
const SPREAD_THRESHOLD = parseFloat(
  process.env.MARKET_INTEL_SPREAD_THRESHOLD ?? '0.003',
); // 0.3% default

// Estimated taker fees per exchange (round-trip = buy + sell)
const FEE_MAP: Record<string, number> = {
  binance:  0.001,   // 0.1% taker
  bybit:    0.001,
  kraken:   0.0026,  // 0.26% taker
  okx:      0.001,
  coinbase: 0.006,
};

// Minimum profit after fees to emit alert (0.05%)
const MIN_NET_PROFIT = 0.0005;

// Watched symbols (must be available on multiple exchanges)
const ARBI_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'BNBUSDT', 'AVAXUSDT',
];

// ── Price fetchers ────────────────────────────────────────────
async function getBinancePrice(symbol: string): Promise<ExchangePrice | null> {
  try {
    const res = await proxyFetch(`https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`);
    if (!res.ok) return null;
    const d = await res.json() as { bidPrice: string; askPrice: string };
    const bid = parseFloat(d.bidPrice);
    const ask = parseFloat(d.askPrice);
    return { exchange: 'binance', symbol, bid, ask, mid: (bid + ask) / 2, fetchedAt: new Date() };
  } catch { return null; }
}

async function getBybitPrice(symbol: string): Promise<ExchangePrice | null> {
  try {
    const res = await proxyFetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`);
    if (!res.ok) return null;
    const json = await res.json() as { result?: { list?: Record<string, string>[] } };
    const d = json.result?.list?.[0];
    if (!d) return null;
    const bid = parseFloat(d.bid1Price);
    const ask = parseFloat(d.ask1Price);
    return { exchange: 'bybit', symbol, bid, ask, mid: (bid + ask) / 2, fetchedAt: new Date() };
  } catch { return null; }
}

// Kraken symbol mapping
const KRAKEN_MAP: Record<string, string> = {
  BTCUSDT: 'XBTUSD',
  ETHUSDT: 'ETHUSD',
  SOLUSDT: 'SOLUSD',
  XRPUSDT: 'XRPUSD',
  ADAUSDT: 'ADAUSD',
};

async function getKrakenPrice(symbol: string): Promise<ExchangePrice | null> {
  const pair = KRAKEN_MAP[symbol];
  if (!pair) return null;
  try {
    const res = await fetch(
      `https://api.kraken.com/0/public/Ticker?pair=${pair}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return null;
    const json = await res.json() as { result: Record<string, { b: string[]; a: string[] }> };
    const key  = Object.keys(json.result)[0];
    const d    = json.result[key];
    const bid  = parseFloat(d.b[0]);
    const ask  = parseFloat(d.a[0]);
    return { exchange: 'kraken', symbol, bid, ask, mid: (bid + ask) / 2, fetchedAt: new Date() };
  } catch { return null; }
}

async function getOkxPrice(symbol: string): Promise<ExchangePrice | null> {
  // OKX uses USDT pairs in format BTC-USDT
  const okxSym = symbol.replace('USDT', '-USDT');
  try {
    const res = await fetch(
      `https://www.okx.com/api/v5/market/ticker?instId=${okxSym}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return null;
    const json = await res.json() as { data?: { bidPx: string; askPx: string }[] };
    const d = json.data?.[0];
    if (!d) return null;
    const bid = parseFloat(d.bidPx);
    const ask = parseFloat(d.askPx);
    return { exchange: 'okx', symbol, bid, ask, mid: (bid + ask) / 2, fetchedAt: new Date() };
  } catch { return null; }
}

// ── All price fetchers registry ───────────────────────────────
const PRICE_FETCHERS: Array<(sym: string) => Promise<ExchangePrice | null>> = [
  getBinancePrice,
  getBybitPrice,
  getKrakenPrice,
  getOkxPrice,
  getGatePrice,
  getKucoinPrice,
  getMexcPrice,
];


async function getGatePrice(symbol: string): Promise<ExchangePrice | null> {
  try {
    const gateSymbol = symbol.replace('USDT', '_USDT');
    const res = await fetch(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${gateSymbol}&limit=1`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const d = await res.json() as { bids: string[][]; asks: string[][] };
    const bid = parseFloat(d.bids[0][0]);
    const ask = parseFloat(d.asks[0][0]);
    if (!bid || !ask) return null;
    return { exchange: 'gate', symbol, bid, ask, mid: (bid + ask) / 2, fetchedAt: new Date() };
  } catch { return null; }
}

async function getKucoinPrice(symbol: string): Promise<ExchangePrice | null> {
  try {
    const kcSymbol = symbol.replace('USDT', '-USDT');
    const res = await fetch(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${kcSymbol}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const d = await res.json() as { data?: { bestBid: string; bestAsk: string } };
    if (!d.data) return null;
    const bid = parseFloat(d.data.bestBid);
    const ask = parseFloat(d.data.bestAsk);
    if (!bid || !ask) return null;
    return { exchange: 'kucoin', symbol, bid, ask, mid: (bid + ask) / 2, fetchedAt: new Date() };
  } catch { return null; }
}

async function getMexcPrice(symbol: string): Promise<ExchangePrice | null> {
  try {
    const res = await fetch(`https://api.mexc.com/api/v3/ticker/bookTicker?symbol=${symbol}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const d = await res.json() as { bidPrice: string; askPrice: string };
    const bid = parseFloat(d.bidPrice);
    const ask = parseFloat(d.askPrice);
    if (!bid || !ask) return null;
    return { exchange: 'mexc', symbol, bid, ask, mid: (bid + ask) / 2, fetchedAt: new Date() };
  } catch { return null; }
}

async function fetchAllPrices(symbol: string): Promise<ExchangePrice[]> {
  const results = await Promise.allSettled(
    PRICE_FETCHERS.map(fn => fn(symbol)),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<ExchangePrice> =>
      r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value!);
}

// ── Spread computation ────────────────────────────────────────
interface SpreadCandidate {
  buyExchange:  string;
  sellExchange: string;
  buyPrice:     number;
  sellPrice:    number;
  spreadPct:    number;
  netProfitPct: number;
}

function findBestArbitrage(prices: ExchangePrice[]): SpreadCandidate | null {
  if (prices.length < 2) return null;

  let best: SpreadCandidate | null = null;

  for (let i = 0; i < prices.length; i++) {
    for (let j = 0; j < prices.length; j++) {
      if (i === j) continue;

      const buyEx  = prices[i];  // we buy at ask
      const sellEx = prices[j];  // we sell at bid

      if (buyEx.ask <= 0 || sellEx.bid <= 0) continue;

      const spreadPct   = (sellEx.bid - buyEx.ask) / buyEx.ask;
      const feesRoundTrip = (FEE_MAP[buyEx.exchange] ?? 0.001) +
                            (FEE_MAP[sellEx.exchange] ?? 0.001);
      const netProfitPct  = spreadPct - feesRoundTrip;

      if (spreadPct > SPREAD_THRESHOLD && netProfitPct > MIN_NET_PROFIT) {
        if (!best || spreadPct > best.spreadPct) {
          best = {
            buyExchange:  buyEx.exchange,
            sellExchange: sellEx.exchange,
            buyPrice:     buyEx.ask,
            sellPrice:    sellEx.bid,
            spreadPct,
            netProfitPct,
          };
        }
      }
    }
  }

  return best;
}

// ── Severity mapping ──────────────────────────────────────────
function getArbiSeverity(spreadPct: number): AlertSeverity {
  if (spreadPct >= 0.01) return 'critical';
  if (spreadPct >= 0.006) return 'high';
  if (spreadPct >= 0.003) return 'medium';
  return 'low';
}

// ── Idempotency guard ─────────────────────────────────────────
// Prevent duplicate alerts for same pair within 5 minutes
const recentAlerts = new Map<string, number>(); // key → timestamp ms
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

function isDuplicate(symbol: string, buyEx: string, sellEx: string): boolean {
  const key = `${symbol}:${buyEx}:${sellEx}`;
  const last = recentAlerts.get(key);
  if (last && Date.now() - last < DEDUP_WINDOW_MS) return true;
  recentAlerts.set(key, Date.now());
  return false;
}

// ── Persistence interface ─────────────────────────────────────
export interface ArbitrageEngineDeps {
  saveAlert(alert: ArbitrageAlert): Promise<void>;
  broadcastAlert?(alert: ArbitrageAlert): void;
}

// ── Core run logic ────────────────────────────────────────────
async function analyseArbitrage(
  symbol: string,
  deps: ArbitrageEngineDeps,
): Promise<ArbitrageAlert | null> {
  const prices = await fetchAllPrices(symbol);
  if (prices.length < 2) return null;

  const best = findBestArbitrage(prices);
  if (!best) return null;
  if (isDuplicate(symbol, best.buyExchange, best.sellExchange)) return null;

  const pctFormatted    = (best.spreadPct    * 100).toFixed(2);
  const netFormatted    = (best.netProfitPct * 100).toFixed(2);

  const alert: ArbitrageAlert = {
    symbol,
    buyExchange:      best.buyExchange,
    sellExchange:     best.sellExchange,
    buyPrice:         best.buyPrice,
    sellPrice:        best.sellPrice,
    spreadPct:        Math.round(best.spreadPct    * 100000) / 100000,
    profitPotentialPct: Math.round(best.netProfitPct * 100000) / 100000,
    severity:         getArbiSeverity(best.spreadPct),
    message: [
      `ARBITRAGE ALERT — ${symbol}`,
      `Buy  ${best.buyExchange.toUpperCase()}  @ $${best.buyPrice.toLocaleString()}`,
      `Sell ${best.sellExchange.toUpperCase()} @ $${best.sellPrice.toLocaleString()}`,
      `Gross spread: ${pctFormatted}%  |  Net profit: ~${netFormatted}%`,
    ].join('\n'),
    triggeredAt: new Date(),
  };

  await deps.saveAlert(alert);
  deps.broadcastAlert?.(alert);
  console.info(`[arbitrageEngine] 🔔 ${alert.message.split('\n')[0]}`);
  return alert;
}

/**
 * Main entry point — called by the scheduler every 60s (or 30s).
 */
export async function runArbitrageEngine(
  deps: ArbitrageEngineDeps,
  symbols: string[] = ARBI_SYMBOLS,
): Promise<ArbitrageAlert[]> {
  const start = Date.now();
  console.info(`[arbitrageEngine] Run started — ${symbols.length} pairs`);

  const alerts: ArbitrageAlert[] = [];

  const CONCURRENCY = 4;
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(sym => analyseArbitrage(sym, deps)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) alerts.push(r.value);
    }
  }

  console.info(
    `[arbitrageEngine] Run complete in ${Date.now() - start}ms — ` +
    `${alerts.length} alert(s)`,
  );

  return alerts;
}

export default { runArbitrageEngine };
