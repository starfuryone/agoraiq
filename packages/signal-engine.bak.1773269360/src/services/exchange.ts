/**
 * @agoraiq/signal-engine — Shared Exchange Factory
 *
 * Single CCXT exchange instance shared across all services.
 * Config-driven: reads exchangeId, API keys, and optional
 * proxy settings from the engine config.
 *
 * Previously, market-data.ts, orderbook-depth.ts, and
 * cross-exchange.ts each created their own CCXT instance.
 * derivatives.ts, whale-detection.ts, and liquidation-clusters.ts
 * used raw axios to hardcoded Binance URLs. This module
 * replaces all of that with a single coordinated factory.
 */

import ccxt, { type Exchange } from "ccxt";
import { config, toExchangePair } from "../config";

// ─── Primary Exchange (configured in .env) ─────────────────────────────────────

let primary: Exchange | null = null;

export function getPrimaryExchange(): Exchange {
  if (primary) return primary;

  const ExchangeClass = (ccxt as any)[config.exchangeId];
  if (!ExchangeClass) {
    throw new Error(`Unsupported exchange: ${config.exchangeId}`);
  }

  const opts: Record<string, unknown> = {
    enableRateLimit: true,
  };

  if (config.exchangeApiKey) opts.apiKey = config.exchangeApiKey;
  if (config.exchangeApiSecret) opts.secret = config.exchangeApiSecret;

  // SOCKS5 proxy support — CCXT reads socksProxy from options.
  // Set EXCHANGE_SOCKS_PROXY=socks5://127.0.0.1:1080 in .env
  if (config.socksProxy) {
    opts.socksProxy = config.socksProxy;
  }
  if (config.httpProxy) {
    opts.httpProxy = config.httpProxy;
  }

  primary = new ExchangeClass(opts) as Exchange;
  return primary;
}

// ─── Futures sub-client (Binance-specific) ─────────────────────────────────────
// Some endpoints (funding, OI) live on the futures API which CCXT
// handles transparently via exchange.fapiPublicGetXxx methods.
// But some don't have CCXT wrappers, so we expose the base URL.

export function getFuturesBaseUrl(): string {
  // CCXT doesn't expose the futures base URL cleanly.
  // For Binance, it's always fapi.binance.com.
  if (config.exchangeId === "binance") {
    return "https://fapi.binance.com";
  }
  if (config.exchangeId === "bybit") {
    return "https://api.bybit.com";
  }
  // Fallback — callers should handle this gracefully
  return "";
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function num(val: number | undefined | null, fallback = 0): number {
  return typeof val === "number" ? val : fallback;
}

export { toExchangePair };

/**
 * Reset exchange instances (for testing).
 */
export function resetExchanges(): void {
  primary = null;
}
