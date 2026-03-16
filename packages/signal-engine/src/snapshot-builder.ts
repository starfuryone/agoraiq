/**
 * @agoraiq/signal-engine — Snapshot Builder
 *
 * Assembles a complete MarketSnapshot from exchange, derivatives,
 * news, and sentiment data sources.
 *
 * All exchange-facing services now route through the shared CCXT
 * factory (services/exchange.ts), which handles proxy config,
 * API keys, and rate limiting in one place.
 *
 * Resilience: candles are the hard requirement. Everything else
 * uses safeFetch with neutral fallbacks.
 */

import type { MarketSnapshot, Candle } from "./types";
import { RegimeType } from "./types";
import { config } from "./config";
import { getOHLCV, getOrderbookImbalance } from "./services/market-data";
import {
  getFundingRate,
  getOpenInterest,
  getLiquidationData,
  type FundingData,
  type OpenInterestData,
  type LiquidationData,
} from "./services/derivatives";
import { getRecentAssetNews, type NewsContext } from "./services/news";
import { getAssetSentiment, type SentimentContext } from "./services/sentiment";
import { analyzeOrderbookDepth, NEUTRAL_DEPTH } from "./services/orderbook-depth";
import { detectWhaleActivity, NEUTRAL_WHALE } from "./services/whale-detection";
import { analyzeLiquidationClusters, NEUTRAL_LIQ_CLUSTERS } from "./services/liquidation-clusters";
import { getCrossExchangeContext, NEUTRAL_CROSS_EXCHANGE } from "./services/cross-exchange";
import {
  computeRSI,
  computeMACD,
  computeEMA,
  computeATR,
  computeBollinger,
  computeVWAP,
} from "./utils/ta";
import { detectMarketRegime } from "./regime-detector";
import { logger } from "./services/logger";

// ─── Safe fetch wrapper ────────────────────────────────────────────────────────

async function safeFetch<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn(`${label} failed — using fallback`, { err });
    return fallback;
  }
}

// ─── Neutral defaults ──────────────────────────────────────────────────────────

const NEUTRAL_FUNDING: FundingData = { current: 0 };
const NEUTRAL_OI: OpenInterestData = { current: 0, changePct1h: 0 };
const NEUTRAL_LIQ: LiquidationData = { longValue: 0, shortValue: 0 };
const NEUTRAL_NEWS: NewsContext = { eventScore: 0, sourceCredibilityScore: 0.5 };
const NEUTRAL_SENTIMENT: SentimentContext = { aggregateScore: 0, fearGreed: 50, fundingDeviation: 0, confidence: 0 };

// ─── Candle validation ─────────────────────────────────────────────────────────

function validateCandles(candles: Candle[], symbol: string): void {
  if (candles.length < 200) {
    logger.warn(`${symbol}: only ${candles.length} candles (need 200 for EMA200)`);
  }

  let zeroVolBars = 0;
  let gapBars = 0;

  for (let i = 1; i < candles.length; i++) {
    if (candles[i].volume === 0) zeroVolBars++;
    if (candles[i - 1].close > 0) {
      const gap = Math.abs(candles[i].open - candles[i - 1].close) / candles[i - 1].close;
      if (gap > 0.05) gapBars++;
    }
  }

  if (zeroVolBars > 0 || gapBars > 0) {
    logger.warn(
      `${symbol}: candle quality — ${zeroVolBars} zero-volume bars, ${gapBars} bars with >5% gap`
    );
  }
}

// ─── Main builder ──────────────────────────────────────────────────────────────

