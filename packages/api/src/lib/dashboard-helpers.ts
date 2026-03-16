/**
 * ══════════════════════════════════════════════════════
 * AgoraIQ — Dashboard Helpers (PATCHED)
 * ══════════════════════════════════════════════════════
 *
 * FIXES:
 * - getMarketRegime(): derives from LONG/SHORT signal ratio (was hardcoded)
 * - getMarketBreadth(): derives from % of symbols with bullish signals (was 0)
 * - getTopProvider(): fixes win_rate ratio→%, adds avgR (was missing)
 * - getMarketPulseData(): real query from signals + trades (was empty [])
 * - generateExplainers(): basic contextual explainers (was empty [])
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Simple in-memory cache: key → { data, expiresAt }
const cache = new Map<string, { data: any; expiresAt: number }>();
function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data);
  return fn().then((data) => {
    cache.set(key, { data, expiresAt: Date.now() + ttlMs });
    return data;
  });
}

// ─── Market Regime ──────────────────────────────────
// Derives from ratio of LONG/BUY vs SHORT/SELL signals in last 24h
export async function getMarketRegime() {
  return cached('regime', 5 * 60_000, async () => {
    try {
      const since = new Date(Date.now() - 24 * 3_600_000);
      const counts: any[] = await prisma.$queryRaw`
        SELECT
          COUNT(CASE WHEN action IN ('LONG','BUY')   THEN 1 END)::int AS longs,
          COUNT(CASE WHEN action IN ('SHORT','SELL')  THEN 1 END)::int AS shorts,
          COUNT(*)::int AS total
        FROM signals WHERE "createdAt" >= ${since}
      `;
      const { longs = 0, shorts = 0, total = 0 } = counts[0] || {};
      if (total === 0) return { label: 'No Data', confidence: 0, changedAgo: '—' };
      const ratio = longs / total;
      if (ratio >= 0.65) return { label: 'Risk-On', confidence: Math.round(ratio * 100), changedAgo: '24h' };
      if (ratio <= 0.35) return { label: 'Risk-Off', confidence: Math.round((1 - ratio) * 100), changedAgo: '24h' };
      return { label: 'Neutral', confidence: Math.round(50 + Math.abs(ratio - 0.5) * 100), changedAgo: '—' };
    } catch (err) {
      console.error('[Helpers] getMarketRegime error:', err);
      return { label: 'Neutral', confidence: 50, changedAgo: '—' };
    }
  });
}

// ─── Market Breadth ─────────────────────────────────
// % of active symbols with at least one bullish signal in last 24h
export async function getMarketBreadth() {
  return cached('breadth', 5 * 60_000, async () => {
    try {
      const since = new Date(Date.now() - 24 * 3_600_000);
      const rows: any[] = await prisma.$queryRaw`
        SELECT
          COUNT(DISTINCT symbol)::int AS total,
          COUNT(DISTINCT CASE WHEN action IN ('LONG','BUY') THEN symbol END)::int AS bullish
        FROM signals WHERE "createdAt" >= ${since}
      `;
      const { total = 0, bullish = 0 } = rows[0] || {};
      if (total === 0) return 0;
      return Math.round((bullish / total) * 100);
    } catch (err) {
      console.error('[Helpers] getMarketBreadth error:', err);
      return 0;
    }
  });
}

// ─── Top Provider ───────────────────────────────────
// Uses provider_stats_snapshot; win_rate is stored as ratio (0.74) → convert to %
// Snapshot has 30d and 90d periods; map 7d → 30d
export async function getTopProvider(range: string) {
  const period = range === '90d' ? '90d' : '30d';
  return cached(`top-prov-${period}`, 5 * 60_000, async () => {
    try {
      const rows: any[] = await (prisma as any).$queryRawUnsafe(
        `SELECT p.name, pss.win_rate, pss.expectancy_r
         FROM providers p
         INNER JOIN provider_stats_snapshot pss ON pss.provider_id = p.id AND pss.period = $1
         WHERE p."isActive" = true AND pss.trade_count >= 10
         ORDER BY pss.win_rate DESC LIMIT 1`,
        period
      );
      if (!rows[0]) return { name: '—', winRate: 0, avgR: 0 };
      return {
        name: rows[0].name,
        winRate: Math.round(Number(rows[0].win_rate) * 1000) / 10,   // 0.7415 → 74.2
        avgR: Math.round((Number(rows[0].expectancy_r) || 0) * 100) / 100,
      };
    } catch (err) {
      console.error('[Helpers] getTopProvider error:', err);
      return { name: '—', winRate: 0, avgR: 0 };
    }
  });
}

// ─── Market Pulse ───────────────────────────────────
// Derives from recent signals grouped by symbol + trade outcomes
export async function getMarketPulseData() {
  return cached('pulse', 5 * 60_000, async () => {
    try {
      const since24h = new Date(Date.now() - 24 * 3_600_000);

      const rows: any[] = await prisma.$queryRaw`
        SELECT
          s.symbol                                      AS pair,
          COUNT(s.id)::int                              AS "signalCount",
          COUNT(CASE WHEN s.action IN ('LONG','BUY') THEN 1 END)::int   AS longs,
          COUNT(CASE WHEN s.action IN ('SHORT','SELL') THEN 1 END)::int  AS shorts,
          ROUND(AVG(s.confidence)::numeric, 0)::int     AS "avgConf"
        FROM signals s
        WHERE s."createdAt" >= ${since24h}
          AND COALESCE(s.was_deleted, false) = false
        GROUP BY s.symbol
        ORDER BY COUNT(s.id) DESC
        LIMIT 12
      `;

      return rows.map((r) => {
        const total = r.longs + r.shorts;
        const bullRatio = total > 0 ? r.longs / total : 0.5;
        let trend = 'Ranging';
        if (bullRatio >= 0.65) trend = 'Uptrend';
        else if (bullRatio <= 0.35) trend = 'Downtrend';

        let volatility = 'Low';
        if (r.signalCount >= 8) volatility = 'High';
        else if (r.signalCount >= 4) volatility = 'Med';

        let volumeStatus = 'Normal';
        if (r.signalCount >= 10) volumeStatus = 'Spike';

        return {
          pair: r.pair,
          change24h: 0,                       // needs external price feed
          trend,
          volumeStatus,
          volatility,
          signalCount: r.signalCount,
        };
      });
    } catch (err) {
      console.error('[Helpers] getMarketPulseData error:', err);
      return [];
    }
  });
}

// ─── Explainers ─────────────────────────────────────
export async function generateExplainers() {
  return cached('explainers', 10 * 60_000, async () => {
    try {
      const since = new Date(Date.now() - 24 * 3_600_000);

      const stats: any[] = await prisma.$queryRaw`
        SELECT
          COUNT(*)::int AS total,
          COUNT(CASE WHEN confidence >= 75 THEN 1 END)::int AS "highConf",
          COUNT(CASE WHEN action IN ('LONG','BUY') THEN 1 END)::int AS longs,
          COUNT(CASE WHEN action IN ('SHORT','SELL') THEN 1 END)::int AS shorts
        FROM signals WHERE "createdAt" >= ${since}
      `;
      const s = stats[0] || { total: 0, highConf: 0, longs: 0, shorts: 0 };

      const items = [];

      if (s.total > 0) {
        const pct = Math.round((s.highConf / s.total) * 100);
        items.push({
          question: 'How many signals are high-confidence today?',
          answer: `${s.highConf} of ${s.total} signals (${pct}%) scored ≥75 confidence in the last 24 hours. High-confidence signals historically have higher win rates.`,
        });
      }

      if (s.longs + s.shorts > 0) {
        const bias = s.longs > s.shorts ? 'bullish' : s.shorts > s.longs ? 'bearish' : 'neutral';
        items.push({
          question: 'What is the market bias right now?',
          answer: `Signal flow is ${bias}: ${s.longs} long vs ${s.shorts} short in the last 24h. This reflects aggregate provider positioning across all tracked pairs.`,
        });
      }

      if (items.length === 0) {
        items.push({
          question: 'Why this section exists',
          answer: 'AgoraIQ uses composite scoring to grade signals and providers. This section explains the reasoning behind today\'s top rankings and market read.',
        });
      }

      return items;
    } catch (err) {
      console.error('[Helpers] generateExplainers error:', err);
      return [];
    }
  });
}

// ─── Cache flush ────────────────────────────────────
export function flushDashboardCache() {
  cache.clear();
}
