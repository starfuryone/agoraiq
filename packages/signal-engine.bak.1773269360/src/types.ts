/**
 * @agoraiq/signal-engine v2 — Core Type Definitions
 */

// ─── Enums ─────────────────────────────────────────────────────────────────────

export enum Direction {
  LONG = "LONG",
  SHORT = "SHORT",
  NEUTRAL = "NEUTRAL",
}

export enum SignalStatus {
  WATCHLIST = "WATCHLIST",
  PENDING = "PENDING",
  ACTIVE = "ACTIVE",
  PARTIAL_HIT = "PARTIAL_HIT",
  COMPLETED = "COMPLETED",
  STOPPED = "STOPPED",
  INVALIDATED = "INVALIDATED",
  EXPIRED = "EXPIRED",
}

export enum RegimeType {
  TRENDING_BULL = "TRENDING_BULL",
  TRENDING_BEAR = "TRENDING_BEAR",
  RANGE_CHOP = "RANGE_CHOP",
  HIGH_VOL_EVENT = "HIGH_VOL_EVENT",
  LOW_LIQUIDITY = "LOW_LIQUIDITY",
  UNKNOWN = "UNKNOWN",
}

export enum ConfidenceLevel {
  HIGH = "HIGH",
  MEDIUM = "MEDIUM",
  LOW = "LOW",
  REJECT = "REJECT",
}

// ─── Strategy Types (v2: only 2 active strategies) ─────────────────────────────

export type StrategyType = "TREND_CONTINUATION" | "MEAN_REVERSION" | "BREAKOUT_CONFIRMATION";

// ─── Reason Codes ──────────────────────────────────────────────────────────────

export type ReasonCode =
  | "EMA_BULLISH_ALIGNMENT"
  | "EMA_BEARISH_ALIGNMENT"
  | "RSI_BULLISH_MIDZONE"
  | "RSI_BEARISH_MIDZONE"
  | "RSI_OVERSOLD"
  | "RSI_OVERBOUGHT"
  | "MACD_POSITIVE"
  | "MACD_NEGATIVE"
  | "VOLUME_CONFIRMATION"
  | "ORDERBOOK_BUY_PRESSURE"
  | "ORDERBOOK_SELL_PRESSURE"
  | "BOLLINGER_LOWER_EXTREME"
  | "BOLLINGER_UPPER_EXTREME"
  | "BOLLINGER_PCT_B_EXTREME"
  | "NO_STRONG_NEGATIVE_SENTIMENT"
  | "NO_STRONG_POSITIVE_SENTIMENT"
  | "POSITIVE_NEWS_CATALYST"
  | "NEGATIVE_NEWS_CATALYST"
  | "SOURCE_CREDIBLE"
  | "OPEN_INTEREST_CONFIRMATION"
  | "POSITIVE_SENTIMENT"
  | "NEGATIVE_SENTIMENT"
  | "RESISTANCE_BREAKOUT"
  | "SUPPORT_BREAKDOWN"
  | "VWAP_ALIGNED"
  | "EMA20_PROXIMITY"
  // Order book depth
  | "BID_WALL_SUPPORT"
  | "ASK_WALL_RESISTANCE"
  | "DEPTH_RATIO_BULLISH"
  | "DEPTH_RATIO_BEARISH"
  // Whale activity
  | "WHALE_BUYING"
  | "WHALE_SELLING"
  // Liquidation clusters
  | "SHORT_SQUEEZE_ZONE"
  | "LONG_SQUEEZE_ZONE"
  | "LIQUIDATION_CASCADE"
  // Cross-exchange
  | "CROSS_EXCHANGE_CONSENSUS"
  | "CROSS_EXCHANGE_DIVERGENCE";

export type RiskFlag =
  | "HIGH_VOLATILITY_EVENT"
  | "LOW_LIQUIDITY"
  | "CROWDED_LONGS"
  | "CROWDED_SHORTS"
  | "EVENT_SHOCK"
  | "THIN_ORDERBOOK"
  | "WHALE_COUNTER_TRADE"
  | "LIQUIDATION_CASCADE_ACTIVE"
  | "CROSS_EXCHANGE_DIVERGENCE"
  | "WIDE_SPREAD";

