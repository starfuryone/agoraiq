/**
 * @agoraiq/signal-engine — News Service (CryptoPanic)
 *
 * Fetches recent news via CryptoPanic free tier and scores it.
 * CryptoPanic provides: title, votes (positive/negative/important/toxic),
 * source, kind (news/media), and currency filter.
 *
 * Scoring:
 *   eventScore: -1 to +1 based on vote ratio and article volume
 *   sourceCredibilityScore: 0 to 1 based on source reputation
 *
 * Caching: 5-minute TTL per symbol to respect rate limits (5 req/min free tier).
 * Fallback: Returns neutral if API key missing, rate limited, or network error.
 */

import axios from "axios";
import { config } from "../config";
import { logger } from "./logger";

export interface NewsContext {
  eventScore: number;
  sourceCredibilityScore: number;
}

// ─── Source Credibility ────────────────────────────────────────────────────────

const SOURCE_CREDIBILITY: Record<string, number> = {
  "coindesk": 0.9,
  "cointelegraph": 0.85,
  "theblock": 0.9,
  "decrypt": 0.8,
  "bloomberg": 0.95,
  "reuters": 0.95,
  "wsj": 0.95,
  "cnbc": 0.8,
  "coinpost": 0.7,
  "u.today": 0.6,
  "bitcoinist": 0.6,
  "newsbtc": 0.55,
  "ambcrypto": 0.55,
  "beincrypto": 0.6,
};

function getSourceCredibility(sourceDomain: string): number {
  const normalized = sourceDomain.toLowerCase().replace(/\.(com|io|co|org)$/g, "").replace(/www\./, "");
  return SOURCE_CREDIBILITY[normalized] ?? 0.5;
}

// ─── Cache ─────────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: NewsContext;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached(symbol: string): NewsContext | null {
  const entry = cache.get(symbol);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(symbol);
    return null;
  }
  return entry.data;
}

function setCache(symbol: string, data: NewsContext): void {
  cache.set(symbol, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Symbol mapping ────────────────────────────────────────────────────────────

const CRYPTO_PANIC_CURRENCIES: Record<string, string> = {
  BTC: "BTC",
  ETH: "ETH",
  SOL: "SOL",
  XRP: "XRP",
};

// ─── Main fetch ────────────────────────────────────────────────────────────────

const NEUTRAL: NewsContext = { eventScore: 0, sourceCredibilityScore: 0.5 };

/**
 * Get recent news context for an asset.
 * Uses CryptoPanic API in live mode, stubs in stub mode.
 */
export async function getRecentAssetNews(
  symbol: string,
  _lastHours = 6
): Promise<NewsContext> {
  if (config.newsMode === "stub" || !config.cryptoPanicApiKey) {
    logger.debug(`News service in ${config.cryptoPanicApiKey ? "stub" : "no-key"} mode for ${symbol}`);
    return NEUTRAL;
  }

  // Check cache
  const cached = getCached(symbol);
  if (cached) return cached;

  const currency = CRYPTO_PANIC_CURRENCIES[symbol.toUpperCase()];
  if (!currency) {
    logger.debug(`No CryptoPanic currency mapping for ${symbol}`);
    return NEUTRAL;
  }

  try {
    const res = await axios.get("https://cryptopanic.com/api/v1/posts/", {
      params: {
        auth_token: config.cryptoPanicApiKey,
        currencies: currency,
        kind: "news",
        filter: "important",
        public: "true",
      },
      timeout: 5000,
    });

    const posts: any[] = res.data?.results ?? [];
    if (posts.length === 0) {
      setCache(symbol, NEUTRAL);
      return NEUTRAL;
    }

    // Score based on vote sentiment across recent posts
    let totalPositive = 0;
    let totalNegative = 0;
    let totalImportant = 0;
    let credibilitySum = 0;
    let postCount = 0;

    for (const post of posts.slice(0, 15)) {
      const votes = post.votes ?? {};
      totalPositive += (votes.positive ?? 0);
      totalNegative += (votes.negative ?? 0);
      totalImportant += (votes.important ?? 0);

      // Extract source domain
      const sourceUrl = post.source?.domain ?? "";
      credibilitySum += getSourceCredibility(sourceUrl);
      postCount++;
    }

    // Event score: ratio of positive to negative votes, weighted by importance
    const totalVotes = totalPositive + totalNegative;
    let eventScore = 0;

    if (totalVotes > 0) {
      const sentimentRatio = (totalPositive - totalNegative) / totalVotes;
      // Scale by importance (more important articles = stronger signal)
      const importanceWeight = Math.min(totalImportant / Math.max(postCount, 1), 1);
      eventScore = sentimentRatio * (0.5 + 0.5 * importanceWeight);
    }

    // Clamp to [-1, 1]
    eventScore = Math.max(-1, Math.min(1, eventScore));

    const sourceCredibilityScore = postCount > 0 ? credibilitySum / postCount : 0.5;

    const result: NewsContext = {
      eventScore,
      sourceCredibilityScore: Math.max(0, Math.min(1, sourceCredibilityScore)),
    };

    logger.debug(
      `News ${symbol}: ${postCount} posts, event=${eventScore.toFixed(2)}, ` +
        `credibility=${sourceCredibilityScore.toFixed(2)}, ` +
        `votes=+${totalPositive}/-${totalNegative}/!${totalImportant}`
    );

    setCache(symbol, result);
    return result;
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 429) {
      logger.warn("CryptoPanic rate limited — using neutral");
    } else {
      logger.warn(`News fetch failed for ${symbol}: ${err.message ?? err}`);
    }
    return NEUTRAL;
  }
}
