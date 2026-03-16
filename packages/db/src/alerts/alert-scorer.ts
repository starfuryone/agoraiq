// ─────────────────────────────────────────────────────────────
// packages/db/src/alerts/alert-scorer.ts
// Smart Alert Score — AI-assisted trading intelligence
//
// Instead of simple binary alerts, produces:
//   Alert Strength: 82%
//   Factors:
//     trend alignment:       0.85
//     whale accumulation:    0.70
//     signal cluster:        0.90
//     liquidation pressure:  0.60
//     provider quality:      0.95
//
// The score is computed from recent event history in Redis,
// aggregating multiple intelligence layers into a single number.
// ─────────────────────────────────────────────────────────────

import { Redis } from 'ioredis';
import type { AlertEvent, AlertCategory } from './event-types';

// ── Score output ──────────────────────────────────────────────

export interface AlertScore {
  strength:   number;           // 0–100 composite score
  priority:   'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  factors:    ScoreFactor[];
  summary:    string;           // human-readable summary line
}

export interface ScoreFactor {
  name:       string;
  score:      number;           // 0.0–1.0
  weight:     number;           // weight in composite
  detail:     string;           // e.g. "3 whale inflows >$10M in 2h"
}

// ── Factor weights ────────────────────────────────────────────

const WEIGHTS = {
  trendAlignment:      0.20,
  whaleActivity:       0.20,
  signalCluster:       0.20,
  liquidationPressure: 0.15,
  providerQuality:     0.15,
  volumeMomentum:      0.10,
};

// ── Recent event window key format ────────────────────────────
// We store recent events in Redis sorted sets keyed by asset
// Score = timestamp, member = JSON event summary

const EVENT_WINDOW_KEY = (asset: string) => `agoraiq:events:${asset}`;
const WINDOW_SECONDS   = 2 * 60 * 60;  // 2-hour lookback

// ── Record an event for scoring context ───────────────────────

export async function recordEventForScoring(
  redis: Redis,
  event: AlertEvent,
): Promise<void> {
  const key  = EVENT_WINDOW_KEY(event.asset);
  const now  = Date.now();
  const summary = JSON.stringify({
    category:  event.category,
    id:        event.id,
    asset:     event.asset,
    timestamp: event.timestamp,
    ...extractScoringFields(event),
  });

  await redis.zadd(key, now, summary);
  // Trim old events outside the window
  await redis.zremrangebyscore(key, 0, now - WINDOW_SECONDS * 1000);
  // Set TTL so Redis cleans up idle assets
  await redis.expire(key, WINDOW_SECONDS + 600);
}

// ── Compute Alert Score ───────────────────────────────────────

export async function computeAlertScore(
  redis: Redis,
  event: AlertEvent,
): Promise<AlertScore> {
  const key       = EVENT_WINDOW_KEY(event.asset);
  const now       = Date.now();
  const windowMs  = WINDOW_SECONDS * 1000;

  // Fetch all recent events for this asset
  const rawEvents = await redis.zrangebyscore(key, now - windowMs, now);
  const recentEvents = rawEvents.map((s: string) => {
    try { return JSON.parse(s); } catch { return null; }
  }).filter(Boolean);

  // Compute each factor
  const factors: ScoreFactor[] = [];

  // 1. Trend Alignment — are market events showing directional momentum?
  const trendFactor = scoreTrendAlignment(recentEvents, event);
  factors.push(trendFactor);

  // 2. Whale Activity — recent whale movements in the same asset
  const whaleFactor = scoreWhaleActivity(recentEvents);
  factors.push(whaleFactor);

  // 3. Signal Cluster — multiple signals firing on same asset
  const clusterFactor = scoreSignalCluster(recentEvents, event);
  factors.push(clusterFactor);

  // 4. Liquidation Pressure — proximity to liquidation clusters
  const liqFactor = scoreLiquidationPressure(recentEvents);
  factors.push(liqFactor);

  // 5. Provider Quality — signal source reliability
  const providerFactor = scoreProviderQuality(event);
  factors.push(providerFactor);

  // 6. Volume Momentum — unusual volume patterns
  const volumeFactor = scoreVolumeMomentum(recentEvents);
  factors.push(volumeFactor);

  // Composite score
  const strength = Math.round(
    factors.reduce((sum, f) => sum + f.score * f.weight, 0) * 100,
  );

  // Derive priority from strength
  const priority = strength >= 85 ? 'CRITICAL'
                 : strength >= 65 ? 'HIGH'
                 : strength >= 40 ? 'MEDIUM'
                 : 'LOW';

  // Summary
  const topFactors = factors
    .filter(f => f.score >= 0.7)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(f => f.name);
  const summary = topFactors.length > 0
    ? `Strong: ${topFactors.join(', ')}`
    : `Alert strength: ${strength}%`;

  return { strength, priority, factors, summary };
}