// ─── OHLCV Candle ──────────────────────────────────────────────────────────────

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Market Snapshot ───────────────────────────────────────────────────────────

export interface MarketSnapshot {
  symbol: string;
  timeframe: string;
  timestamp: Date;

  price: number;
  volume: number;
  high: number;
  low: number;

  // Technical indicators
  rsi: number;
  macdLine: number;
  macdSignal: number;
  macdHistogram: number;
  ema20: number;
  ema50: number;
  ema200: number;
  atr: number;
  bollingerUpper: number;
  bollingerMid: number;
  bollingerLower: number;
  vwap: number;

  // Derivatives
  fundingRate: number;
  openInterest: number;
  oiChangePct: number;
  liquidationLong: number;
  liquidationShort: number;
  orderbookImbalance: number;

  // Alpha intelligence
  orderbookDepth: OrderbookDepth;
  whaleActivity: WhaleActivity;
  liquidationClusters: LiquidationClusters;
  crossExchange: CrossExchangeContext;

  // Sentiment & news
  sentimentScore: number;
  fearGreed: number;
  newsEventScore: number;
  sourceCredibilityScore: number;

  // Regime
  regime: RegimeType;

  // Raw candles
  candles: Candle[];
}

// ─── Order Book Depth ──────────────────────────────────────────────────────────

export interface OrderbookDepth {
  bidWallPrice: number;
  bidWallSize: number;
  askWallPrice: number;
  askWallSize: number;
  bidDepth1Pct: number;
  askDepth1Pct: number;
  depthRatio: number;
  spreadBps: number;
}

// ─── Whale Activity ────────────────────────────────────────────────────────────

export interface WhaleActivity {
  largeTradeCount: number;
  largeTradeNetVolume: number;
  whaleDirection: "BUY" | "SELL" | "NEUTRAL";
  largeTradeRatio: number;
}

// ─── Liquidation Clusters ──────────────────────────────────────────────────────

export interface LiquidationClusters {
  longClusterPrice: number;
  longClusterValue: number;
  shortClusterPrice: number;
  shortClusterValue: number;
  netLiquidationPressure: number;
  cascadeDetected: boolean;
}

// ─── Cross-Exchange Context ────────────────────────────────────────────────────

export interface CrossExchangeContext {
  prices: Record<string, number>;
  maxSpreadBps: number;
  divergenceDetected: boolean;
  leadingExchange: string;
  priceConsensus: "BULLISH" | "BEARISH" | "MIXED";
  /** Number of exchanges that returned valid data */
  venueCount: number;
  /** Each venue's share of total volume across queried exchanges (%) */
  volumeSharePct: Record<string, number>;
  /** Spot-futures premium in bps (0 if not available) */
  spotFuturesPremiumBps: number;
}

// ─── Strategy Signal Candidate ─────────────────────────────────────────────────

export interface StrategySignalCandidate {
  strategyType: string;
  symbol: string;
  timeframe: string;
  timestamp: Date;

  direction: Direction;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;

  technicalScore: number;
  marketStructureScore: number;
  newsScore: number;
  providerScore: number;
  riskPenalty: number;
  finalScore: number;

  confidence: ConfidenceLevel;
  expectedR: number;

  reasonCodes: ReasonCode[];
  riskFlags: RiskFlag[];
}

// ─── Final Signal ──────────────────────────────────────────────────────────────

export interface FinalSignal {
  signalId: string;
  symbol: string;
  timeframe: string;
  direction: Direction;
  strategyType: string;

  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;

  technicalScore: number;
  marketStructureScore: number;
  newsScore: number;
  providerScore: number;
  riskPenalty: number;
  finalScore: number;
  confidence: ConfidenceLevel;
  expectedR: number;

  regime: RegimeType;
  reasonCodes: ReasonCode[];
  riskFlags: RiskFlag[];

