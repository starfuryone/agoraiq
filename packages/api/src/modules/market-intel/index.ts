// ============================================================
// AgoraIQ Market Intel — Shared Types
// ============================================================

export type Side = 'LONG' | 'SHORT';
export type Confidence = 'HIGH' | 'MED' | 'LOW';
export type AlertType = 'volatility' | 'arbitrage' | 'regime';
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

// ----- Score Engine -----

export interface ScoreInputs {
  provider_accuracy: number;   // 0..1  (from AgoraIQ win-rate data)
  momentum_strength: number;   // 0..1  (price momentum / trend)
  volume_spike: number;        // 0..1  (relative to avg volume)
  volatility_regime: number;   // 0..1  (normalised ATR/stdev bucket)
  sentiment_score: number;     // 0..1  (from sentimentProvider)
  funding_rate_signal: number; // 0..1  (funding-rate as direction signal)
}

export interface ScoreResult {
  symbol: string;
  side: Side;
  score: number;           // 0..1
  probabilityPct: number;  // 0..100
  confidence: Confidence;
  expectedR: number;       // risk:reward estimate
  inputs: ScoreInputs;
  computedAt: Date;
}

// ----- Volatility -----

export interface VolatilitySnapshot {
  symbol: string;
  exchange: string;
  volatility24h: number;       // annualised stdev or % move
  volatility30dAvg: number;
  atr?: number;
  volume24h: number;
  volumeAvg: number;
  liquidationSpike?: number;
  fetchedAt: Date;
}

export interface VolatilityAlert {
  symbol: string;
  exchange: string;
  volatilityRatio: number;   // current / 30d avg
  volumeRatio: number;
  regime: string;            // 'breakout likely' | 'high compression' | etc.
  message: string;
  severity: AlertSeverity;
  triggeredAt: Date;
}

// ----- Arbitrage -----

export interface ExchangePrice {
  exchange: string;
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  fetchedAt: Date;
}

export interface ArbitrageAlert {
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;          // e.g. 0.0034 = 0.34%
  profitPotentialPct: number; // spread minus estimated fees
  message: string;
  severity: AlertSeverity;
  triggeredAt: Date;
}

// ----- Sentiment -----

export interface SentimentResult {
  symbol: string;
  score: number;        // 0..1
  label: 'bullish' | 'bearish' | 'neutral';
  source: string;
  fetchedAt: Date;
}

// ----- DB row shapes (mirrors Prisma models) -----

export interface MarketIntelScoreRow {
  id: string;
  symbol: string;
  side: string;
  score: number;
  probabilityPct: number;
  confidence: string;
  expectedR: number;
  rawInputs: object;
  createdAt: Date;
}

export interface MarketIntelAlertRow {
  id: string;
  type: AlertType;
  severity: string;
  symbol: string;
  exchange?: string | null;
  message: string;
  metadata: object;
  createdAt: Date;
}

export interface MarketIntelSnapshotRow {
  id: string;
  symbol: string;
  exchange: string;
  rawData: object;
  normalizedData: object;
  createdAt: Date;
}