// ── Factor scoring functions ──────────────────────────────────

function scoreTrendAlignment(events: any[], currentEvent: AlertEvent): ScoreFactor {
  const marketEvents = events.filter(e => e.category === 'MARKET');
  if (marketEvents.length === 0) {
    return { name: 'trend alignment', score: 0.5, weight: WEIGHTS.trendAlignment, detail: 'no market data' };
  }

  // Count positive vs negative price changes
  const positive = marketEvents.filter(e => (e.priceChange ?? 0) > 0).length;
  const negative = marketEvents.filter(e => (e.priceChange ?? 0) < 0).length;

  // If current event is a LONG signal, positive trend is good
  const isLong = currentEvent.category === 'SIGNAL' && currentEvent.direction === 'LONG';
  const isShort = currentEvent.category === 'SIGNAL' && currentEvent.direction === 'SHORT';

  let alignment = 0.5;
  if (isLong && positive > negative)  alignment = Math.min(1, 0.5 + (positive - negative) / marketEvents.length);
  if (isShort && negative > positive) alignment = Math.min(1, 0.5 + (negative - positive) / marketEvents.length);
  if (!isLong && !isShort && marketEvents.length > 2) alignment = 0.6; // some data, neutral

  return {
    name:   'trend alignment',
    score:  alignment,
    weight: WEIGHTS.trendAlignment,
    detail: `${positive} bullish / ${negative} bearish events in window`,
  };
}

function scoreWhaleActivity(events: any[]): ScoreFactor {
  const whales = events.filter(e => e.category === 'WHALE');
  if (whales.length === 0) {
    return { name: 'whale activity', score: 0.3, weight: WEIGHTS.whaleActivity, detail: 'no whale events' };
  }

  const totalUsd    = whales.reduce((s: number, e: any) => s + (e.amountUsd ?? 0), 0);
  const inflows     = whales.filter((e: any) => e.type === 'EXCHANGE_INFLOW').length;
  const outflows    = whales.filter((e: any) => e.type === 'EXCHANGE_OUTFLOW').length;
  const accumulates = whales.filter((e: any) => e.type === 'WALLET_ACCUMULATION').length;

  // Higher score for accumulation + outflows (bullish), lower for inflows (selling pressure)
  let score = Math.min(1, 0.3 + whales.length * 0.1 + accumulates * 0.15 - inflows * 0.05);
  score = Math.max(0, Math.min(1, score));

  const detail = `${whales.length} events, $${(totalUsd / 1e6).toFixed(1)}M total`
    + (inflows > 0 ? `, ${inflows} exchange inflows` : '')
    + (accumulates > 0 ? `, ${accumulates} accumulations` : '');

  return { name: 'whale activity', score, weight: WEIGHTS.whaleActivity, detail };
}

function scoreSignalCluster(events: any[], currentEvent: AlertEvent): ScoreFactor {
  const signals = events.filter(e => e.category === 'SIGNAL');
  if (signals.length === 0) {
    return { name: 'signal cluster', score: 0.3, weight: WEIGHTS.signalCluster, detail: 'single signal' };
  }

  // Multiple signals on same asset = cluster
  const sameDirection = currentEvent.category === 'SIGNAL'
    ? signals.filter((e: any) => e.direction === currentEvent.direction).length
    : signals.length;
  const uniqueProviders = new Set(signals.map((e: any) => e.providerId)).size;
  const avgIq = signals.reduce((s: number, e: any) => s + (e.iqScore ?? 50), 0) / signals.length;

  let score = Math.min(1, 0.3 + sameDirection * 0.15 + uniqueProviders * 0.1 + (avgIq - 50) / 100);
  score = Math.max(0, Math.min(1, score));

  return {
    name:   'signal cluster',
    score,
    weight: WEIGHTS.signalCluster,
    detail: `${signals.length} signals from ${uniqueProviders} providers, avg IQ ${Math.round(avgIq)}`,
  };
}