  status: SignalStatus;
  publishedAt: Date;
  expiresAt: Date;

  /** AI reasoning output — advisory only, never blocks publication */
  aiReasoning?: AIReasoningOutput;
}

// ─── Signal Outcome ────────────────────────────────────────────────────────────

export interface SignalOutcome {
  signalId: string;
  symbol: string;
  timeframe: string;

  publishedAt: Date;
  entryHitAt: Date | null;
  stopHitAt: Date | null;
  tp1HitAt: Date | null;
  tp2HitAt: Date | null;
  invalidatedAt: Date | null;
  expiredAt: Date | null;

  mfePct: number;
  maePct: number;
  durationMinutes: number;

  outcomeLabel: "WIN" | "LOSS" | "PARTIAL" | "EXPIRED" | "INVALIDATED";
  realizedR: number;
}

// ─── Strategy Expectancy ───────────────────────────────────────────────────────

export interface StrategyExpectancy {
  strategyType: string;
  symbol: string;
  timeframe: string;
  regime: string;
  winRate: number;
  avgR: number;
  sampleSize: number;
}

// ─── AI Reasoning Output ───────────────────────────────────────────────────────

export interface AIReasoningOutput {
  available: boolean;
  narrative: string;
  scoreAdjustment: number;
  aiConfidence: number;
  keyFactors: string[];
  macroContext: string;
  caution: string | null;
  latencyMs: number;
}

// ─── Publisher payload ─────────────────────────────────────────────────────────

export interface EngineSignalPayload {
  action: "BUY" | "SELL";
  symbol: string;
  timeframe: string;
  score: number;
  confidence: string;
  price: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  signalTs: string;
  meta: {
    strategyType: string;
    regime: string;
    entryLow: number;
    entryHigh: number;
    expectedR: number;
    technicalScore: number;
    marketStructureScore: number;
    newsScore: number;
    providerScore: number;
    riskPenalty: number;
    reasonCodes: string[];
    riskFlags: string[];
    engineVersion: string;
    signalId: string;
    aiReasoning?: {
      narrative: string;
      scoreAdjustment: number;
      aiConfidence: number;
      keyFactors: string[];
      macroContext: string;
      caution: string | null;
    };
  };
  rawPayload: Record<string, unknown>;
}

// ─── Persistence row types ─────────────────────────────────────────────────────

export interface SignalAnalysisRow {
  id: string;
  signal_id: string;
  strategy_type: string;
  regime: string;
  symbol: string;
  timeframe: string;
  direction: string;
  entry_low: number;
  entry_high: number;
  expected_r: number;
  technical_score: number;
  market_structure_score: number;
  news_score: number;
  provider_score: number;
  risk_penalty: number;
  final_score: number;
  confidence: string;
  reason_codes: string;    // JSON string
  risk_flags: string;      // JSON string
  ai_narrative: string | null;
  ai_score_adjustment: number | null;
  ai_enabled: number;               // 0 or 1 (SQLite boolean)
  ai_model_version: string | null;
  base_final_score: number;          // score BEFORE AI adjustment
  post_ai_final_score: number;       // score AFTER AI adjustment (= final_score)
  ai_confidence: number | null;
  ai_reasoning_latency_ms: number | null;
  outcome_label: string | null;
  realized_r: number | null;
  mfe_pct: number | null;
  mae_pct: number | null;
  expires_at: string;
  published_at: string;
  resolved_at: string | null;
}

export interface BacktestResultRow {
  id: string;
  run_id: string;
  symbol: string;
  timeframe: string;
  strategy_type: string;
  direction: string;
  regime: string;
  confidence: string;
  entry_price: number;
  exit_price: number;
  exit_reason: string;
  realized_r: number;
  max_drawdown_pct: number;
  max_profit_pct: number;
  duration_bars: number;
  final_score: number;
  created_at: string;
}

// ─── Strategy function signature ───────────────────────────────────────────────

export type StrategyFn = (
  snapshot: MarketSnapshot
) => StrategySignalCandidate | null;
