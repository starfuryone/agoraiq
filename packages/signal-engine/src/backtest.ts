/**
 * @agoraiq/signal-engine v2 — Backtesting Engine (Hardened)
 *
 * KNOWN LIMITATIONS (read before trusting results)
 * ─────────────────────────────────────────────────
 * 1. SLIPPAGE MODEL: Configurable bps-based slippage applied to entries
 *    and adverse exits. Default 5bps. This is a fixed estimate — real
 *    slippage depends on orderbook depth, trade size, and market conditions
 *    which we don't have historically.
 *
 * 2. FEE MODEL: Configurable round-trip fee in bps. Default 14bps (7bps
 *    per side, Binance VIP0 taker). Fees are deducted from realized R.
 *    Does not model maker rebates or tiered fee structures.
 *
 * 3. INTRA-BAR AMBIGUITY: When a bar's range spans both SL and TP, we
 *    cannot know which was hit first. These are flagged as "ambiguous"
 *    and counted as SL hits (pessimistic). The ambiguousCount in results
 *    tells you how many trades have this problem.
 *
 * 4. ENTRY TIMING: Signals are generated at bar[i] close. Entry fill is
 *    at bar[i+1] open (not the signal bar's close). This adds one bar of
 *    delay and uses the actual next-bar open price + slippage.
 *
 * 5. INDICATOR LOOKAHEAD: Indicators use candles[0..i], never candles[i+1..n].
 *    The snapshot builder receives a slice ending at the signal bar.
 *    This is correct. BUT: the regime detector, strategies, and scoring
 *    engine were designed for live data and may have subtle assumptions
 *    about data availability that don't perfectly map to historical replay.
 *
 * 6. MISSING DATA: Historical backtests have NO orderbook depth, NO whale
 *    activity, NO liquidation clusters, NO cross-exchange context, NO news,
 *    and NO sentiment. All alpha intelligence scores use neutral defaults.
 *    This means backtest results only validate the technical + regime logic.
 *    Live performance will differ because those additional signals affect
 *    both scoring and strategy gating.
 *
 * 7. EQUITY CURVE: Peak-to-trough drawdown is tracked on cumulative R, not
 *    on capital with compounding. This is simpler but less realistic for
 *    leveraged positions.
 *
 * 8. DATA QUALITY: We flag bars with zero volume or >10% gaps from the
 *    previous close. These bars may represent exchange outages or data
 *    feed issues. Signals generated on flagged bars are tracked separately.
 */

import { createHash } from "crypto";
import type {
  Candle,
  MarketSnapshot,
  FinalSignal,
  BacktestResultRow,
} from "./types";
import { RegimeType, Direction } from "./types";
import { getOHLCV } from "./services/market-data";
import { runAllStrategies } from "./strategies";
import { applyGlobalScoring } from "./scoring";
import { rankCandidates, selectBestCandidate } from "./ranking";
import { shouldPublish, toFinalSignal } from "./publisher";
import {
  computeRSI, computeMACD, computeEMA, computeATR,
  computeBollinger, computeVWAP,
} from "./utils/ta";
import { detectMarketRegime } from "./regime-detector";
import { NEUTRAL_DEPTH } from "./services/orderbook-depth";
import { NEUTRAL_WHALE } from "./services/whale-detection";
import { NEUTRAL_LIQ_CLUSTERS } from "./services/liquidation-clusters";
import { NEUTRAL_CROSS_EXCHANGE } from "./services/cross-exchange";
import { insertBacktestRun, insertBacktestResult } from "./persistence/db";
import { logger } from "./services/logger";

// ─── Configuration ─────────────────────────────────────────────────────────────

export interface BacktestConfig {
  /** Slippage in basis points applied to entries and adverse exits */
  slippageBps: number;
  /** Round-trip fee in basis points (both legs combined) */
  roundTripFeeBps: number;
  /** Max bars to hold before expiring */
  maxHoldBars: number;
  /** Scan every Nth bar (1 = every bar) */
  scanEveryN: number;
}