export async function buildMarketSnapshot(
  symbol: string,
  timeframe: string
): Promise<MarketSnapshot | null> {
  logger.info(`Building snapshot: ${symbol} ${timeframe}`);

  // Candles are the hard requirement
  const candles = await safeFetch("OHLCV", () => getOHLCV(symbol, timeframe, 300), []);
  if (candles.length === 0) {
    logger.warn(`No candle data for ${symbol} ${timeframe} — skipping`);
    return null;
  }

  validateCandles(candles, symbol);

  // Phase 1: fetch derivatives + news in parallel
  // Funding and OI are needed by sentiment, so they go first.
  const [orderbookImbalance, funding, oi, liquidations, newsCtx] =
    await Promise.all([
      safeFetch("orderbook", () => getOrderbookImbalance(symbol), 0),
      safeFetch("funding", () => getFundingRate(symbol), NEUTRAL_FUNDING),
      safeFetch("OI", () => getOpenInterest(symbol), NEUTRAL_OI),
      safeFetch("liquidations", () => getLiquidationData(symbol), NEUTRAL_LIQ),
      safeFetch("news", () => getRecentAssetNews(symbol, 6), NEUTRAL_NEWS),
    ]);

  // Phase 2: sentiment uses per-asset funding + OI
  const sentimentCtx = await safeFetch(
    "sentiment",
    () => getAssetSentiment(symbol, funding.current, oi.changePct1h),
    NEUTRAL_SENTIMENT
  );

  // Compute technical indicators
  const closes = candles.map((c) => c.close);
  const lastCandle = candles[candles.length - 1];

  const rsi = computeRSI(closes, 14);
  const macd = computeMACD(closes);
  const ema20 = computeEMA(closes, 20);
  const ema50 = computeEMA(closes, 50);
  const ema200 = computeEMA(closes, 200);
  const atr = computeATR(candles, 14);
  const bollinger = computeBollinger(closes, 20, 2);
  const vwap = computeVWAP(candles);

  // Phase 3: alpha intelligence (needs price from candles)
  const currentPrice = lastCandle.close;
  const [orderbookDepth, whaleActivity, liquidationClusters, crossExchange] =
    await Promise.all([
      safeFetch("depth", () => analyzeOrderbookDepth(symbol, currentPrice), NEUTRAL_DEPTH),
      safeFetch("whales", () => detectWhaleActivity(symbol), NEUTRAL_WHALE),
      safeFetch("liqClusters", () => analyzeLiquidationClusters(symbol, currentPrice), NEUTRAL_LIQ_CLUSTERS),
      safeFetch("crossEx", () => getCrossExchangeContext(symbol), NEUTRAL_CROSS_EXCHANGE),
    ]);

  // Assemble
  const snapshot: MarketSnapshot = {
    symbol,
    timeframe,
    timestamp: new Date(),

    price: currentPrice,
    volume: lastCandle.volume,
    high: lastCandle.high,
    low: lastCandle.low,

    rsi,
    macdLine: macd.line,
    macdSignal: macd.signal,
    macdHistogram: macd.histogram,
    ema20,
    ema50,
    ema200,
    atr,
    bollingerUpper: bollinger.upper,
    bollingerMid: bollinger.mid,
    bollingerLower: bollinger.lower,
    vwap,

    fundingRate: funding.current,
    openInterest: oi.current,
    oiChangePct: oi.changePct1h,
    liquidationLong: liquidations.longValue,
    liquidationShort: liquidations.shortValue,
    orderbookImbalance,

    orderbookDepth,
    whaleActivity,
    liquidationClusters,
    crossExchange,

    sentimentScore: sentimentCtx.aggregateScore,
    fearGreed: sentimentCtx.fearGreed,
    newsEventScore: newsCtx.eventScore,
    sourceCredibilityScore: newsCtx.sourceCredibilityScore,

    regime: RegimeType.UNKNOWN,
    candles,
  };

  snapshot.regime = detectMarketRegime(snapshot, candles);

  logger.info(
    `Snapshot: ${symbol} ${timeframe} | $${snapshot.price.toFixed(2)} | ` +
      `regime=${snapshot.regime} RSI=${rsi.toFixed(1)} ATR=${atr.toFixed(2)}`
  );

  return snapshot;
}
