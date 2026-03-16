// ─────────────────────────────────────────────────────────────
// packages/db/src/alerts/rule-engine.ts
// Pure evaluation logic — no DB, no side effects
// ─────────────────────────────────────────────────────────────

export type CherryPickRisk = 'LOW' | 'MEDIUM' | 'HIGH';
export type Session = 'london' | 'ny_open' | 'asia' | 'ny_close';
export type Direction = 'LONG' | 'SHORT';

export interface AlertConditions {
  minIQScore?:        number;       // 0–100
  minTruthPassRate?:  number;       // 0–100
  minConfidence?:     number;       // 0–100
  maxCherryPickRisk?: CherryPickRisk;
  pairs?:             string[];     // empty = all
  providers?:         string[];     // empty = all (provider IDs)
  directions?:        Direction[];  // empty = both
  sessions?:          Session[];    // empty = 24h
  minRR?:             number;       // 0 = no floor
  maxLeverage?:       number;       // 0 = no limit
}

export interface AlertChannels {
  web?:      boolean;
  telegram?: boolean;
  email?:    boolean;
  discord?:  boolean;
  webpush?:  boolean;
}

export interface SignalPayload {
  id:               string;
  pair:             string;
  direction:        Direction;
  providerId?:      string;
  providerName?:    string;
  iqScore?:         number;
  truthPassRate?:   number;
  confidence?:      number;
  cherryPickRisk?:  CherryPickRisk;
  rRatio?:          number;
  leverage?:        number;
  timestamp?:       Date;
}

export interface EvalResult {
  pass:       boolean;
  conditions: string[];   // human-readable pass/fail per check (with ✓/✗)
  failures:   string[];   // only failing conditions
}

const RISK_ORDER: Record<CherryPickRisk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

// ── Session detection ─────────────────────────────────────────
const SESSION_RANGES: Record<Session, { utcStart: number; utcEnd: number }> = {
  asia:     { utcStart: 0,  utcEnd: 9  },
  london:   { utcStart: 7,  utcEnd: 16 },
  ny_open:  { utcStart: 13, utcEnd: 17 },
  ny_close: { utcStart: 17, utcEnd: 21 },
};

export function getActiveSessions(date: Date = new Date()): Session[] {
  const h = date.getUTCHours();
  return (Object.entries(SESSION_RANGES) as [Session, { utcStart: number; utcEnd: number }][])
    .filter(([, { utcStart, utcEnd }]) => h >= utcStart && h < utcEnd)
    .map(([name]) => name);
}

// ── Core evaluator ────────────────────────────────────────────
export function evaluateSignalAgainstRule(
  signal: SignalPayload,
  conditions: AlertConditions,
): EvalResult {
  const checks: string[] = [];
  const failures: string[] = [];

  function check(label: string, passes: boolean): void {
    const marker = passes ? '✓' : '✗';
    checks.push(`${label} ${marker}`);
    if (!passes) failures.push(`${label} ${marker}`);
  }

  if (conditions.minIQScore != null && conditions.minIQScore > 0) {
    const v = signal.iqScore ?? 0;
    check(`IQ Score ${v}≥${conditions.minIQScore}`, v >= conditions.minIQScore);
  }

  if (conditions.minTruthPassRate != null && conditions.minTruthPassRate > 0) {
    const v = signal.truthPassRate ?? 0;
    check(`Truth Rate ${v}≥${conditions.minTruthPassRate}`, v >= conditions.minTruthPassRate);
  }

  if (conditions.minConfidence != null && conditions.minConfidence > 0) {
    const v = signal.confidence ?? 0;
    check(`Confidence ${v}≥${conditions.minConfidence}`, v >= conditions.minConfidence);
  }

  if (conditions.maxCherryPickRisk) {
    const signalRisk = signal.cherryPickRisk ?? 'HIGH';
    const passes = RISK_ORDER[signalRisk] <= RISK_ORDER[conditions.maxCherryPickRisk];
    check(`Cherry-pick ${signalRisk}≤${conditions.maxCherryPickRisk}`, passes);
  }

  if (conditions.pairs && conditions.pairs.length > 0) {
    const passes = conditions.pairs.includes(signal.pair);
    check(`Pair ${signal.pair} in [${conditions.pairs.join(',')}]`, passes);
  }

  if (conditions.providers && conditions.providers.length > 0) {
    const passes = conditions.providers.some(
      p => p === signal.providerId || p === signal.providerName,
    );
    check(`Provider ${signal.providerName ?? signal.providerId ?? '?'} in list`, passes);
  }

  if (conditions.directions && conditions.directions.length > 0) {
    const passes = conditions.directions.includes(signal.direction);
    check(`Direction ${signal.direction} in [${conditions.directions.join(',')}]`, passes);
  }

  if (conditions.sessions && conditions.sessions.length > 0) {
    const activeSessions = getActiveSessions(signal.timestamp);
    const passes = conditions.sessions.some(s => activeSessions.includes(s));
    check(`Session [${activeSessions.join(',') || 'none'}] overlaps [${conditions.sessions.join(',')}]`, passes);
  }

  if (conditions.minRR != null && conditions.minRR > 0) {
    const v = signal.rRatio ?? 0;
    check(`R:R ${v.toFixed(1)}≥${conditions.minRR}`, v >= conditions.minRR);
  }

  if (conditions.maxLeverage != null && conditions.maxLeverage > 0) {
    const v = signal.leverage ?? 1;
    check(`Leverage ${v}x≤${conditions.maxLeverage}x`, v <= conditions.maxLeverage);
  }

  return {
    pass:       failures.length === 0,
    conditions: checks,
    failures,
  };
}

// ── Throttle check (accepts `now` for testability) ────────────
export function isThrottled(
  lastFiredAt: Date | null,
  throttleMin: number,
  now: Date = new Date(),
): boolean {
  if (!lastFiredAt) return false;
  const elapsedMs = now.getTime() - lastFiredAt.getTime();
  return elapsedMs < throttleMin * 60_000;
}
