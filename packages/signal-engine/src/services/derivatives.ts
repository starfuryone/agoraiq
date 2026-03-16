/**
 * @agoraiq/signal-engine — Derivatives Service
 *
 * Fetches funding rate, open interest, and liquidation data.
 *
 * CHANGES FROM V1:
 * - Uses shared exchange factory (proxy-aware, config-driven)
 * - Uses CCXT methods for funding and OI where available
 * - Falls back to raw HTTP only for endpoints CCXT doesn't wrap
 * - OI history persisted to SQLite — survives process restarts
 * - Liquidation endpoint hardened: response shape validation,
 *   explicit auth failure detection, structured error handling
 */

import { config } from "../config";
import { getPrimaryExchange, getFuturesBaseUrl, num } from "./exchange";
import { getProxiedAxios } from "./http-client";
import { getDb } from "../persistence/db";
import { logger } from "./logger";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface FundingData {
  current: number;
}

export interface OpenInterestData {
  current: number;
  changePct1h: number;
}

export interface LiquidationData {
  longValue: number;
  shortValue: number;
}

// ─── OI History (SQLite-backed) ────────────────────────────────────────────────

function ensureOITable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS oi_history (
      symbol    TEXT NOT NULL,
      value     REAL NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (symbol, recorded_at)
    );
    CREATE INDEX IF NOT EXISTS idx_oi_symbol_time ON oi_history(symbol, recorded_at);
  `);
}

let oiTableReady = false;

function recordOI(symbol: string, value: number): void {
  if (!oiTableReady) {
    ensureOITable();
    oiTableReady = true;
  }

  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT OR REPLACE INTO oi_history (symbol, value, recorded_at)
    VALUES (?, ?, ?)
  `).run(symbol, value, now);

  // Prune readings older than 2 hours
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  db.prepare(`DELETE FROM oi_history WHERE symbol = ? AND recorded_at < ?`).run(symbol, cutoff);
}

function computeOIChangePct(symbol: string, currentOI: number): number {
  if (!oiTableReady) {
    ensureOITable();
    oiTableReady = true;
  }

  const db = getDb();
  const targetTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const windowStart = new Date(Date.now() - 90 * 60 * 1000).toISOString(); // ±30min window

  const row = db.prepare(`
    SELECT value, recorded_at,
           ABS(julianday(recorded_at) - julianday(?)) AS delta
    FROM oi_history
    WHERE symbol = ?
      AND recorded_at BETWEEN ? AND ?
    ORDER BY delta ASC
    LIMIT 1
  `).get(targetTime, symbol, windowStart, targetTime) as { value: number } | undefined;

  if (!row || row.value === 0) return 0;
  return (currentOI - row.value) / row.value;
}

// ─── Funding Rate ──────────────────────────────────────────────────────────────

export async function getFundingRate(symbol: string): Promise<FundingData> {
  // Try CCXT first — works for most exchanges
  try {
    const ex = getPrimaryExchange();
    if (typeof ex.fetchFundingRate === "function") {
      const pair = `${symbol}/USDT:USDT`;
      const funding = await ex.fetchFundingRate(pair);
      return { current: num(funding.fundingRate) };
    }
  } catch {
    // CCXT method not available or failed — fall back to REST
  }

  // Fallback: direct Binance futures REST
  const baseUrl = getFuturesBaseUrl();
  if (!baseUrl) {
    logger.debug(`No futures base URL for exchange ${config.exchangeId}`);
    return { current: 0 };
  }

  try {
    const pair = `${symbol}USDT`;
    const res = await getProxiedAxios().get(`${baseUrl}/fapi/v1/premiumIndex`, {
      params: { symbol: pair },
      timeout: 5000,
    });

    if (!res.data || typeof res.data !== "object") {
      logger.warn(`Funding rate: unexpected response shape for ${symbol}`);
      return { current: 0 };
    }

    if (res.data.code) {
      // Binance error response: { code: -1121, msg: "Invalid symbol." }
      logger.warn(`Funding rate API error for ${symbol}: ${res.data.msg ?? res.data.code}`);
      return { current: 0 };
    }

    return {
      current: parseFloat(res.data.lastFundingRate) || 0,
    };
  } catch (err: any) {
    logger.warn(`Funding rate fetch failed for ${symbol}: ${err.message ?? err}`);
    return { current: 0 };
  }
}

