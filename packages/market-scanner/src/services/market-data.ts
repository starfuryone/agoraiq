/**
 * @agoraiq/signal-engine — Market Data Service
 *
 * Fetches OHLCV candles and orderbook data from the shared exchange.
 */

import type { Candle } from "../types";
import { getPrimaryExchange, toExchangePair, num } from "./exchange";
import { logger } from "./logger";

/**
 * Fetch OHLCV candles from the exchange.
 */
export async function getOHLCV(
  symbol: string,
  timeframe: string,
  limit = 300
): Promise<Candle[]> {
  try {
    const ex = getPrimaryExchange();
    const pair = toExchangePair(symbol);
    const raw = await ex.fetchOHLCV(pair, timeframe, undefined, limit);

    return raw.map((bar) => ({
      timestamp: num(bar[0]),
      open: num(bar[1]),
      high: num(bar[2]),
      low: num(bar[3]),
      close: num(bar[4]),
      volume: num(bar[5]),
    }));
  } catch (err) {
    logger.error(`Failed to fetch OHLCV for ${symbol} ${timeframe}`, { err });
    return [];
  }
}

/**
 * Fetch the current orderbook and compute bid/ask imbalance.
 * Returns -1 (all asks) to +1 (all bids).
 */
export async function getOrderbookImbalance(symbol: string): Promise<number> {
  try {
    const ex = getPrimaryExchange();
    const pair = toExchangePair(symbol);
    const book = await ex.fetchOrderBook(pair, 20);

    let bidVolume = 0;
    for (const level of book.bids) bidVolume += num(level[1]);

    let askVolume = 0;
    for (const level of book.asks) askVolume += num(level[1]);

    const total = bidVolume + askVolume;
    if (total === 0) return 0;
    return (bidVolume - askVolume) / total;
  } catch (err) {
    logger.error(`Failed to fetch orderbook for ${symbol}`, { err });
    return 0;
  }
}

/**
 * Fetch the last traded price.
 */
export async function getLastPrice(symbol: string): Promise<number> {
  try {
    const ex = getPrimaryExchange();
    const pair = toExchangePair(symbol);
    const ticker = await ex.fetchTicker(pair);
    return num(ticker.last);
  } catch (err) {
    logger.error(`Failed to fetch last price for ${symbol}`, { err });
    return 0;
  }
}
