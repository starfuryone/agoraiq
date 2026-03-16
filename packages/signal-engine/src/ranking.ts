/**
 * @agoraiq/signal-engine — Ranking Engine
 *
 * Sorts candidates by quality, resolves directional conflicts,
 * enforces per-symbol cooldowns, and checks against active signals
 * to prevent duplicate exposure.
 *
 * CHANGES FROM V1:
 * - Cooldown: no signal for the same symbol+direction within N minutes
 * - Active signal awareness: suppresses new signals if one is already
 *   being tracked for the same symbol
 * - Directional conflict resolution: when LONG and SHORT candidates
 *   exist for the same snapshot, only the stronger one survives
 *   (previously both were ranked and the weaker one just lost)
 * - Minimum score gap: if top two candidates are within 3 points,
 *   neither has strong enough conviction — suppressed
 */

import type { StrategySignalCandidate } from "./types";
import { Direction } from "./types";
import { logger } from "./services/logger";

// ─── Cooldown Tracking ─────────────────────────────────────────────────────────

interface CooldownEntry {
  symbol: string;
  direction: Direction;
  timestamp: number;
}

const recentPublishes: CooldownEntry[] = [];
const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes between same symbol+direction

export function recordPublish(symbol: string, direction: Direction): void {
  recentPublishes.push({ symbol, direction, timestamp: Date.now() });
  // Prune old entries
  const cutoff = Date.now() - COOLDOWN_MS;
  while (recentPublishes.length > 0 && recentPublishes[0].timestamp < cutoff) {
    recentPublishes.shift();
  }
}

function isOnCooldown(symbol: string, direction: Direction): boolean {
  const cutoff = Date.now() - COOLDOWN_MS;
  return recentPublishes.some(
    (e) => e.symbol === symbol && e.direction === direction && e.timestamp > cutoff
  );
}

// ─── Active Signal Tracking ────────────────────────────────────────────────────
// Populated by the main loop from outcome-tracker's active signals.

const activeSymbols = new Set<string>();

export function setActiveSymbols(symbols: string[]): void {
  activeSymbols.clear();
  for (const s of symbols) activeSymbols.add(s);
}

// ─── Ranking ───────────────────────────────────────────────────────────────────

/**
 * Sort candidates in descending quality order.
 * Multi-key: finalScore → expectedR → newsScore → marketStructureScore
 */
export function rankCandidates(
  candidates: StrategySignalCandidate[]
): StrategySignalCandidate[] {
  if (candidates.length === 0) return [];

  // ─── Resolve directional conflicts ─────────────────────────────────────────
  // If both LONG and SHORT candidates exist, keep only the direction
  // with the higher best score. Mixed signals = low conviction.
  const longs = candidates.filter((c) => c.direction === Direction.LONG);
  const shorts = candidates.filter((c) => c.direction === Direction.SHORT);

  let filtered = candidates;

  if (longs.length > 0 && shorts.length > 0) {
    const longBest = Math.max(...longs.map((c) => c.finalScore));
    const shortBest = Math.max(...shorts.map((c) => c.finalScore));

    const gap = Math.abs(longBest - shortBest);

    if (gap < 5) {
      // Both directions close in score — no conviction. Suppress all.
      logger.info(
        `${candidates[0].symbol} ${candidates[0].timeframe}: directional conflict with <5pt gap ` +
          `(LONG=${longBest.toFixed(1)} vs SHORT=${shortBest.toFixed(1)}) — suppressing all`
      );
      return [];
    }

    if (longBest > shortBest) {
      filtered = longs;
      logger.debug(
        `${candidates[0].symbol}: resolved conflict → LONG (${longBest.toFixed(1)} vs ${shortBest.toFixed(1)})`
      );
    } else {
      filtered = shorts;
      logger.debug(
        `${candidates[0].symbol}: resolved conflict → SHORT (${shortBest.toFixed(1)} vs ${longBest.toFixed(1)})`
      );
    }
  }

  // ─── Sort descending ───────────────────────────────────────────────────────
  return [...filtered].sort((a, b) => {
    const scoreDiff = b.finalScore - a.finalScore;
    if (Math.abs(scoreDiff) > 0.01) return scoreDiff;

    const rDiff = b.expectedR - a.expectedR;
    if (Math.abs(rDiff) > 0.01) return rDiff;

    const newsDiff = b.newsScore - a.newsScore;
    if (Math.abs(newsDiff) > 0.01) return newsDiff;

    return b.marketStructureScore - a.marketStructureScore;
  });
}

/**
 * Select the single best candidate from a ranked list.
 *
 * Applies post-ranking filters:
 * - Cooldown check (same symbol+direction within 30min)
 * - Active signal check (already tracking a signal for this symbol)
 * - Minimum score gap (top candidate must be 3+ points above runner-up)
 *
 * Returns null if no candidate passes all filters.
 */
export function selectBestCandidate(
  ranked: StrategySignalCandidate[]
): StrategySignalCandidate | null {
  if (ranked.length === 0) return null;

  const best = ranked[0];

  // Cooldown: don't repeat the same symbol+direction too quickly
  if (isOnCooldown(best.symbol, best.direction)) {
    logger.debug(
      `${best.symbol} ${best.direction}: on cooldown (${COOLDOWN_MS / 60_000}min) — skipping`
    );
    return null;
  }

  // Active signal: don't stack signals for the same symbol
  if (activeSymbols.has(best.symbol)) {
    logger.debug(
      `${best.symbol}: already has an active tracked signal — skipping`
    );
    return null;
  }

  // Conviction check: if there's a runner-up within 3 points, conviction is low
  if (ranked.length > 1) {
    const gap = best.finalScore - ranked[1].finalScore;
    if (gap < 3 && ranked[1].direction !== best.direction) {
      logger.debug(
        `${best.symbol}: top candidates too close (gap=${gap.toFixed(1)}) with different directions — skipping`
      );
      return null;
    }
  }

  if (ranked.length > 1) {
    logger.debug(
      `Selected ${best.strategyType} ${best.direction} ` +
        `(score=${best.finalScore.toFixed(1)}) over ${ranked.length - 1} other candidate(s)`
    );
  }

  return best;
}