function scoreLiquidationPressure(events: any[]): ScoreFactor {
  const liqs = events.filter(e => e.category === 'LIQUIDATION');
  if (liqs.length === 0) {
    return { name: 'liquidation pressure', score: 0.5, weight: WEIGHTS.liquidationPressure, detail: 'no liquidation events' };
  }

  const cascades   = liqs.filter((e: any) => e.type === 'LIQUIDATION_CASCADE').length;
  const clusters   = liqs.filter((e: any) => e.type === 'CLUSTER_APPROACHING').length;
  const totalUsd   = liqs.reduce((s: number, e: any) => s + (e.amountUsd ?? 0), 0);
  const avgCascade = liqs.reduce((s: number, e: any) => s + (e.cascadeRisk ?? 0), 0) / liqs.length;

  let score = Math.min(1, 0.3 + cascades * 0.25 + clusters * 0.15 + avgCascade / 200);
  score = Math.max(0, Math.min(1, score));

  return {
    name:   'liquidation pressure',
    score,
    weight: WEIGHTS.liquidationPressure,
    detail: `${liqs.length} events, $${(totalUsd / 1e6).toFixed(1)}M, cascade risk ${Math.round(avgCascade)}%`,
  };
}

function scoreProviderQuality(event: AlertEvent): ScoreFactor {
  if (event.category !== 'SIGNAL') {
    return { name: 'provider quality', score: 0.5, weight: WEIGHTS.providerQuality, detail: 'non-signal event' };
  }

  const iq    = event.iqScore       ?? 50;
  const truth = event.truthPassRate  ?? 50;
  const conf  = event.confidence     ?? 50;
  const risk  = event.cherryPickRisk ?? 'MEDIUM';

  const riskPenalty = risk === 'HIGH' ? 0.2 : risk === 'MEDIUM' ? 0.05 : 0;
  let score = ((iq / 100) * 0.4 + (truth / 100) * 0.35 + (conf / 100) * 0.25) - riskPenalty;
  score = Math.max(0, Math.min(1, score));

  return {
    name:   'provider quality',
    score,
    weight: WEIGHTS.providerQuality,
    detail: `IQ ${iq}, truth ${truth}%, conf ${conf}%, cherry-pick ${risk}`,
  };
}

function scoreVolumeMomentum(events: any[]): ScoreFactor {
  const marketEvents = events.filter(e => e.category === 'MARKET');
  const pumpEvents   = events.filter(e => e.category === 'PUMP');

  if (marketEvents.length === 0 && pumpEvents.length === 0) {
    return { name: 'volume momentum', score: 0.5, weight: WEIGHTS.volumeMomentum, detail: 'no volume data' };
  }

  const avgVolChange = marketEvents.length > 0
    ? marketEvents.reduce((s: number, e: any) => s + (e.volumeChange ?? 0), 0) / marketEvents.length
    : 0;
  const maxVolumeSpike = pumpEvents.length > 0
    ? Math.max(...pumpEvents.map((e: any) => e.volumeSpike ?? 0))
    : 0;

  let score = Math.min(1, 0.3 + (avgVolChange / 500) * 0.3 + Math.min(maxVolumeSpike / 10, 0.4));
  score = Math.max(0, Math.min(1, score));

  return {
    name:   'volume momentum',
    score,
    weight: WEIGHTS.volumeMomentum,
    detail: `avg vol change ${avgVolChange.toFixed(0)}%` + (maxVolumeSpike > 0 ? `, pump ${maxVolumeSpike.toFixed(1)}x` : ''),
  };
}

// ── Helper: extract scoring-relevant fields from any event ────

function extractScoringFields(event: AlertEvent): Record<string, any> {
  switch (event.category) {
    case 'SIGNAL':
      return { direction: event.direction, providerId: event.providerId, iqScore: event.iqScore, confidence: event.confidence };
    case 'MARKET':
      return { type: event.type, priceChange: event.priceChange, volumeChange: event.volumeChange };
    case 'WHALE':
      return { type: event.type, amountUsd: event.amountUsd };
    case 'LIQUIDATION':
      return { type: event.type, amountUsd: event.amountUsd, cascadeRisk: event.cascadeRisk, side: event.side };
    case 'PUMP':
      return { volumeSpike: event.volumeSpike, priceChange: event.priceChange, socialSpike: event.socialSpike };
    default:
      return {};
  }
}
