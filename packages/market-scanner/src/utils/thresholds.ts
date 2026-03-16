/**
 * @agoraiq/signal-engine — Per-Symbol Thresholds
 *
 * These are tunable per-asset thresholds used in regime detection,
 * scoring, and strategy evaluation. Start conservative, tune with data.
 */

interface SymbolThresholds {
  /** Minimum volume to not be classified as LOW_LIQUIDITY */
  liquidityThreshold: number;
  /** Volume above this confirms a breakout */
  volumeBreakoutThreshold: number;
  /** Volume above this adds to market structure score */
  volumeConfirmationThreshold: number;
  /** Liquidation value above this adds to market structure score */
  liquidationThreshold: number;
}

const THRESHOLDS: Record<string, SymbolThresholds> = {
  BTC: {
    liquidityThreshold: 500_000,
    volumeBreakoutThreshold: 2_000_000,
    volumeConfirmationThreshold: 1_000_000,
    liquidationThreshold: 5_000_000,
  },
  ETH: {
    liquidityThreshold: 300_000,
    volumeBreakoutThreshold: 1_500_000,
    volumeConfirmationThreshold: 750_000,
    liquidationThreshold: 3_000_000,
  },
  SOL: {
    liquidityThreshold: 100_000,
    volumeBreakoutThreshold: 500_000,
    volumeConfirmationThreshold: 250_000,
    liquidationThreshold: 1_000_000,
  },
  XRP: {
    liquidityThreshold: 100_000,
    volumeBreakoutThreshold: 500_000,
    volumeConfirmationThreshold: 250_000,
    liquidationThreshold: 1_000_000,
  },
};

const DEFAULT_THRESHOLDS: SymbolThresholds = {
  liquidityThreshold: 100_000,
  volumeBreakoutThreshold: 500_000,
  volumeConfirmationThreshold: 250_000,
  liquidationThreshold: 1_000_000,
};

function getThresholds(symbol: string): SymbolThresholds {
  // Strip USDT suffix if present
  const base = symbol.replace(/USDT$/i, "").toUpperCase();
  return THRESHOLDS[base] ?? DEFAULT_THRESHOLDS;
}

export function liquidityThreshold(symbol: string): number {
  return getThresholds(symbol).liquidityThreshold;
}

export function volumeBreakoutThreshold(symbol: string): number {
  return getThresholds(symbol).volumeBreakoutThreshold;
}

export function volumeConfirmationThreshold(symbol: string): number {
  return getThresholds(symbol).volumeConfirmationThreshold;
}

export function liquidationThreshold(symbol: string): number {
  return getThresholds(symbol).liquidationThreshold;
}
