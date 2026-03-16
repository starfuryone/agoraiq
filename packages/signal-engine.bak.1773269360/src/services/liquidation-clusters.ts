/**
 * @agoraiq/signal-engine — Liquidation Cluster Analyzer
 *
 * Goes beyond raw liquidation totals to identify:
 * - Price levels where long/short liquidations cluster (magnetic zones)
 * - Whether a liquidation cascade is in progress
 * - Net liquidation pressure direction
 *
 * A cluster of short liquidations at $88,000 means if price reaches
 * that level, forced buying will accelerate the move. That's alpha.
 */

import type { LiquidationClusters } from "../types";
import { getProxiedAxios } from "./http-client";
import { logger } from "./logger";

const BINANCE_FUTURES = "https://fapi.binance.com";

export const NEUTRAL_LIQ_CLUSTERS: LiquidationClusters = {
  longClusterPrice: 0,
  longClusterValue: 0,
  shortClusterPrice: 0,
  shortClusterValue: 0,
  netLiquidationPressure: 0,
  cascadeDetected: false,
};

interface LiqOrder {
  price: number;
  value: number;
  side: "LONG" | "SHORT";
  time: number;
}

// Rolling window for cascade detection
const recentLiqs = new Map<string, LiqOrder[]>();
const CASCADE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const CASCADE_THRESHOLD = 5; // 5+ liquidations in 5min = cascade

/**
 * Analyze liquidation clusters for a symbol.
 */
export async function analyzeLiquidationClusters(
  symbol: string,
  currentPrice: number
): Promise<LiquidationClusters> {
  try {
    const pair = `${symbol}USDT`;
    const res = await getProxiedAxios().get(
      `${BINANCE_FUTURES}/fapi/v1/allForceOrders`,
      {
        params: { symbol: pair, limit: 100 },
        timeout: 5000,
      }
    );

    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;

    // Parse liquidation orders
    const orders: LiqOrder[] = [];
    for (const order of res.data) {
      const time = order.time ?? 0;
      if (time < hourAgo) continue;

      const price = parseFloat(order.price) || 0;
      const qty = parseFloat(order.origQty) || 0;
      const value = price * qty;
      // SELL force order = long position liquidated
      const side: "LONG" | "SHORT" =
        order.side === "SELL" ? "LONG" : "SHORT";

      orders.push({ price, value, side, time });
    }

    if (orders.length === 0) return NEUTRAL_LIQ_CLUSTERS;

    // ─── Cluster detection ─────────────────────────────────────────────────
    // Bucket liquidations into price bins (0.5% width) and find the densest bin
    const binWidth = currentPrice * 0.005;

    const longBins = new Map<number, number>(); // binKey → total value
    const shortBins = new Map<number, number>();

    let totalLongValue = 0;
    let totalShortValue = 0;

    for (const o of orders) {
      const binKey = Math.floor(o.price / binWidth) * binWidth;

      if (o.side === "LONG") {
        longBins.set(binKey, (longBins.get(binKey) ?? 0) + o.value);
        totalLongValue += o.value;
      } else {
        shortBins.set(binKey, (shortBins.get(binKey) ?? 0) + o.value);
        totalShortValue += o.value;
      }
    }

    // Find densest long cluster (above current price = where longs get stopped)
    let longClusterPrice = 0;
    let longClusterValue = 0;
    for (const [price, value] of longBins) {
      if (value > longClusterValue) {
        longClusterPrice = price;
        longClusterValue = value;
      }
    }

    // Find densest short cluster (below current price = where shorts get squeezed)
    let shortClusterPrice = 0;
    let shortClusterValue = 0;
    for (const [price, value] of shortBins) {
      if (value > shortClusterValue) {
        shortClusterPrice = price;
        shortClusterValue = value;
      }
    }

    // ─── Cascade detection ─────────────────────────────────────────────────
    let history = recentLiqs.get(symbol) ?? [];
    history.push(...orders.filter((o) => o.time > now - CASCADE_WINDOW_MS));
    history = history.filter((o) => o.time > now - CASCADE_WINDOW_MS);
    recentLiqs.set(symbol, history);

    const cascadeDetected = history.length >= CASCADE_THRESHOLD;

    // ─── Net pressure ──────────────────────────────────────────────────────
    // Positive = more shorts liquidated (bullish pressure)
    // Negative = more longs liquidated (bearish pressure)
    const netLiquidationPressure = totalShortValue - totalLongValue;

    const result: LiquidationClusters = {
      longClusterPrice,
      longClusterValue,
      shortClusterPrice,
      shortClusterValue,
      netLiquidationPressure,
      cascadeDetected,
    };

    logger.debug(
      `LiqClusters ${symbol}: longCluster=$${(longClusterValue / 1000).toFixed(0)}K@${longClusterPrice.toFixed(0)} ` +
        `shortCluster=$${(shortClusterValue / 1000).toFixed(0)}K@${shortClusterPrice.toFixed(0)} ` +
        `net=${netLiquidationPressure > 0 ? "+" : ""}${(netLiquidationPressure / 1000).toFixed(0)}K ` +
        `cascade=${cascadeDetected}`
    );

    return result;
  } catch (err) {
    logger.debug(`Liquidation cluster analysis failed for ${symbol} (may need API key)`);
    return NEUTRAL_LIQ_CLUSTERS;
  }
}
