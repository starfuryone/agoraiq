/**
 * @agoraiq/signal-engine — Math Utilities
 */

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalize a value from [inMin, inMax] to [0, 1].
 * Values outside the range are clamped.
 */
export function normalize(
  value: number,
  inMin: number,
  inMax: number
): number {
  if (inMax === inMin) return 0.5;
  const normalized = (value - inMin) / (inMax - inMin);
  return clamp(normalized, 0, 1);
}

/**
 * Compute expected R multiple from candidate entry/SL/TP.
 * R = reward / risk where risk = |entry - SL| and reward = |TP2 - entry|
 */
export function computeExpectedR(
  entryMid: number,
  stopLoss: number,
  takeProfit2: number
): number {
  const risk = Math.abs(entryMid - stopLoss);
  if (risk === 0) return 0;
  const reward = Math.abs(takeProfit2 - entryMid);
  return parseFloat((reward / risk).toFixed(2));
}

/**
 * Compute the midpoint of an entry zone.
 */
export function entryMid(entryLow: number, entryHigh: number): number {
  return (entryLow + entryHigh) / 2;
}