const DEFAULT_CONFIG: BacktestConfig = {
  slippageBps: 5,
  roundTripFeeBps: 14,  // 7bps per side, Binance VIP0 taker
  maxHoldBars: 50,
  scanEveryN: 1,
};

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface BacktestSignalResult {
  signal: FinalSignal;
  entryPrice: number;    // after slippage
  exitPrice: number;     // after slippage on SL
  exitReason: "TP1" | "TP2" | "STOP" | "EXPIRED";
  grossR: number;        // before fees
  netR: number;          // after fees
  feeCostR: number;      // fees expressed in R units
  maxDrawdownPct: number;
  maxProfitPct: number;
  durationBars: number;
  /** True if SL and TP were both within the same bar's range */
  ambiguous: boolean;
  /** True if signal was generated on a bar flagged for data quality */
  onFlaggedBar: boolean;
}

export interface BacktestSummary {
  runId: string;
  symbol: string;
  timeframe: string;
  days: number;
  config: BacktestConfig;
  totalBars: number;
  flaggedBars: number;
  signalsGenerated: number;
  signalsPublished: number;
  ambiguousCount: number;
  wins: number;
  losses: number;
  partials: number;
  expired: number;
  grossWinRate: number;
  grossAvgR: number;
  netWinRate: number;
  netAvgR: number;
  netProfitFactor: number;
  /** Peak-to-trough drawdown on cumulative R */
  maxEquityDrawdownR: number;
  maxTradeDrawdownPct: number;
  byStrategy: Record<string, StrategyStats>;
  byConfidence: Record<string, StrategyStats>;
  byRegime: Record<string, StrategyStats>;
}

export interface StrategyStats {
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
}

// ─── Data Quality ──────────────────────────────────────────────────────────────

function flagDataQuality(candles: Candle[]): Set<number> {
  const flagged = new Set<number>();
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];

    // Zero volume = likely exchange outage or data gap
    if (curr.volume === 0) flagged.add(i);

    // Gap > 10% from previous close
    if (prev.close > 0) {
      const gapPct = Math.abs(curr.open - prev.close) / prev.close;
      if (gapPct > 0.10) flagged.add(i);
    }
  }
  return flagged;
}

// ─── Historical Snapshot ───────────────────────────────────────────────────────

function buildHistoricalSnapshot(
  symbol: string,
  timeframe: string,
  candles: Candle[],
  index: number
): MarketSnapshot | null {
  if (index < 200) return null;

  const window = candles.slice(0, index + 1);
  const closes = window.map((c) => c.close);
  const current = window[window.length - 1];

  const snapshot: MarketSnapshot = {
    symbol, timeframe,
    timestamp: new Date(current.timestamp),
    price: current.close,
    volume: current.volume,
    high: current.high,
    low: current.low,
    rsi: computeRSI(closes, 14),
    ...(() => { const m = computeMACD(closes); return { macdLine: m.line, macdSignal: m.signal, macdHistogram: m.histogram }; })(),
    ema20: computeEMA(closes, 20),
    ema50: computeEMA(closes, 50),
    ema200: computeEMA(closes, 200),
    atr: computeATR(window, 14),
    ...(() => { const b = computeBollinger(closes, 20, 2); return { bollingerUpper: b.upper, bollingerMid: b.mid, bollingerLower: b.lower }; })(),
    vwap: computeVWAP(window.slice(-50)),
    // No live data in backtests — neutral defaults
    fundingRate: 0, openInterest: 0, oiChangePct: 0,
    liquidationLong: 0, liquidationShort: 0, orderbookImbalance: 0,
    orderbookDepth: NEUTRAL_DEPTH,
    whaleActivity: NEUTRAL_WHALE,
    liquidationClusters: NEUTRAL_LIQ_CLUSTERS,
    crossExchange: NEUTRAL_CROSS_EXCHANGE,
    sentimentScore: 0, fearGreed: 50,
    newsEventScore: 0, sourceCredibilityScore: 0.5,
    regime: RegimeType.UNKNOWN,
    candles: window,
  };

  snapshot.regime = detectMarketRegime(snapshot, window);
  return snapshot;
}