// ─── Open Interest ─────────────────────────────────────────────────────────────

export async function getOpenInterest(
  symbol: string
): Promise<OpenInterestData> {
  const baseUrl = getFuturesBaseUrl();
  if (!baseUrl) {
    return { current: 0, changePct1h: 0 };
  }

  try {
    const pair = `${symbol}USDT`;
    const res = await getProxiedAxios().get(`${baseUrl}/fapi/v1/openInterest`, {
      params: { symbol: pair },
      timeout: 5000,
    });

    if (!res.data || typeof res.data !== "object" || res.data.code) {
      logger.warn(`OI response invalid for ${symbol}: ${res.data?.msg ?? "unexpected shape"}`);
      return { current: 0, changePct1h: 0 };
    }

    const raw = res.data.openInterest;
    const current = typeof raw === "string" ? parseFloat(raw) : num(raw);
    if (!current || current <= 0) {
      return { current: 0, changePct1h: 0 };
    }

    // Record to SQLite and compute change from ~1h ago
    recordOI(symbol, current);
    const changePct1h = computeOIChangePct(symbol, current);

    return { current, changePct1h };
  } catch (err: any) {
    logger.warn(`Open interest fetch failed for ${symbol}: ${err.message ?? err}`);
    return { current: 0, changePct1h: 0 };
  }
}

// ─── Liquidations ──────────────────────────────────────────────────────────────

/**
 * Fetch recent liquidation data.
 *
 * KNOWN ISSUES:
 * - allForceOrders requires API key on most Binance configurations
 * - Without auth, returns 403 or empty. We handle both.
 * - Response may be an error object instead of an array
 * - Liquidation values are estimates (forced market orders, actual
 *   fill price may differ from the order price field)
 */
export async function getLiquidationData(
  symbol: string
): Promise<LiquidationData> {
  const baseUrl = getFuturesBaseUrl();
  if (!baseUrl) {
    return { longValue: 0, shortValue: 0 };
  }

  try {
    const pair = `${symbol}USDT`;
    const res = await getProxiedAxios().get(`${baseUrl}/fapi/v1/allForceOrders`, {
      params: { symbol: pair, limit: 50 },
      timeout: 5000,
      validateStatus: (s) => s < 500, // don't throw on 4xx
    });

    // Auth failure — Binance returns 403 or {"code":-2015,"msg":"Invalid API-key..."}
    if (res.status === 403 || res.status === 401) {
      logger.debug(`Liquidation endpoint returned ${res.status} for ${symbol} (needs API key)`);
      return { longValue: 0, shortValue: 0 };
    }

    // Binance error object instead of array
    if (!Array.isArray(res.data)) {
      if (res.data?.code) {
        logger.debug(`Liquidation API error for ${symbol}: ${res.data.msg ?? res.data.code}`);
      } else {
        logger.debug(`Liquidation response not an array for ${symbol}`);
      }
      return { longValue: 0, shortValue: 0 };
    }

    let longValue = 0;
    let shortValue = 0;
    const cutoff = Date.now() - 60 * 60 * 1000;

    for (const order of res.data) {
      if (!order || typeof order !== "object") continue;

      const time = order.time ?? 0;
      if (time < cutoff) continue;

      const qty = parseFloat(order.origQty) || 0;
      const price = parseFloat(order.price) || 0;
      if (qty <= 0 || price <= 0) continue;

      const value = qty * price;

      if (order.side === "SELL") {
        longValue += value;  // sell-side force order = long liquidation
      } else if (order.side === "BUY") {
        shortValue += value;
      }
    }

    return { longValue, shortValue };
  } catch (err: any) {
    // Network errors, timeouts — not unexpected
    logger.debug(`Liquidation data unavailable for ${symbol}: ${err.message ?? err}`);
    return { longValue: 0, shortValue: 0 };
  }
}
