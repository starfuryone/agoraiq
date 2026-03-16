// ─────────────────────────────────────────────────────────────
// packages/db/src/alerts/index.ts — barrel exports
// ─────────────────────────────────────────────────────────────

// Event types
export type {
  AlertCategory, AlertPriority, AlertEvent, BaseEvent,
  SignalEvent, MarketEvent, WhaleEvent, LiquidationEvent, PumpEvent,
  MarketEventType, WhaleEventType, LiquidationEventType,
} from './event-types';
export { EVENT_CHANNELS, eventToContext } from './event-types';

// Event bus
export {
  publishEvent, publishEvents,
  createAlertWorker, createQueueMonitor,
  getAlertQueue, getRedis,
  shutdownEventBus,
} from './event-bus';

// DSL engine
export {
  evaluateRule, parseExpression,
  legacyConditionsToAst,
} from './dsl-engine';
export type {
  RuleNode, ComparisonNode, LogicalNode, InNode, BetweenNode,
  DslEvalResult, LegacyConditions,
} from './dsl-engine';

// Priority
export { classifyPriority, getPriorityRouting, priorityRank } from './priority';

// Alert scorer
export { computeAlertScore, recordEventForScoring } from './alert-scorer';
export type { AlertScore, ScoreFactor } from './alert-scorer';

// Deduplication
export { checkDedup, recordAlertSent, mergeRuleCooldown } from './dedup';

// Dispatcher
export { AlertDispatcher } from './dispatcher';
export type { AlertDeliveryAdapters, DispatchResult } from './dispatcher';

// Legacy rule engine (still used for isThrottled, AlertChannels)
export { isThrottled, getActiveSessions } from './rule-engine';
export type { AlertConditions, AlertChannels, SignalPayload, EvalResult } from './rule-engine';

// WebPush
export { createWebPushAdapter, initWebPush } from './webpush-adapter';
