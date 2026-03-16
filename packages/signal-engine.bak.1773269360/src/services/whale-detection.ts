/**
 * @agoraiq/signal-engine — Whale Detection Service
 *
 * Tracks large trades (>$100K) to detect institutional activity.
 * A cluster of whale buys before a breakout is a leading signal.
 * Whale sells into a rally is a distribution warning.
 *
 * Uses Binance recent trades endpoint, filtered by size threshold.
 * Maintains a rolling 1h window of large trades per symbol.
 */

import type { WhaleActivity } from "../types";
import { getProxiedAxios } from "./http-client";
import { logger } from "./logger";

const BINANCE_API = "https://api.binance.com";

// Per-symbol thresholds for "large trade" in USD
const WHALE_THRESHOLDS: Record<string, number> = {
  BTC: 100_000,
  ETH: 50_000,
  SOL: 25_000,
  XRP: 25_000,
};
const DEFAULT_WHALE_THRESHOLD = 25_000;

interface TrackedTrade {
  timestamp: number;
  price: number;
  quantity: number;
  quoteValue: number;
  isBuyerMaker: boolean; // true = sell (taker sold), false = buy (taker bought)
}

// Rolling window of large trades per symbol
const tradeHistory = new Map<string, TrackedTrade[]>();
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

export const NEUTRAL_WHALE: WhaleActivity = {
  largeTradeCount: 0,
  largeTradeNetVolume: 0,
  whaleDirection: "NEUTRAL",
  largeTradeRatio: 0,
};

/**
 * Detect whale activity for a symbol by analyzing recent large trades.
 */
export async function detectWhaleActivity(
  symbol: string
): Promise<WhaleActivity> {
  try {
    const pair = `${symbol}USDT`;
    const threshold = WHALE_THRESHOLDS[symbol] ?? DEFAULT_WHALE_THRESHOLD;

    // Fetch last 1000 trades (Binance max per request)
    const res = await getProxiedAxios().get(`${BINANCE_API}/api/v3/trades`, {
      params: { symbol: pair, limit: 1000 },
      timeout: 5000,
    });

    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    let totalVolume = 0;

    // Get or create history for this symbol
    let history = tradeHistory.get(symbol);
    if (!history) {
      history = [];
      tradeHistory.set(symbol, history);
    }

    // Process new trades
    for (const trade of res.data) {
      const price = parseFloat(trade.price) || 0;
      const qty = parseFloat(trade.qty) || 0;
      const quoteValue = price * qty;
      const time = trade.time ?? now;

      totalVolume += quoteValue;

      if (quoteValue >= threshold && time > cutoff) {
        history.push({
          timestamp: time,
          price,
          quantity: qty,
          quoteValue,
          isBuyerMaker: trade.isBuyerMaker,
        });
      }
    }

    // Prune old entries
    history = history.filter((t) => t.timestamp > cutoff);
    tradeHistory.set(symbol, history);

    if (history.length === 0) return NEUTRAL_WHALE;

    // Compute whale metrics
    let buyVolume = 0;
    let sellVolume = 0;

    for (const t of history) {
      if (t.isBuyerMaker) {
        sellVolume += t.quoteValue; // maker was buyer, taker sold
      } else {
        buyVolume += t.quoteValue; // taker bought
      }
    }

    const netVolume = buyVolume - sellVolume;
    const totalWhaleVolume = buyVolume + sellVolume;

    let direction: WhaleActivity["whaleDirection"] = "NEUTRAL";
    if (netVolume > totalWhaleVolume * 0.2) direction = "BUY";
    if (netVolume < -totalWhaleVolume * 0.2) direction = "SELL";

    const result: WhaleActivity = {
      largeTradeCount: history.length,
      largeTradeNetVolume: netVolume,
      whaleDirection: direction,
      largeTradeRatio: totalVolume > 0 ? totalWhaleVolume / totalVolume : 0,
    };

    logger.debug(
      `Whale ${symbol}: ${history.length} trades, net=$${(netVolume / 1000).toFixed(0)}K, ` +
        `dir=${direction}, ratio=${(result.largeTradeRatio * 100).toFixed(1)}%`
    );

    return result;
  } catch (err) {
    logger.warn(`Whale detection failed for ${symbol}`, { err });
    return NEUTRAL_WHALE;
  }
}
