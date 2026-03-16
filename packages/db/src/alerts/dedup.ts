// ─────────────────────────────────────────────────────────────
// packages/db/src/alerts/dedup.ts
// Alert deduplication beyond simple throttle
//
// Three layers:
//   1. Event-level:  BullMQ jobId prevents same event processed twice
//   2. Content-hash: same alert substance (asset+direction+type) within
//                    a cooldown window per user → suppressed
//   3. Rate limit:   max N alerts per user per hour regardless of rule
// ─────────────────────────────────────────────────────────────

import { Redis } from 'ioredis';
import type { AlertEvent } from './event-types';
import type { AlertPriority } from './event-types';

export interface DedupConfig {
  cooldownSeconds:   number;  // per content-hash cooldown (default: 600 = 10min)
  maxPerHour:        number;  // max alerts per user per hour (default: 30)
  criticalBypass:    boolean; // CRITICAL priority bypasses dedup (default: true)
}

const DEFAULT_CONFIG: DedupConfig = {
  cooldownSeconds: 600,
  maxPerHour:      30,
  criticalBypass:  true,
};

// ── Check if an alert should be suppressed ────────────────────

export interface DedupResult {
  suppressed: boolean;
  reason?:    'content_duplicate' | 'rate_limited' | 'throttled';
  detail?:    string;
}

export async function checkDedup(
  redis:    Redis,
  userId:   string,
  ruleId:   string,
  event:    AlertEvent,
  priority: AlertPriority,
  config:   DedupConfig = DEFAULT_CONFIG,
): Promise<DedupResult> {

  // CRITICAL events bypass dedup if configured
  if (config.criticalBypass && priority === 'CRITICAL') {
    return { suppressed: false };
  }

  // Layer 1: Content-hash cooldown
  const contentKey = buildContentKey(userId, ruleId, event);
  const exists = await redis.exists(contentKey);
  if (exists) {
    const ttl = await redis.ttl(contentKey);
    return {
      suppressed: true,
      reason:     'content_duplicate',
      detail:     `same alert fired ${config.cooldownSeconds - ttl}s ago, cooldown ${ttl}s remaining`,
    };
  }

  // Layer 2: Rate limit per user
  const rateLimitKey = `agoraiq:dedup:rate:${userId}`;
  const currentCount = await redis.get(rateLimitKey);
  if (currentCount && parseInt(currentCount) >= config.maxPerHour) {
    return {
      suppressed: true,
      reason:     'rate_limited',
      detail:     `${currentCount}/${config.maxPerHour} alerts this hour`,
    };
  }

  return { suppressed: false };
}

// ── Record that an alert was sent (call after delivery) ───────

export async function recordAlertSent(
  redis:    Redis,
  userId:   string,
  ruleId:   string,
  event:    AlertEvent,
  config:   DedupConfig = DEFAULT_CONFIG,
): Promise<void> {
  // Set content-hash key with cooldown TTL
  const contentKey = buildContentKey(userId, ruleId, event);
  await redis.setex(contentKey, config.cooldownSeconds, '1');

  // Increment rate limit counter
  const rateLimitKey = `agoraiq:dedup:rate:${userId}`;
  const count = await redis.incr(rateLimitKey);
  if (count === 1) {
    // First alert this hour — set 1h expiry
    await redis.expire(rateLimitKey, 3600);
  }
}

// ── Content key builder ───────────────────────────────────────
// Groups similar alerts together for dedup purposes

function buildContentKey(userId: string, ruleId: string, event: AlertEvent): string {
  const parts = ['agoraiq:dedup:content', userId, ruleId, event.category, event.asset];

  switch (event.category) {
    case 'SIGNAL':
      parts.push(event.direction);
      break;
    case 'MARKET':
      parts.push(event.type);
      break;
    case 'WHALE':
      parts.push(event.type);
      break;
    case 'LIQUIDATION':
      parts.push(event.type, event.side);
      break;
    case 'PUMP':
      parts.push(event.detectionWindow);
      break;
  }

  return parts.join(':');
}

// ── User-configurable cooldown override ───────────────────────
// Allows per-rule cooldown that overrides the global default

export function mergeRuleCooldown(
  globalConfig: DedupConfig,
  ruleThrottleMin: number,
): DedupConfig {
  return {
    ...globalConfig,
    cooldownSeconds: Math.max(globalConfig.cooldownSeconds, ruleThrottleMin * 60),
  };
}
