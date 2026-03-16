// ─────────────────────────────────────────────────────────────
// packages/db/src/alerts/event-types.ts
// Typed event definitions for every intelligence layer
// ─────────────────────────────────────────────────────────────

// ── Alert categories ──────────────────────────────────────────

export type AlertCategory =
  | 'SIGNAL'
  | 'MARKET'
  | 'WHALE'
  | 'LIQUIDATION'
  | 'PUMP';

export type AlertPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ── Base event shape (all events extend this) ─────────────────

export interface BaseEvent {
  id:        string;        // unique event ID (uuid)
  category:  AlertCategory;
  timestamp: Date;
  asset:     string;        // e.g. "BTC", "ETH", "SOL"
  pair?:     string;        // e.g. "BTC/USDT"
}

// ── Signal events (existing) ──────────────────────────────────

export interface SignalEvent extends BaseEvent {
  category:        'SIGNAL';
  direction:       'LONG' | 'SHORT';
  providerId:      string;
  providerName:    string;
  iqScore?:        number;
  truthPassRate?:  number;
  confidence?:     number;
  cherryPickRisk?: 'LOW' | 'MEDIUM' | 'HIGH';
  rRatio?:         number;
  leverage?:       number;
  signalId:        string;
}

// ── Market events ─────────────────────────────────────────────

export type MarketEventType =
  | 'PRICE_MOVEMENT'
  | 'VOLATILITY_SPIKE'
  | 'VOLUME_ANOMALY'
  | 'FUNDING_RATE_EXTREME';

export interface MarketEvent extends BaseEvent {
  category:     'MARKET';
  type:         MarketEventType;
  timeframe:    string;          // "1m" | "5m" | "15m" | "1h" | "4h" | "1d"
  price:        number;
  priceChange:  number;          // percent
  volume:       number;
  volumeChange: number;          // percent vs 24h avg
  volatility?:  number;          // ATR or similar
  fundingRate?: number;
}

// ── Whale events ──────────────────────────────────────────────

export type WhaleEventType =
  | 'LARGE_TRANSFER'
  | 'EXCHANGE_INFLOW'
  | 'EXCHANGE_OUTFLOW'
  | 'WALLET_ACCUMULATION';

export interface WhaleEvent extends BaseEvent {
  category:    'WHALE';
  type:        WhaleEventType;
  amountUsd:   number;
  fromLabel?:  string;           // e.g. "Binance Hot Wallet"
  toLabel?:    string;
  txHash?:     string;
  walletAddr?: string;
}

// ── Liquidation events ────────────────────────────────────────

export type LiquidationEventType =
  | 'SINGLE_LIQUIDATION'
  | 'LIQUIDATION_CASCADE'
  | 'CLUSTER_APPROACHING';

export interface LiquidationEvent extends BaseEvent {
  category:       'LIQUIDATION';
  type:           LiquidationEventType;
  side:           'LONG' | 'SHORT';
  amountUsd:      number;
  clusterUsd?:    number;         // total cluster size
  priceLevel?:    number;         // price at which cluster sits
  cascadeRisk?:   number;         // 0–100
  exchange?:      string;
}

// ── Pump detection events ─────────────────────────────────────

export interface PumpEvent extends BaseEvent {
  category:         'PUMP';
  volumeSpike:      number;       // multiplier vs baseline
  socialSpike?:     number;       // social mentions multiplier
  priceChange:      number;       // percent in detection window
  detectionWindow:  string;       // "5m" | "15m" | "1h"
  exchanges:        string[];     // where activity detected
}

// ── Union type ────────────────────────────────────────────────

export type AlertEvent =
  | SignalEvent
  | MarketEvent
  | WhaleEvent
  | LiquidationEvent
  | PumpEvent;

// ── Event bus channel names ───────────────────────────────────

export const EVENT_CHANNELS = {
  SIGNAL:      'alerts:signal',
  MARKET:      'alerts:market',
  WHALE:       'alerts:whale',
  LIQUIDATION: 'alerts:liquidation',
  PUMP:        'alerts:pump',
  // Unified channel for the alert engine consumer
  ALL:         'alerts:all',
} as const;

// ── Helper: extract a flat key-value context from any event ───
// Used by the DSL engine to evaluate expressions like "whale.amountUsd > 50000000"

export function eventToContext(event: AlertEvent): Record<string, any> {
  const ctx: Record<string, any> = {
    category:  event.category,
    asset:     event.asset,
    pair:      event.pair ?? `${event.asset}/USDT`,
    timestamp: event.timestamp,
  };

  switch (event.category) {
    case 'SIGNAL':
      ctx.direction      = event.direction;
      ctx.providerId     = event.providerId;
      ctx.providerName   = event.providerName;
      ctx.iqScore        = event.iqScore       ?? 0;
      ctx.truthPassRate  = event.truthPassRate  ?? 0;
      ctx.confidence     = event.confidence     ?? 0;
      ctx.cherryPickRisk = event.cherryPickRisk ?? 'HIGH';
      ctx.rRatio         = event.rRatio         ?? 0;
      ctx.leverage       = event.leverage       ?? 1;
      break;

    case 'MARKET':
      ctx.type           = event.type;
      ctx.timeframe      = event.timeframe;
      ctx.price          = event.price;
      ctx.priceChange    = event.priceChange;
      ctx.volume         = event.volume;
      ctx.volumeChange   = event.volumeChange;
      ctx.volatility     = event.volatility    ?? 0;
      ctx.fundingRate    = event.fundingRate    ?? 0;
      break;

    case 'WHALE':
      ctx.type           = event.type;
      ctx.amountUsd      = event.amountUsd;
      ctx.fromLabel      = event.fromLabel     ?? '';
      ctx.toLabel        = event.toLabel       ?? '';
      break;

    case 'LIQUIDATION':
      ctx.type           = event.type;
      ctx.side           = event.side;
      ctx.amountUsd      = event.amountUsd;
      ctx.clusterUsd     = event.clusterUsd    ?? 0;
      ctx.cascadeRisk    = event.cascadeRisk   ?? 0;
      ctx.priceLevel     = event.priceLevel    ?? 0;
      break;

    case 'PUMP':
      ctx.volumeSpike    = event.volumeSpike;
      ctx.socialSpike    = event.socialSpike   ?? 0;
      ctx.priceChange    = event.priceChange;
      break;
  }

  return ctx;
}
