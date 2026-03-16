// ============================================================
// AgoraIQ Market Intel — DB Repository
// /db/marketIntelRepository.ts
//
// Wraps all DB operations for the Market Intel module.
// Uses the existing Prisma client. Swap prisma import path
// to match your monorepo (e.g. @agoraiq/db or ../../prisma/client).
// ============================================================

// ── Import Prisma client ──────────────────────────────────────
// INTEGRATION: Change this import to your actual Prisma client location.
// e.g. import { prisma } from '../../lib/prisma.js'
import { db as prisma } from '@agoraiq/db';



import type {
  VolatilitySnapshot,
  VolatilityAlert,
  ArbitrageAlert,
  ScoreResult,
  AlertType,
} from './index.js';

// ── Snapshot ──────────────────────────────────────────────────
export async function saveSnapshot(snap: VolatilitySnapshot): Promise<void> {
  await prisma.marketIntelSnapshot.upsert({
    where: {
      symbol_exchange_createdAt: {
        symbol:    snap.symbol,
        exchange:  snap.exchange,
        createdAt: snap.fetchedAt,
      },
    },
    update: {},  // snapshots are immutable once written
    create: {
      symbol:    snap.symbol,
      exchange:  snap.exchange,
      rawData: {
        volatility24h:    snap.volatility24h,
        volatility30dAvg: snap.volatility30dAvg,
        volume24h:        snap.volume24h,
        volumeAvg:        snap.volumeAvg,
        atr:              snap.atr ?? null,
      },
      normalizedData: {
        volRatio:    snap.volatility30dAvg > 0
          ? snap.volatility24h / snap.volatility30dAvg
          : 1,
        volumeRatio: snap.volumeAvg > 0
          ? snap.volume24h / snap.volumeAvg
          : 1,
      },
      createdAt: snap.fetchedAt,
    },
  });
}

// ── Alerts ────────────────────────────────────────────────────
export async function saveVolatilityAlert(alert: VolatilityAlert): Promise<void> {
  await prisma.marketIntelAlert.create({
    data: {
      type:     'volatility',
      severity: alert.severity,
      symbol:   alert.symbol,
      exchange: alert.exchange,
      message:  alert.message,
      metadata: {
        volatilityRatio: alert.volatilityRatio,
        volumeRatio:     alert.volumeRatio,
        regime:          alert.regime,
      },
      createdAt: alert.triggeredAt,
    },
  });
}

export async function saveArbitrageAlert(alert: ArbitrageAlert): Promise<void> {
  await prisma.marketIntelAlert.create({
    data: {
      type:     'arbitrage',
      severity: alert.severity,
      symbol:   alert.symbol,
      exchange: `${alert.buyExchange}→${alert.sellExchange}`,
      message:  alert.message,
      metadata: {
        buyExchange:       alert.buyExchange,
        sellExchange:      alert.sellExchange,
        buyPrice:          alert.buyPrice,
        sellPrice:         alert.sellPrice,
        spreadPct:         alert.spreadPct,
        profitPotentialPct:alert.profitPotentialPct,
      },
      createdAt: alert.triggeredAt,
    },
  });
}

// ── Scores ────────────────────────────────────────────────────
export async function saveScore(result: ScoreResult): Promise<void> {
  await prisma.marketIntelScore.create({
    data: {
      symbol:        result.symbol,
      side:          result.side,
      score:         result.score,
      probabilityPct:result.probabilityPct,
      confidence:    result.confidence,
      expectedR:     result.expectedR,
      rawInputs:     result.inputs as any,
      createdAt:     result.computedAt,
    },
  });
}

// ── Query: overview (top opportunities) ──────────────────────
export async function getTopScores(limit = 20) {
  // Latest score per symbol, sorted by score desc
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      symbol: string;
      side: string;
      score: number;
      probabilityPct: number;
      confidence: string;
      expectedR: number;
      createdAt: Date;
    }>
  >`
    SELECT DISTINCT ON (symbol)
      id, symbol, side, score, "probabilityPct", confidence, "expectedR", "createdAt"
    FROM market_intel_scores
    ORDER BY symbol, "createdAt" DESC, score DESC
    LIMIT ${limit}
  `;

  return rows.sort((a, b) => b.score - a.score);
}

// ── Query: score history for a symbol ─────────────────────────
export async function getScoreHistory(symbol: string, limit = 50) {
  return prisma.marketIntelScore.findMany({
    where:   { symbol },
    orderBy: { createdAt: 'desc' },
    take:    limit,
  });
}

// ── Query: alerts by type ─────────────────────────────────────
export async function getAlerts(
  type: AlertType | 'all',
  limit = 50,
  since?: Date,
) {
  return prisma.marketIntelAlert.findMany({
    where: {
      ...(type !== 'all' ? { type } : {}),
      ...(since          ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take:    limit,
  });
}

// ── Query: provider win rate (from existing AgoraIQ tables) ───
/**
 * Returns the average win rate (0–100) for the top provider
 * that signals a given symbol. Falls back to 65 if no data.
 *
 * INTEGRATION: Adjust query to match your actual providers/signals schema.
 */
export async function getProviderWinRateForSymbol(symbol: string): Promise<number> {
  try {
    const result = await prisma.$queryRaw<Array<{ win_rate: number }>>`
      SELECT AVG(pss.win_rate) as win_rate
      FROM provider_stats_snapshot pss
      INNER JOIN signals s ON s."providerId" = pss.provider_id
      WHERE s.symbol = ${symbol}
        AND pss.win_rate IS NOT NULL
      LIMIT 1
    `;
    return result[0]?.win_rate ?? 65;
  } catch {
    return 65; // sensible default
  }
}

export default {
  saveSnapshot,
  saveVolatilityAlert,
  saveArbitrageAlert,
  saveScore,
  getTopScores,
  getScoreHistory,
  getAlerts,
  getProviderWinRateForSymbol,
};
