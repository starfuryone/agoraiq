// ─────────────────────────────────────────────────────────────
// packages/api/src/lib/alerts/producers.ts
// Event producers — call these from your data pipelines to
// publish events into the alert bus.
//
// Usage:
//   import { publishSignalEvent } from './alerts/producers';
//   // After signal saved + graded:
//   await publishSignalEvent(signal, grade, provider);
// ─────────────────────────────────────────────────────────────

import { v4 as uuid } from 'uuid';
import { publishEvent } from '@agoraiq/db/alerts/event-bus';
import type {
  SignalEvent,
  MarketEvent,
  WhaleEvent,
  LiquidationEvent,
  PumpEvent,
  MarketEventType,
  WhaleEventType,
  LiquidationEventType,
} from '@agoraiq/db/alerts/event-types';

// ── Signal producer ───────────────────────────────────────────
// Call from: signal ingest pipeline (webhook, Telegram, Discord listener)

export async function publishSignalEvent(
  signal: {
    id:          string;
    pair:        string;
    direction:   string;
    providerId:  string;
    confidence?: number | null;
    leverage?:   number | null;
    rRatio?:     number | null;
    createdAt:   Date;
    provider?:   { name?: string } | null;
  },
  grade?: {
    iq_score?:         number;
    truth_pass_rate?:  number;
    cherry_pick_risk?: string;
    min_r?:            number;
  },
): Promise<void> {
  const asset = signal.pair.split('/')[0] ?? signal.pair;

  const event: SignalEvent = {
    id:             uuid(),
    category:       'SIGNAL',
    timestamp:      signal.createdAt,
    asset,
    pair:           signal.pair,
    direction:      signal.direction as 'LONG' | 'SHORT',
    providerId:     signal.providerId,
    providerName:   signal.provider?.name ?? signal.providerId,
    iqScore:        grade?.iq_score,
    truthPassRate:  grade?.truth_pass_rate,
    confidence:     signal.confidence ?? undefined,
    cherryPickRisk: (grade?.cherry_pick_risk as any) ?? undefined,
    rRatio:         grade?.min_r ?? signal.rRatio ?? undefined,
    leverage:       signal.leverage ?? undefined,
    signalId:       signal.id,
  };

  await publishEvent(event);
}

// ── Market producer ───────────────────────────────────────────
// Call from: market scanner, WebSocket collector, TA engine

export async function publishMarketEvent(data: {
  asset:         string;
  pair?:         string;
  type:          MarketEventType;
  timeframe:     string;
  price:         number;
  priceChange:   number;
  volume:        number;
  volumeChange:  number;
  volatility?:   number;
  fundingRate?:  number;
}): Promise<void> {
  const event: MarketEvent = {
    id:           uuid(),
    category:     'MARKET',
    timestamp:    new Date(),
    asset:        data.asset,
    pair:         data.pair ?? `${data.asset}/USDT`,
    type:         data.type,
    timeframe:    data.timeframe,
    price:        data.price,
    priceChange:  data.priceChange,
    volume:       data.volume,
    volumeChange: data.volumeChange,
    volatility:   data.volatility,
    fundingRate:  data.fundingRate,
  };

  await publishEvent(event);
}

// ── Whale producer ────────────────────────────────────────────
// Call from: on-chain monitor, whale tracking API integration

export async function publishWhaleEvent(data: {
  asset:      string;
  type:       WhaleEventType;
  amountUsd:  number;
  fromLabel?: string;
  toLabel?:   string;
  txHash?:    string;
  walletAddr?:string;
}): Promise<void> {
  const event: WhaleEvent = {
    id:         uuid(),
    category:   'WHALE',
    timestamp:  new Date(),
    asset:      data.asset,
    pair:       `${data.asset}/USDT`,
    type:       data.type,
    amountUsd:  data.amountUsd,
    fromLabel:  data.fromLabel,
    toLabel:    data.toLabel,
    txHash:     data.txHash,
    walletAddr: data.walletAddr,
  };

  await publishEvent(event);
}

// ── Liquidation producer ──────────────────────────────────────
// Call from: exchange WebSocket feed, liquidation aggregator

export async function publishLiquidationEvent(data: {
  asset:        string;
  type:         LiquidationEventType;
  side:         'LONG' | 'SHORT';
  amountUsd:    number;
  clusterUsd?:  number;
  priceLevel?:  number;
  cascadeRisk?: number;
  exchange?:    string;
}): Promise<void> {
  const event: LiquidationEvent = {
    id:          uuid(),
    category:    'LIQUIDATION',
    timestamp:   new Date(),
    asset:       data.asset,
    pair:        `${data.asset}/USDT`,
    type:        data.type,
    side:        data.side,
    amountUsd:   data.amountUsd,
    clusterUsd:  data.clusterUsd,
    priceLevel:  data.priceLevel,
    cascadeRisk: data.cascadeRisk,
    exchange:    data.exchange,
  };

  await publishEvent(event);
}

// ── Pump detection producer ───────────────────────────────────
// Call from: volume anomaly detector, social sentiment scanner

export async function publishPumpEvent(data: {
  asset:            string;
  volumeSpike:      number;
  socialSpike?:     number;
  priceChange:      number;
  detectionWindow:  string;
  exchanges:        string[];
}): Promise<void> {
  const event: PumpEvent = {
    id:              uuid(),
    category:        'PUMP',
    timestamp:       new Date(),
    asset:           data.asset,
    pair:            `${data.asset}/USDT`,
    volumeSpike:     data.volumeSpike,
    socialSpike:     data.socialSpike,
    priceChange:     data.priceChange,
    detectionWindow: data.detectionWindow,
    exchanges:       data.exchanges,
  };

  await publishEvent(event);
}
