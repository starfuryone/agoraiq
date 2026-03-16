/**
 * @agoraiq/signal-engine — Configuration
 *
 * Reads environment variables, validates them at startup, and exposes
 * a typed config object. Fails fast on bad config rather than at runtime.
 */

import dotenv from "dotenv";
dotenv.config();

export interface EngineConfig {
  // AgoraIQ API
  apiBaseUrl: string;
  providerKey: string;
  providerToken: string;

  // Exchange
  exchangeId: string;
  exchangeApiKey: string;
  exchangeApiSecret: string;
  socksProxy: string;
  httpProxy: string;

  // News (CryptoPanic)
  cryptoPanicApiKey: string;
  newsMode: "live" | "stub";

  // Sentiment
  lunarCrushApiKey: string;

  // Persistence
  dbPath: string;

  // Engine settings
  scanIntervalMs: number;
  symbols: string[];
  timeframes: string[];
  minPublishScore: number;
  minExpectedR: number;
  engineVersion: string;

  // Operational
  dryRun: boolean;
  healthPort: number;
  maxConsecutiveFailures: number;
  publishRetryAttempts: number;
  publishRetryDelayMs: number;
  logLevel: string;

  // AI reasoning layer
  aiEnabled: boolean;
  aiApiKey: string;
  aiModel: string;
  aiTimeoutMs: number;
  aiMaxScoreAdjustment: number;
}

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`Env var ${key} must be an integer, got: ${raw}`);
  return parsed;
}

function envFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = parseFloat(raw);
  if (isNaN(parsed)) throw new Error(`Env var ${key} must be a number, got: ${raw}`);
  return parsed;
}

export const config: EngineConfig = {
  apiBaseUrl: env("AGORAIQ_API_BASE_URL", "http://localhost:3000/api/v1"),
  providerKey: env("AGORAIQ_ENGINE_PROVIDER_KEY", "agoraiq-engine"),
  providerToken: env("AGORAIQ_ENGINE_TOKEN", ""),

  exchangeId: env("EXCHANGE_ID", "binance"),
  exchangeApiKey: env("EXCHANGE_API_KEY", ""),
  exchangeApiSecret: env("EXCHANGE_API_SECRET", ""),
  socksProxy: env("EXCHANGE_SOCKS_PROXY", ""),
  httpProxy: env("EXCHANGE_HTTP_PROXY", ""),

  cryptoPanicApiKey: env("CRYPTOPANIC_API_KEY", ""),
  newsMode: (env("NEWS_MODE", "live") as "live" | "stub"),

  lunarCrushApiKey: env("LUNARCRUSH_API_KEY", ""),

  dbPath: env("ENGINE_DB_PATH", "./data/signal-engine.db"),

  scanIntervalMs: envInt("ENGINE_SCAN_INTERVAL_MS", 300_000),
  symbols: env("ENGINE_SYMBOLS", "BTC,ETH,SOL,XRP")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  timeframes: env("ENGINE_TIMEFRAMES", "15m,1h,4h")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  minPublishScore: envFloat("ENGINE_MIN_PUBLISH_SCORE", 70),
  minExpectedR: envFloat("ENGINE_MIN_EXPECTED_R", 1.3),
  engineVersion: env("ENGINE_VERSION", "1.0.0"),

  dryRun: envBool("ENGINE_DRY_RUN", false),
  healthPort: envInt("ENGINE_HEALTH_PORT", 9090),
  maxConsecutiveFailures: envInt("ENGINE_MAX_CONSECUTIVE_FAILURES", 10),
  publishRetryAttempts: envInt("ENGINE_PUBLISH_RETRY_ATTEMPTS", 2),
  publishRetryDelayMs: envInt("ENGINE_PUBLISH_RETRY_DELAY_MS", 1000),
  logLevel: env("LOG_LEVEL", "info"),

  aiEnabled: envBool("AI_REASONING_ENABLED", false),
  aiApiKey: env("ANTHROPIC_API_KEY", ""),
  aiModel: env("AI_MODEL", "claude-sonnet-4-20250514"),
  aiTimeoutMs: envInt("AI_TIMEOUT_MS", 15_000),
  aiMaxScoreAdjustment: envInt("AI_MAX_SCORE_ADJUSTMENT", 15),
};

// ─── Startup Validation ────────────────────────────────────────────────────────

const VALID_TIMEFRAMES = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

export function validateConfig(): string[] {
  const errors: string[] = [];

  if (config.symbols.length === 0) {
    errors.push("ENGINE_SYMBOLS is empty — no assets to scan");
  }

  if (config.timeframes.length === 0) {
    errors.push("ENGINE_TIMEFRAMES is empty — no timeframes to scan");
  }

  for (const tf of config.timeframes) {
    if (!VALID_TIMEFRAMES.has(tf)) {
      errors.push(`Invalid timeframe: ${tf}. Must be one of: ${[...VALID_TIMEFRAMES].join(", ")}`);
    }
  }

  if (config.minPublishScore < 0 || config.minPublishScore > 100) {
    errors.push(`ENGINE_MIN_PUBLISH_SCORE must be 0–100, got: ${config.minPublishScore}`);
  }

  if (config.minExpectedR < 0) {
    errors.push(`ENGINE_MIN_EXPECTED_R must be >= 0, got: ${config.minExpectedR}`);
  }

  if (config.scanIntervalMs < 10_000) {
    errors.push(`ENGINE_SCAN_INTERVAL_MS must be >= 10000 (10s), got: ${config.scanIntervalMs}`);
  }

  if (!config.dryRun && !config.providerToken) {
    errors.push("AGORAIQ_ENGINE_TOKEN is empty and dryRun is false — publishing will fail");
  }

  return errors;
}

// ─── Symbol Helpers ────────────────────────────────────────────────────────────

/**
 * Converts short symbols (BTC) to exchange trading pairs (BTC/USDT).
 */
export function toExchangePair(symbol: string): string {
  return `${symbol}/USDT`;
}

/**
 * Converts short symbol to the format used in AgoraIQ signals (BTCUSDT).
 */
export function toSignalSymbol(symbol: string): string {
  return `${symbol}USDT`;
}
