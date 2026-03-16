/**
 * @agoraiq/signal-engine — Technical Analysis Utilities
 *
 * Wraps the `technicalindicators` library to compute RSI, MACD, EMA,
 * ATR, Bollinger Bands, and VWAP from raw candle data.
 */

import {
  RSI,
  MACD,
  EMA,
  ATR,
  BollingerBands,
} from "technicalindicators";
import type { Candle } from "../types";

// ─── RSI ───────────────────────────────────────────────────────────────────────

export function computeRSI(closes: number[], period = 14): number {
  const result = RSI.calculate({ values: closes, period });
  return result.length > 0 ? result[result.length - 1] : 50;
}

// ─── MACD ──────────────────────────────────────────────────────────────────────

export interface MACDResult {
  line: number;
  signal: number;
  histogram: number;
}

export function computeMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDResult {
  const result = MACD.calculate({
    values: closes,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const last = result[result.length - 1];
  return {
    line: last?.MACD ?? 0,
    signal: last?.signal ?? 0,
    histogram: last?.histogram ?? 0,
  };
}

// ─── EMA ───────────────────────────────────────────────────────────────────────

export function computeEMA(closes: number[], period: number): number {
  const result = EMA.calculate({ values: closes, period });
  return result.length > 0 ? result[result.length - 1] : closes[closes.length - 1];
}

// ─── ATR ───────────────────────────────────────────────────────────────────────

export function computeATR(candles: Candle[], period = 14): number {
  const result = ATR.calculate({
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    period,
  });
  return result.length > 0 ? result[result.length - 1] : 0;
}

// ─── Bollinger Bands ───────────────────────────────────────────────────────────

export interface BollingerResult {
  upper: number;
  mid: number;
  lower: number;
}

export function computeBollinger(
  closes: number[],
  period = 20,
  stdDev = 2
): BollingerResult {
  const result = BollingerBands.calculate({
    values: closes,
    period,
    stdDev,
  });
  const last = result[result.length - 1];
  return {
    upper: last?.upper ?? closes[closes.length - 1],
    mid: last?.middle ?? closes[closes.length - 1],
    lower: last?.lower ?? closes[closes.length - 1],
  };
}

// ─── VWAP (simple session VWAP from candles) ───────────────────────────────────

export function computeVWAP(candles: Candle[]): number {
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeTPV += typicalPrice * c.volume;
    cumulativeVolume += c.volume;
  }

  return cumulativeVolume > 0
    ? cumulativeTPV / cumulativeVolume
    : candles[candles.length - 1]?.close ?? 0;
}

// ─── Helpers for regime detection ──────────────────────────────────────────────

export function lastNHighs(candles: Candle[], n: number): number[] {
  return candles.slice(-n).map((c) => c.high);
}

export function lastNLows(candles: Candle[], n: number): number[] {
  return candles.slice(-n).map((c) => c.low);
}
