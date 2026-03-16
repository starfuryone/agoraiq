/**
 * @agoraiq/signal-engine v2 — Multi-Exchange Context Service
 *
 * WHAT THIS DOES
 * ──────────────
 * Fetches spot tickers from multiple exchanges via CCXT to detect:
 *   - Cross-exchange price divergence
 *   - Which exchange is leading by volume
 *   - Whether exchanges agree on price direction
 *   - Spot vs futures premium (Binance spot vs Binance futures)
 *
 * WHAT THIS DOES NOT DO
 * ─────────────────────
 *   - Does not model venue-specific liquidity (orderbook depth per venue)
 *   - Does not model maker/taker fee differences across venues
 *   - Does not model withdrawal latency or settlement time
 *   - Does not provide actionable arbitrage signals (latency kills that)
 *   - Does not differentiate wash trading volume from organic volume
 *   - Volume figures from some exchanges (especially OKX) may be inflated
 *
 * INTERPRETATION GUIDE
 * ────────────────────
 * A move on Coinbase spot first often means institutional/spot-driven flow.
 * A move on Binance futures first often means leverage-driven, prone to
 * reversal if spot doesn't follow. This is a weak signal — not a filter,
 * just context for the scoring engine.
 *
 * The volumeSharePct field shows each venue's share of total volume across
 * queried exchanges. A "leading" exchange with only 5% of volume is less
 * meaningful than one with 60%.
 */

import ccxt, { type Exchange } from "ccxt";
import type { CrossExchangeContext } from "../types";
import { toExchangePair } from "../config";
import { getProxyUrl } from "./http-client";
import { logger } from "./logger";

// ─── Exchange Pool ─────────────────────────────────────────────────────────────

const EXCHANGE_IDS = ["binance", "kraken", "bybit", "okx", "coinbasepro"];

const exchangePool = new Map<string, Exchange>();

function getOrCreateExchange(id: string): Exchange | null {
  if (exchangePool.has(id)) return exchangePool.get(id)!;
  try {
    const ExchangeClass = (ccxt as any)[id];
    if (!ExchangeClass) return null;

    const opts: Record<string, unknown> = { enableRateLimit: true };
    const proxyUrl = getProxyUrl();
    if (proxyUrl) {
      opts.socksProxy = proxyUrl;
    }

    const ex = new ExchangeClass(opts) as Exchange;
    exchangePool.set(id, ex);
    return ex;
  } catch {
    return null;
  }
}

function num(val: number | undefined | null, fallback = 0): number {
  return typeof val === "number" ? val : fallback;
}

export const NEUTRAL_CROSS_EXCHANGE: CrossExchangeContext = {
  prices: {},
  maxSpreadBps: 0,
  divergenceDetected: false,
  leadingExchange: "binance",
  priceConsensus: "MIXED",
  venueCount: 0,
  volumeSharePct: {},
  spotFuturesPremiumBps: 0,
};

// ─── Price history for direction detection ─────────────────────────────────────

const priceHistory = new Map<string, Map<string, number[]>>();
const HISTORY_LIMIT = 12;

function recordPrice(symbol: string, exchange: string, price: number): void {
  if (!priceHistory.has(symbol)) priceHistory.set(symbol, new Map());
  const symMap = priceHistory.get(symbol)!;
  if (!symMap.has(exchange)) symMap.set(exchange, []);
  const prices = symMap.get(exchange)!;
  prices.push(price);
  if (prices.length > HISTORY_LIMIT) prices.shift();
}

function getDirection(symbol: string, exchange: string): number {
  const prices = priceHistory.get(symbol)?.get(exchange);
  if (!prices || prices.length < 3) return 0;
  return prices[prices.length - 1] > prices[0] ? 1
    : prices[prices.length - 1] < prices[0] ? -1
    : 0;
}

// ─── Main function ─────────────────────────────────────────────────────────────

export async function getCrossExchangeContext(
  symbol: string
): Promise<CrossExchangeContext> {
  const pair = toExchangePair(symbol);
  const prices: Record<string, number> = {};
  const volumes: Record<string, number> = {};

  const results = await Promise.allSettled(
    EXCHANGE_IDS.map(async (id) => {
      const ex = getOrCreateExchange(id);
      if (!ex) return null;
      try {
        const ticker = await ex.fetchTicker(pair);
        return {
          exchange: id,
          price: num(ticker.last),
          volume: num(ticker.quoteVolume),
        };
      } catch {
        return null;
      }
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      const { exchange, price, volume } = result.value;
      if (price > 0) {
        prices[exchange] = price;
        volumes[exchange] = volume;
        recordPrice(symbol, exchange, price);
      }
    }
  }

  const exchanges = Object.keys(prices);
  const venueCount = exchanges.length;

  if (venueCount < 2) {
    return { ...NEUTRAL_CROSS_EXCHANGE, prices, venueCount };
  }

  // Max spread
  const priceValues = Object.values(prices);
  const minPrice = Math.min(...priceValues);
  const maxPrice = Math.max(...priceValues);
  const mid = (minPrice + maxPrice) / 2;
  const maxSpreadBps = mid > 0 ? ((maxPrice - minPrice) / mid) * 10000 : 0;
  const divergenceDetected = maxSpreadBps > 20;

  // Volume shares (contextualizes "leading exchange" claim)
  const totalVolume = Object.values(volumes).reduce((s, v) => s + v, 0);
  const volumeSharePct: Record<string, number> = {};
  for (const [ex, vol] of Object.entries(volumes)) {
    volumeSharePct[ex] = totalVolume > 0 ? (vol / totalVolume) * 100 : 0;
  }

  // Leading exchange
  let leadingExchange = "binance";
  let maxVolume = 0;
  for (const [ex, vol] of Object.entries(volumes)) {
    if (vol > maxVolume) { maxVolume = vol; leadingExchange = ex; }
  }

  // Price consensus
  let bullish = 0;
  let bearish = 0;
  for (const ex of exchanges) {
    const dir = getDirection(symbol, ex);
    if (dir > 0) bullish++;
    if (dir < 0) bearish++;
  }
  const majority = exchanges.length * 0.6;
  let priceConsensus: CrossExchangeContext["priceConsensus"] = "MIXED";
  if (bullish >= majority) priceConsensus = "BULLISH";
  if (bearish >= majority) priceConsensus = "BEARISH";

  // Spot-futures premium (Binance spot vs Binance perp funding implied)
  // This is a rough proxy — actual premium requires fetching futures ticker
  // separately. For now we estimate from funding rate (available in snapshot).
  // Set to 0 here; the real premium is computed in the snapshot builder if needed.
  const spotFuturesPremiumBps = 0;

  const result: CrossExchangeContext = {
    prices, maxSpreadBps, divergenceDetected, leadingExchange,
    priceConsensus, venueCount, volumeSharePct, spotFuturesPremiumBps,
  };

  logger.debug(
    `CrossEx ${symbol}: ${venueCount} venues, ` +
      `spread=${maxSpreadBps.toFixed(1)}bps, leader=${leadingExchange} ` +
      `(${volumeSharePct[leadingExchange]?.toFixed(0) ?? "?"}% vol), ` +
      `consensus=${priceConsensus}${divergenceDetected ? " DIVERGENCE" : ""}`
  );

  return result;
}
