// ─────────────────────────────────────────────────────────────
// packages/db/src/alerts/priority.ts
// Alert priority classification and routing
// ─────────────────────────────────────────────────────────────

import type { AlertEvent, AlertPriority } from './event-types';

// ── Classify an event's priority ──────────────────────────────

export function classifyPriority(event: AlertEvent): AlertPriority {
  switch (event.category) {
    case 'LIQUIDATION':
      if (event.type === 'LIQUIDATION_CASCADE')                 return 'CRITICAL';
      if (event.amountUsd > 50_000_000)                         return 'CRITICAL';
      if (event.type === 'CLUSTER_APPROACHING')                 return 'HIGH';
      if (event.amountUsd > 10_000_000)                         return 'HIGH';
      return 'MEDIUM';

    case 'WHALE':
      if (event.amountUsd > 100_000_000)                        return 'CRITICAL';
      if (event.amountUsd > 50_000_000)                         return 'HIGH';
      if (event.type === 'EXCHANGE_INFLOW' && event.amountUsd > 10_000_000) return 'HIGH';
      return 'MEDIUM';

    case 'PUMP':
      if (event.volumeSpike > 10 && event.priceChange > 15)     return 'CRITICAL';
      if (event.volumeSpike > 5)                                return 'HIGH';
      return 'MEDIUM';

    case 'MARKET':
      if (event.type === 'VOLATILITY_SPIKE' && Math.abs(event.priceChange) > 10) return 'HIGH';
      if (event.type === 'VOLUME_ANOMALY' && event.volumeChange > 500)           return 'HIGH';
      if (event.type === 'FUNDING_RATE_EXTREME')                return 'MEDIUM';
      return 'LOW';

    case 'SIGNAL':
      if ((event.iqScore ?? 0) >= 90 && (event.confidence ?? 0) >= 85) return 'HIGH';
      if ((event.iqScore ?? 0) >= 75)                           return 'MEDIUM';
      return 'LOW';

    default:
      return 'LOW';
  }
}

// ── Priority routing rules ────────────────────────────────────
// Determines which channels to force-enable or throttle override based on priority

export interface PriorityRouting {
  forceChannels:     string[];    // always deliver through these channels
  throttleOverride:  boolean;     // bypass throttle?
  maxDelayMs:        number;      // max acceptable delivery delay
  sound:             boolean;     // push notification with sound?
}

const ROUTING: Record<AlertPriority, PriorityRouting> = {
  CRITICAL: {
    forceChannels:    ['web', 'telegram', 'webpush'],
    throttleOverride: true,
    maxDelayMs:       0,
    sound:            true,
  },
  HIGH: {
    forceChannels:    ['web'],
    throttleOverride: false,
    maxDelayMs:       5_000,
    sound:            true,
  },
  MEDIUM: {
    forceChannels:    [],
    throttleOverride: false,
    maxDelayMs:       30_000,
    sound:            false,
  },
  LOW: {
    forceChannels:    [],
    throttleOverride: false,
    maxDelayMs:       60_000,
    sound:            false,
  },
};

export function getPriorityRouting(priority: AlertPriority): PriorityRouting {
  return ROUTING[priority];
}

// ── Priority numeric rank (for sorting/filtering) ─────────────

const PRIORITY_RANK: Record<AlertPriority, number> = {
  CRITICAL: 4,
  HIGH:     3,
  MEDIUM:   2,
  LOW:      1,
};

export function priorityRank(p: AlertPriority): number {
  return PRIORITY_RANK[p] ?? 0;
}
