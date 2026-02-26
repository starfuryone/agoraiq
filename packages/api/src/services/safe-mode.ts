// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Safe Mode Service
//
// Centralized public-mode filtering. Every proof endpoint MUST
// pass data through these functions before responding.
//
// Rules enforced:
//   1. Delay: active trades delayed by PROOF_ACTIVE_DELAY_MINUTES
//   2. Redaction: no prices, no TP/SL, no raw payload, no provider IDs
//   3. Masking: top 3 providers by rank revealed; rest = "Provider D/E/F…"
//   4. Caps: max items, max months, max days of stats
//   5. Never return: providerId, providerKey, rawPayload, entryPrice,
//      exitPrice, tpPrice, slPrice, notes, userId, telegramId
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '@agoraiq/db';

const log = createLogger('safe-mode');

// ── Configuration ─────────────────────────────────────────────

export const SAFE_MODE_CONFIG = {
  activeDelayMinutes: parseInt(process.env.PROOF_ACTIVE_DELAY_MINUTES || '15', 10),
  maxFeedItems: parseInt(process.env.PROOF_MAX_FEED_ITEMS || '25', 10),
  maxMonths: parseInt(process.env.PROOF_MAX_MONTHS || '12', 10),
  maxStatsDays: 30,
  maxRevealedProviders: 3,
  cacheTtlMs: 60_000,
};

// ── Types ─────────────────────────────────────────────────────

interface RawFeedItem {
  id: string;
  symbol: string;
  timeframe: string;
  direction: string;
  status: string;
  entryPrice?: number | null;
  exitPrice?: number | null;
  tpPrice?: number | null;
  slPrice?: number | null;
  rMultiple?: number | null;
  pnlPct?: number | null;
  providerId: string;
  providerSlug?: string;
  providerName?: string;
  createdAt: Date | string;
  exitedAt?: Date | string | null;
  notes?: string | null;
  [key: string]: any;
}

interface SafeFeedItem {
  id: string;
  symbol: string;
  timeframe: string;
  direction: string;
  status: string;
  rMultiple: number | null;
  pnlPct: number | null;
  provider: string;         // masked name
  // Partial ITB data (public-safe)
  strength: { label: string; indicator: string } | null;
  source: string | null;
  createdAt: string;
  exitedAt: string | null;
}

interface ProviderRanking {
  providerId: string;
  slug: string;
  name: string;
  rank: number;
  [key: string]: any;
}

interface SafeProviderRanking {
  rank: number;
  name: string;
  [key: string]: any;
}

// ── Redaction: Strip all sensitive fields ──────────────────────

const FORBIDDEN_FIELDS = new Set([
  'providerId',
  'providerKey',
  'providerSlug',
  'rawPayload',
  'entryPrice',
  'exitPrice',
  'tpPrice',
  'slPrice',
  'tpPct',
  'slPct',
  'notes',
  'userId',
  'telegramId',
  'chatId',
  'workspaceId',
  'signalId',
  'meta',
  'config',
  'passwordHash',
  'price',
]);

export function redactObject<T extends Record<string, any>>(obj: T): Partial<T> {
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (FORBIDDEN_FIELDS.has(key)) continue;
    clean[key] = value;
  }
  return clean as Partial<T>;
}

// ── Delay: Filter active trades that are too recent ───────────

export function filterByDelay<T extends { status: string; createdAt: Date | string }>(
  items: T[],
): T[] {
  const cutoff = new Date(
    Date.now() - SAFE_MODE_CONFIG.activeDelayMinutes * 60_000,
  );

  return items.filter((item) => {
    if (item.status === 'ACTIVE') {
      const created = new Date(item.createdAt);
      // Only show active trades older than delay threshold
      return created < cutoff;
    }
    // Closed trades: show immediately
    return true;
  });
}

// ── Masking: Provider name masking ────────────────────────────