// ─── Simulate Outcome ──────────────────────────────────────────────────────────

function simulateOutcome(
  signal: FinalSignal,
  candles: Candle[],
  signalIndex: number,
  cfg: BacktestConfig,
  flaggedBars: Set<number>
): BacktestSignalResult | null {
  // Entry at NEXT bar's open + slippage (not signal bar's close)
  const entryBarIndex = signalIndex + 1;
  if (entryBarIndex >= candles.length) return null;

  const entryBar = candles[entryBarIndex];
  const slippageMult = cfg.slippageBps / 10000;

  // Slippage direction: longs get worse (higher) entry, shorts get worse (lower)
  const rawEntry = entryBar.open;
  const entryPrice = signal.direction === Direction.LONG
    ? rawEntry * (1 + slippageMult)
    : rawEntry * (1 - slippageMult);

  // Recompute risk/reward from actual entry (not theoretical midpoint)
  const risk = signal.direction === Direction.LONG
    ? Math.abs(entryPrice - signal.stopLoss)
    : Math.abs(signal.stopLoss - entryPrice);

  if (risk <= 0) return null;

  // Fee cost in R units: roundTripFee / risk-as-fraction-of-price
  const riskFraction = risk / entryPrice;
  const feeFraction = cfg.roundTripFeeBps / 10000;
  const feeCostR = riskFraction > 0 ? feeFraction / riskFraction : 0;

  let maxDrawdownPct = 0;
  let maxProfitPct = 0;
  const onFlaggedBar = flaggedBars.has(signalIndex);

  const endBar = Math.min(entryBarIndex + cfg.maxHoldBars, candles.length);

  for (let i = entryBarIndex + 1; i < endBar; i++) {
    const bar = candles[i];

    if (signal.direction === Direction.LONG) {
      maxProfitPct = Math.max(maxProfitPct, (bar.high - entryPrice) / entryPrice);
      maxDrawdownPct = Math.max(maxDrawdownPct, (entryPrice - bar.low) / entryPrice);

      // Intra-bar ambiguity: both SL and TP2 within bar range
      const slHit = bar.low <= signal.stopLoss;
      const tp2Hit = bar.high >= signal.takeProfit2;
      const tp1Hit = bar.high >= signal.takeProfit1;

      if (slHit && tp2Hit) {
        // Ambiguous — count pessimistically as SL
        const slipSL = signal.stopLoss * (1 - slippageMult); // worse exit on SL
        return { signal, entryPrice, exitPrice: slipSL, exitReason: "STOP", grossR: -1, netR: -1 - feeCostR, feeCostR, maxDrawdownPct, maxProfitPct, durationBars: i - entryBarIndex, ambiguous: true, onFlaggedBar };
      }

      if (slHit) {
        const slipSL = signal.stopLoss * (1 - slippageMult);
        return { signal, entryPrice, exitPrice: slipSL, exitReason: "STOP", grossR: -1, netR: -1 - feeCostR, feeCostR, maxDrawdownPct, maxProfitPct, durationBars: i - entryBarIndex, ambiguous: false, onFlaggedBar };
      }

      if (tp2Hit) {
        const reward = signal.takeProfit2 - entryPrice;
        const grossR = reward / risk;
        return { signal, entryPrice, exitPrice: signal.takeProfit2, exitReason: "TP2", grossR, netR: grossR - feeCostR, feeCostR, maxDrawdownPct, maxProfitPct, durationBars: i - entryBarIndex, ambiguous: false, onFlaggedBar };
      }

      if (tp1Hit) {
        const reward = signal.takeProfit1 - entryPrice;
        const grossR = reward / risk;
        return { signal, entryPrice, exitPrice: signal.takeProfit1, exitReason: "TP1", grossR, netR: grossR - feeCostR, feeCostR, maxDrawdownPct, maxProfitPct, durationBars: i - entryBarIndex, ambiguous: false, onFlaggedBar };
      }
    } else {
      // SHORT
      maxProfitPct = Math.max(maxProfitPct, (entryPrice - bar.low) / entryPrice);
      maxDrawdownPct = Math.max(maxDrawdownPct, (bar.high - entryPrice) / entryPrice);

      const slHit = bar.high >= signal.stopLoss;
      const tp2Hit = bar.low <= signal.takeProfit2;
      const tp1Hit = bar.low <= signal.takeProfit1;

      if (slHit && tp2Hit) {
        const slipSL = signal.stopLoss * (1 + slippageMult);
        return { signal, entryPrice, exitPrice: slipSL, exitReason: "STOP", grossR: -1, netR: -1 - feeCostR, feeCostR, maxDrawdownPct, maxProfitPct, durationBars: i - entryBarIndex, ambiguous: true, onFlaggedBar };
      }

      if (slHit) {
        const slipSL = signal.stopLoss * (1 + slippageMult);
        return { signal, entryPrice, exitPrice: slipSL, exitReason: "STOP", grossR: -1, netR: -1 - feeCostR, feeCostR, maxDrawdownPct, maxProfitPct, durationBars: i - entryBarIndex, ambiguous: false, onFlaggedBar };
      }

      if (tp2Hit) {
        const reward = entryPrice - signal.takeProfit2;
        const grossR = reward / risk;
        return { signal, entryPrice, exitPrice: signal.takeProfit2, exitReason: "TP2", grossR, netR: grossR - feeCostR, feeCostR, maxDrawdownPct, maxProfitPct, durationBars: i - entryBarIndex, ambiguous: false, onFlaggedBar };
      }

      if (tp1Hit) {
        const reward = entryPrice - signal.takeProfit1;
        const grossR = reward / risk;
        return { signal, entryPrice, exitPrice: signal.takeProfit1, exitReason: "TP1", grossR, netR: grossR - feeCostR, feeCostR, maxDrawdownPct, maxProfitPct, durationBars: i - entryBarIndex, ambiguous: false, onFlaggedBar };
      }
    }
  }

  // Expired
  const lastBar = candles[Math.min(endBar, candles.length) - 1];
  const exitPrice = lastBar?.close ?? entryPrice;
  const unrealizedPnl = signal.direction === Direction.LONG
    ? (exitPrice - entryPrice) : (entryPrice - exitPrice);
  const grossR = unrealizedPnl / risk;

  return {
    signal, entryPrice, exitPrice,
    exitReason: "EXPIRED",
    grossR, netR: grossR - feeCostR, feeCostR,
    maxDrawdownPct, maxProfitPct,
    durationBars: cfg.maxHoldBars,
    ambiguous: false, onFlaggedBar,
  };
}

