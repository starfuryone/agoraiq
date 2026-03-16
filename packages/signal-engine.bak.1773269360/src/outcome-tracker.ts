/**
 * @agoraiq/signal-engine v2 — Signal Outcome Tracker
 *
 * Tracks published signals against live price.
 * Resolved outcomes are persisted to SQLite (signal_analysis table)
 * for the learning loop to consume.
 */

import type { FinalSignal, SignalOutcome } from "./types";
import { Direction } from "./types";
import { getLastPrice } from "./services/market-data";
import { updateSignalOutcome } from "./persistence/db";
import { logger } from "./services/logger";

// ─── In-memory signal store ────────────────────────────────────────────────────

interface TrackedSignal {
  signal: FinalSignal;
  outcome: SignalOutcome;
  resolved: boolean;
}

const activeSignals = new Map<string, TrackedSignal>();
const resolvedOutcomes: SignalOutcome[] = [];
const MAX_RESOLVED = 500;

export function trackSignal(signal: FinalSignal): void {
  if (activeSignals.has(signal.signalId)) return;

  activeSignals.set(signal.signalId, {
    signal,
    outcome: {
      signalId: signal.signalId,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      publishedAt: signal.publishedAt,
      entryHitAt: null,
      stopHitAt: null,
      tp1HitAt: null,
      tp2HitAt: null,
      invalidatedAt: null,
      expiredAt: null,
      mfePct: 0,
      maePct: 0,
      durationMinutes: 0,
      outcomeLabel: "EXPIRED",
      realizedR: 0,
    },
    resolved: false,
  });

  logger.debug(`Tracking signal: ${signal.signalId} ${signal.symbol} ${signal.direction}`);
}

export async function updateTrackedSignals(): Promise<void> {
  if (activeSignals.size === 0) return;

  const symbolSignals = new Map<string, TrackedSignal[]>();
  for (const tracked of activeSignals.values()) {
    if (tracked.resolved) continue;
    const sym = tracked.signal.symbol;
    if (!symbolSignals.has(sym)) symbolSignals.set(sym, []);
    symbolSignals.get(sym)!.push(tracked);
  }

  for (const [symbol, signals] of symbolSignals) {
    let price: number;
    try {
      price = await getLastPrice(symbol);
      if (price <= 0) continue;
    } catch {
      continue;
    }

    const now = new Date();

    for (const tracked of signals) {
      const { signal, outcome } = tracked;
      const entryMid = (signal.entryLow + signal.entryHigh) / 2;

      outcome.durationMinutes = Math.floor(
        (now.getTime() - signal.publishedAt.getTime()) / 60_000
      );

      // Check expiry
      if (now > signal.expiresAt && !outcome.entryHitAt) {
        outcome.expiredAt = now;
        outcome.outcomeLabel = "EXPIRED";
        outcome.realizedR = 0;
        resolve(tracked);
        continue;
      }

      if (signal.direction === Direction.LONG) {
        const favMove = (price - entryMid) / entryMid;
        const advMove = (entryMid - price) / entryMid;
        outcome.mfePct = Math.max(outcome.mfePct, favMove);
        outcome.maePct = Math.max(outcome.maePct, advMove);

        if (!outcome.entryHitAt && price >= signal.entryLow && price <= signal.entryHigh) {
          outcome.entryHitAt = now;
        }

        if (outcome.entryHitAt && price <= signal.stopLoss) {
          outcome.stopHitAt = now;
          outcome.outcomeLabel = "LOSS";
          outcome.realizedR = -1;
          resolve(tracked);
          continue;
        }

        if (outcome.entryHitAt && !outcome.tp1HitAt && price >= signal.takeProfit1) {
          outcome.tp1HitAt = now;
        }

        if (outcome.entryHitAt && price >= signal.takeProfit2) {
          outcome.tp2HitAt = now;
          outcome.outcomeLabel = "WIN";
          const risk = Math.abs(entryMid - signal.stopLoss);
          const reward = signal.takeProfit2 - entryMid;
          outcome.realizedR = risk > 0 ? reward / risk : 0;
          resolve(tracked);
          continue;
        }
      } else {
        // SHORT
        const favMove = (entryMid - price) / entryMid;
        const advMove = (price - entryMid) / entryMid;
        outcome.mfePct = Math.max(outcome.mfePct, favMove);
        outcome.maePct = Math.max(outcome.maePct, advMove);

        if (!outcome.entryHitAt && price >= signal.entryLow && price <= signal.entryHigh) {
          outcome.entryHitAt = now;
        }

        if (outcome.entryHitAt && price >= signal.stopLoss) {
          outcome.stopHitAt = now;
          outcome.outcomeLabel = "LOSS";
          outcome.realizedR = -1;
          resolve(tracked);
          continue;
        }

        if (outcome.entryHitAt && !outcome.tp1HitAt && price <= signal.takeProfit1) {
          outcome.tp1HitAt = now;
        }

        if (outcome.entryHitAt && price <= signal.takeProfit2) {
          outcome.tp2HitAt = now;
          outcome.outcomeLabel = "WIN";
          const risk = Math.abs(signal.stopLoss - entryMid);
          const reward = entryMid - signal.takeProfit2;
          outcome.realizedR = risk > 0 ? reward / risk : 0;
          resolve(tracked);
          continue;
        }
      }
    }
  }
}

function resolve(tracked: TrackedSignal): void {
  tracked.resolved = true;
  activeSignals.delete(tracked.signal.signalId);

  resolvedOutcomes.push(tracked.outcome);
  if (resolvedOutcomes.length > MAX_RESOLVED) resolvedOutcomes.shift();

  // Persist to SQLite
  try {
    updateSignalOutcome(tracked.outcome);
  } catch (err) {
    logger.warn("Failed to persist outcome to SQLite", { err });
  }

  const o = tracked.outcome;
  logger.info(
    `Signal resolved: ${tracked.signal.signalId} ${tracked.signal.symbol} → ${o.outcomeLabel} ` +
      `R=${o.realizedR.toFixed(2)} MFE=${(o.mfePct * 100).toFixed(1)}% MAE=${(o.maePct * 100).toFixed(1)}% ` +
      `duration=${o.durationMinutes}min`
  );
}

// ─── Query functions ───────────────────────────────────────────────────────────

export function getActiveSignalCount(): number {
  return activeSignals.size;
}

export function getActiveSymbols(): string[] {
  const symbols = new Set<string>();
  for (const tracked of activeSignals.values()) {
    if (!tracked.resolved) symbols.add(tracked.signal.symbol);
  }
  return [...symbols];
}

export function getResolvedOutcomes(): ReadonlyArray<SignalOutcome> {
  return resolvedOutcomes;
}

export function getRecentStats(lastN = 50): {
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
} {
  const recent = resolvedOutcomes.slice(-lastN);
  if (recent.length === 0) {
    return { count: 0, wins: 0, losses: 0, winRate: 0, avgR: 0 };
  }

  const wins = recent.filter((o) => o.outcomeLabel === "WIN").length;
  const losses = recent.filter((o) => o.outcomeLabel === "LOSS").length;
  const avgR = recent.reduce((s, o) => s + o.realizedR, 0) / recent.length;

  return { count: recent.length, wins, losses, winRate: wins / recent.length, avgR };
}
