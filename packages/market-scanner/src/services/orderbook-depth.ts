/**
 * @agoraiq/signal-engine — Order Book Depth Analyzer
 *
 * Detects bid/ask walls, depth ratio, and spread from the shared exchange.
 */

import type { OrderbookDepth } from "../types";
import { getPrimaryExchange, toExchangePair, num } from "./exchange";
import { logger } from "./logger";

export const NEUTRAL_DEPTH: OrderbookDepth = {
  bidWallPrice: 0,
  bidWallSize: 0,
  askWallPrice: 0,
  askWallSize: 0,
  bidDepth1Pct: 0,
  askDepth1Pct: 0,
  depthRatio: 1,
  spreadBps: 0,
};

/**
 * Analyze orderbook depth for a symbol.
 * Fetches 100 levels (deep book) and computes wall detection + depth metrics.
 */
export async function analyzeOrderbookDepth(
  symbol: string,
  currentPrice: number
): Promise<OrderbookDepth> {
  try {
    const ex = getPrimaryExchange();
    const pair = toExchangePair(symbol);
    const book = await ex.fetchOrderBook(pair, 100);

    if (!book.bids.length || !book.asks.length) return NEUTRAL_DEPTH;

    const priceLow1Pct = currentPrice * 0.99;
    const priceHigh1Pct = currentPrice * 1.01;
    const priceLow2Pct = currentPrice * 0.98;
    const priceHigh2Pct = currentPrice * 1.02;

    let bidWallPrice = 0;
    let bidWallSize = 0;
    let bidDepth1Pct = 0;

    for (const level of book.bids) {
      const price = num(level[0]);
      const size = num(level[1]);
      const value = price * size;

      if (price >= priceLow2Pct && value > bidWallSize) {
        bidWallPrice = price;
        bidWallSize = value;
      }
      if (price >= priceLow1Pct) {
        bidDepth1Pct += value;
      }
    }

    let askWallPrice = 0;
    let askWallSize = 0;
    let askDepth1Pct = 0;

    for (const level of book.asks) {
      const price = num(level[0]);
      const size = num(level[1]);
      const value = price * size;

      if (price <= priceHigh2Pct && value > askWallSize) {
        askWallPrice = price;
        askWallSize = value;
      }
      if (price <= priceHigh1Pct) {
        askDepth1Pct += value;
      }
    }

    const depthRatio = askDepth1Pct > 0 ? bidDepth1Pct / askDepth1Pct : 1;

    const bestBid = num(book.bids[0]?.[0]);
    const bestAsk = num(book.asks[0]?.[0]);
    const mid = (bestBid + bestAsk) / 2;
    const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10000 : 0;

    const result: OrderbookDepth = {
      bidWallPrice, bidWallSize,
      askWallPrice, askWallSize,
      bidDepth1Pct, askDepth1Pct,
      depthRatio, spreadBps,
    };

    logger.debug(
      `Depth ${symbol}: walls bid=$${(bidWallSize / 1000).toFixed(0)}K@${bidWallPrice.toFixed(0)} ` +
        `ask=$${(askWallSize / 1000).toFixed(0)}K@${askWallPrice.toFixed(0)} ` +
        `ratio=${depthRatio.toFixed(2)} spread=${spreadBps.toFixed(1)}bps`
    );

    return result;
  } catch (err) {
    logger.warn(`Orderbook depth analysis failed for ${symbol}`, { err });
    return NEUTRAL_DEPTH;
  }
}