const MASK_LABELS = ['Provider D', 'Provider E', 'Provider F', 'Provider G',
  'Provider H', 'Provider I', 'Provider J', 'Provider K'];

/**
 * Given a ranked list of providers, returns a map from providerId to display name.
 * Top N providers keep their real name; rest are masked.
 */
export function buildProviderMask(
  rankings: ProviderRanking[],
): Map<string, string> {
  const mask = new Map<string, string>();
  const sorted = [...rankings].sort((a, b) => a.rank - b.rank);

  let maskIdx = 0;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (i < SAFE_MODE_CONFIG.maxRevealedProviders) {
      mask.set(p.providerId, p.name);
    } else {
      mask.set(p.providerId, MASK_LABELS[maskIdx % MASK_LABELS.length]);
      maskIdx++;
    }
  }

  return mask;
}

// ── Apply Safe Mode to Feed Items ─────────────────────────────

export function safeModeFeed(
  items: RawFeedItem[],
  providerMask: Map<string, string>,
): SafeFeedItem[] {
  // 1. Apply delay filter
  const delayed = filterByDelay(items);

  // 2. Cap items
  const capped = delayed.slice(0, SAFE_MODE_CONFIG.maxFeedItems);

  // 3. Redact + mask
  return capped.map((item) => {
    // Extract partial ITB metadata (safe for public)
    const meta = (item as any).meta;
    const itbMeta = meta && typeof meta === 'object' ? meta as Record<string, any> : null;

    // Public proof shows: signal strength label + band emoji only
    // NEVER: exact trade_score, prices, secondary_score, OHLC, profit
    const strength = itbMeta?.band_text
      ? { label: itbMeta.band_text, indicator: itbMeta.band_sign || '' }
      : null;

    return {
      id: item.id,
      symbol: item.symbol,
      timeframe: item.timeframe,
      direction: item.direction,
      status: item.status,
      // Only show R-multiple and P&L for closed trades
      rMultiple: item.status !== 'ACTIVE' ? (item.rMultiple ?? null) : null,
      pnlPct: item.status !== 'ACTIVE' ? (item.pnlPct ?? null) : null,
      provider: providerMask.get(item.providerId) || 'Unknown Provider',
      // Partial ITB data: strength label only (no score, no price)
      strength,
      source: itbMeta?.source || null,
      createdAt: new Date(item.createdAt).toISOString(),
      exitedAt: item.exitedAt ? new Date(item.exitedAt).toISOString() : null,
    };
  });
}

// ── Apply Safe Mode to Provider Rankings ──────────────────────

export function safeModeProviders(
  rankings: ProviderRanking[],
): SafeProviderRanking[] {
  const mask = buildProviderMask(rankings);

  return rankings.map((p) => {
    const safe: SafeProviderRanking = {
      rank: p.rank,
      name: mask.get(p.providerId) || 'Unknown Provider',
    };
    // Copy safe numeric stats
    if (p.winRate !== undefined) (safe as any).winRate = p.winRate;
    if (p.avgRR !== undefined) (safe as any).avgRR = p.avgRR;
    if (p.totalTrades !== undefined) (safe as any).totalTrades = p.totalTrades;
    return safe;
  });
}

// ── Validate Safe Mode Response ───────────────────────────────
// Defense-in-depth: scan response JSON for any leaked forbidden fields

export function assertSafe(data: any): void {
  const json = JSON.stringify(data);
  for (const field of FORBIDDEN_FIELDS) {
    // Check for key presence in serialized JSON (fast sanity check)
    if (json.includes(`"${field}":`)) {
      log.error({ field }, 'SAFE MODE VIOLATION: forbidden field in public response');
      throw new Error(`Safe mode violation: "${field}" leaked in public response`);
    }
  }
}

// ── Middleware: Attach safe-mode flag to request ───────────────

export function isSafeMode(query: Record<string, any>): boolean {
  return query.public === '1' || query.public === 'true';
}
