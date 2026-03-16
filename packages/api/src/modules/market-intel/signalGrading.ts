import { db as prisma } from '@agoraiq/db';

interface GradeInput {
  signalId:   string;
  providerId: string;
  symbol:     string;
  side:       string;
}

export async function gradeSignalAtEntry({ signalId, providerId, symbol, side }: GradeInput): Promise<void> {
  try {
    // Get latest score for this symbol
    const scores = await prisma.$queryRaw<any[]>`
      SELECT score, confidence, "expectedR", "rawInputs"
      FROM market_intel_scores
      WHERE symbol = ${symbol}
      ORDER BY "createdAt" DESC LIMIT 1
    `;
    if (!scores.length) return;

    const s = scores[0];
    const raw = s.rawInputs ?? {};

    const label = getContextLabel(Number(s.score), raw.volatility_regime ?? 0, raw.sentiment_score ?? 0.5);

    await prisma.$executeRaw`
      INSERT INTO signal_grades (
        id, "signalId", "providerId", symbol, side,
        score_at_entry, confidence_at_entry,
        volatility_regime_at_entry, sentiment_at_entry,
        funding_signal_at_entry, volume_spike_at_entry, momentum_at_entry,
        market_context_label, "expectedR_at_entry", "createdAt"
      ) VALUES (
        gen_random_uuid(), ${signalId}, ${providerId}, ${symbol}, ${side},
        ${Number(s.score)}, ${s.confidence ?? 'LOW'},
        ${raw.volatility_regime ?? 0}, ${raw.sentiment_score ?? 0.5},
        ${raw.funding_rate_signal ?? 0}, ${raw.volume_spike ?? 0}, ${raw.momentum_strength ?? 0.5},
        ${label}, ${Number(s.expectedR ?? 0)}, NOW()
      )
      ON CONFLICT ("signalId") DO NOTHING
    `;
  } catch (err) {
    console.error('[signalGrading] Failed to grade signal:', err);
  }
}

function getContextLabel(score: number, vol: number, sent: number): string {
  if (score >= 0.7 && vol >= 0.6) return 'HIGH_PROB_BREAKOUT';
  if (score >= 0.7 && sent >= 0.6) return 'HIGH_PROB_SENTIMENT';
  if (score >= 0.7)                return 'HIGH_PROB_STABLE';
  if (score >= 0.55 && vol >= 0.6) return 'MED_PROB_VOLATILE';
  if (score >= 0.55)               return 'MED_PROB';
  if (vol >= 0.8)                  return 'LOW_PROB_EXTREME_VOL';
  return 'LOW_PROB';
}