// ─── Equity Curve ──────────────────────────────────────────────────────────────

function computeMaxEquityDrawdownR(results: BacktestSignalResult[]): number {
  let cumR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;

  for (const r of results) {
    cumR += r.netR;
    peakR = Math.max(peakR, cumR);
    const drawdown = peakR - cumR;
    maxDrawdownR = Math.max(maxDrawdownR, drawdown);
  }

  return maxDrawdownR;
}

// ─── Stats ─────────────────────────────────────────────────────────────────────

function computeStats(results: BacktestSignalResult[]): StrategyStats {
  if (results.length === 0) return { count: 0, wins: 0, losses: 0, winRate: 0, avgR: 0 };
  const wins = results.filter((r) => r.netR > 0).length;
  const losses = results.filter((r) => r.netR < 0).length;
  const avgR = results.reduce((sum, r) => sum + r.netR, 0) / results.length;
  return { count: results.length, wins, losses, winRate: wins / results.length, avgR };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export async function runBacktest(
  symbol: string,
  timeframe: string,
  days = 30,
  configOverrides: Partial<BacktestConfig> = {}
): Promise<BacktestSummary> {
  const cfg: BacktestConfig = { ...DEFAULT_CONFIG, ...configOverrides };

  const runId = createHash("sha256")
    .update(`${symbol}-${timeframe}-${days}-${Date.now()}`)
    .digest("hex").slice(0, 16);

  const barsPerDay: Record<string, number> = { "15m": 96, "1h": 24, "4h": 6, "1d": 1 };
  const limit = Math.min((barsPerDay[timeframe] ?? 24) * days + 200, 1500);

  logger.info(
    `Backtest [${runId}]: ${symbol} ${timeframe} | ${days}d | ` +
    `slip=${cfg.slippageBps}bps fee=${cfg.roundTripFeeBps}bps`
  );

  const candles = await getOHLCV(symbol, timeframe, limit);
  if (candles.length < 250) {
    logger.error(`Insufficient candle data: ${candles.length} bars`);
    return emptyResult(runId, symbol, timeframe, days, cfg, candles.length);
  }

  const flaggedBars = flagDataQuality(candles);
  if (flaggedBars.size > 0) {
    logger.warn(`Data quality: ${flaggedBars.size} flagged bars (zero volume or >10% gap)`);
  }

  const results: BacktestSignalResult[] = [];
  let signalsGenerated = 0;
  let signalsPublished = 0;
  let activeUntil = 0;

  for (let i = 200; i < candles.length - cfg.maxHoldBars - 1; i += cfg.scanEveryN) {
    if (i < activeUntil) continue;

    const snapshot = buildHistoricalSnapshot(symbol, timeframe, candles, i);
    if (!snapshot) continue;

    const candidates = runAllStrategies(snapshot);
    signalsGenerated += candidates.length;
    if (candidates.length === 0) continue;

    const scored = [];
    for (const c of candidates) {
      scored.push(await applyGlobalScoring(c, snapshot));
    }

    const ranked = rankCandidates(scored);
    const best = selectBestCandidate(ranked);
    if (!shouldPublish(best)) continue;

    signalsPublished++;
    const signal = toFinalSignal(best!, snapshot);
    const outcome = simulateOutcome(signal, candles, i, cfg, flaggedBars);
    if (!outcome) continue;

    results.push(outcome);

    try {
      insertBacktestResult({
        id: `bt_${runId}_${signalsPublished}`,
        run_id: runId,
        symbol: signal.symbol, timeframe: signal.timeframe,
        strategy_type: signal.strategyType, direction: signal.direction,
        regime: signal.regime, confidence: signal.confidence,
        entry_price: outcome.entryPrice, exit_price: outcome.exitPrice,
        exit_reason: outcome.exitReason,
        realized_r: outcome.netR,
        max_drawdown_pct: outcome.maxDrawdownPct,
        max_profit_pct: outcome.maxProfitPct,
        duration_bars: outcome.durationBars,
        final_score: signal.finalScore,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.warn("Failed to persist backtest result", { err });
    }

    activeUntil = i + outcome.durationBars + 1; // +1 for entry bar delay
  }

  // Aggregate
  const wins = results.filter((r) => r.netR > 0).length;
  const losses = results.filter((r) => r.netR < 0).length;
  const partials = results.filter((r) => r.exitReason === "TP1").length;
  const expired = results.filter((r) => r.exitReason === "EXPIRED").length;
  const ambiguousCount = results.filter((r) => r.ambiguous).length;

  const grossAvgR = results.length > 0 ? results.reduce((s, r) => s + r.grossR, 0) / results.length : 0;
  const netAvgR = results.length > 0 ? results.reduce((s, r) => s + r.netR, 0) / results.length : 0;
  const grossWinRate = results.length > 0 ? results.filter(r => r.grossR > 0).length / results.length : 0;
  const netWinRate = results.length > 0 ? wins / results.length : 0;

  const grossProfit = results.filter((r) => r.netR > 0).reduce((s, r) => s + r.netR, 0);
  const grossLoss = Math.abs(results.filter((r) => r.netR < 0).reduce((s, r) => s + r.netR, 0));
  const netProfitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const maxEquityDrawdownR = computeMaxEquityDrawdownR(results);
  const maxTradeDrawdownPct = results.length > 0 ? Math.max(...results.map(r => r.maxDrawdownPct)) : 0;

  // Group by
  const byStrategy: Record<string, BacktestSignalResult[]> = {};
  const byConfidence: Record<string, BacktestSignalResult[]> = {};
  const byRegime: Record<string, BacktestSignalResult[]> = {};
  for (const r of results) {
    (byStrategy[r.signal.strategyType] ??= []).push(r);
    (byConfidence[r.signal.confidence] ??= []).push(r);
    (byRegime[r.signal.regime] ??= []).push(r);
  }

  const summary: BacktestSummary = {
    runId, symbol, timeframe, days, config: cfg,
    totalBars: candles.length, flaggedBars: flaggedBars.size,
    signalsGenerated, signalsPublished, ambiguousCount,
    wins, losses, partials, expired,
    grossWinRate, grossAvgR, netWinRate, netAvgR, netProfitFactor,
    maxEquityDrawdownR, maxTradeDrawdownPct,
    byStrategy: Object.fromEntries(Object.entries(byStrategy).map(([k, v]) => [k, computeStats(v)])),
    byConfidence: Object.fromEntries(Object.entries(byConfidence).map(([k, v]) => [k, computeStats(v)])),
    byRegime: Object.fromEntries(Object.entries(byRegime).map(([k, v]) => [k, computeStats(v)])),
  };

  // Persist
  try {
    insertBacktestRun(runId, {
      symbol, timeframe, days,
      totalBars: candles.length, signalsPublished,
      wins, losses, partials, expired,
      winRate: netWinRate, avgR: netAvgR,
      profitFactor: netProfitFactor === Infinity ? 999 : netProfitFactor,
      maxDrawdownPct: maxTradeDrawdownPct,
    });
  } catch (err) {
    logger.warn("Failed to persist backtest run", { err });
  }

  logger.info(
    `Backtest [${runId}] ${symbol} ${timeframe}: ${signalsPublished} signals, ` +
      `${wins}W/${losses}L/${partials}P/${expired}E, ` +
      `gross: WR=${(grossWinRate * 100).toFixed(1)}% avgR=${grossAvgR.toFixed(2)} | ` +
      `net: WR=${(netWinRate * 100).toFixed(1)}% avgR=${netAvgR.toFixed(2)} PF=${netProfitFactor === Infinity ? "∞" : netProfitFactor.toFixed(2)} ` +
      `eqDD=${maxEquityDrawdownR.toFixed(2)}R | ` +
      `${ambiguousCount} ambiguous, ${flaggedBars.size} flagged bars`
  );

  return summary;
}

function emptyResult(runId: string, symbol: string, timeframe: string, days: number, config: BacktestConfig, bars: number): BacktestSummary {
  return {
    runId, symbol, timeframe, days, config,
    totalBars: bars, flaggedBars: 0, signalsGenerated: 0, signalsPublished: 0,
    ambiguousCount: 0, wins: 0, losses: 0, partials: 0, expired: 0,
    grossWinRate: 0, grossAvgR: 0, netWinRate: 0, netAvgR: 0,
    netProfitFactor: 0, maxEquityDrawdownR: 0, maxTradeDrawdownPct: 0,
    byStrategy: {}, byConfidence: {}, byRegime: {},
  };
}
