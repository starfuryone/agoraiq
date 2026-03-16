import { Router, Request, Response } from 'express';
import type { Router as IRouter } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import * as fs from 'fs';

const router: IRouter = Router();
const prisma = new PrismaClient();
router.use(requireAuth as any);

function loadHfKey(): string {
  if (process.env.HUGGINGFACE_API_KEY) return process.env.HUGGINGFACE_API_KEY;
  try {
    const env = fs.readFileSync('/opt/agoraiq/.env', 'utf8');
    const m = env.match(/HUGGINGFACE_API_KEY=(.+)/);
    return m ? m[1].trim().replace(/['"]/g, '') : '';
  } catch { return ''; }
}

const HF_KEY = loadHfKey();
const HF_MODEL = process.env.HUGGINGFACE_MODEL || 'meta-llama/Llama-3.1-8B-Instruct';

console.log('[ai] HF key loaded:', HF_KEY ? HF_KEY.slice(0, 6) + '...' : 'MISSING');

async function callHuggingFace(prompt: string): Promise<string> {
  if (!HF_KEY) throw new Error('HUGGINGFACE_API_KEY not set');
  const url = `https://router.huggingface.co/v1/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: HF_MODEL,
      messages: [
        { role: 'system', content: 'You are a crypto trading signal analyst for AgoraIQ. Give concise, data-driven provider assessments in 2-3 sentences. Focus on strengths, risks, and actionable takeaways. No disclaimers.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 200,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`HF ${res.status}: ${err.slice(0, 200)}`);
  }
  const data: any = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || 'No insight generated.';
}

function num(v: any): number { return typeof v === 'number' ? v : Number(v) || 0; }

router.post('/provider-iq', async (req: Request, res: Response) => {
  try {
    const { providerId } = req.body;
    if (!providerId) { res.status(400).json({ error: 'providerId required' }); return; }

    const rows: any[] = await prisma.$queryRaw`
      SELECT p.name, p.marketplace_tier, p.is_verified, p.trading_style, p.market_type,
        pss.win_rate, pss.expectancy_r, pss.r_stddev, pss.max_drawdown_pct,
        pss.trade_count, pss.profit_factor, pss.data_completeness,
        pss.cherry_pick_score, pss.cherry_delete_rate, pss.sample_confidence
      FROM providers p
      LEFT JOIN provider_stats_snapshot pss ON pss.provider_id = p.id AND pss.period = '30d'
      WHERE p.id = ${providerId}
      LIMIT 1
    `;
    if (rows.length === 0) { res.status(404).json({ error: 'Provider not found' }); return; }

    const p = rows[0];
    const wr = num(p.win_rate);
    const er = num(p.expectancy_r);
    const cherry = num(p.cherry_pick_score);
    const cherryLabel = cherry < 0.15 ? 'Clean' : cherry < 0.35 ? 'Caution' : 'Suspect';

    const prompt = `Analyze this crypto signal provider:
Name: ${p.name}
Tier: ${p.marketplace_tier} | Verified: ${p.is_verified} | Style: ${p.trading_style || 'unknown'}
Win Rate: ${wr.toFixed(1)}% | Expectancy(R): ${er.toFixed(2)} | Profit Factor: ${num(p.profit_factor).toFixed(2)}
Max Drawdown: ${num(p.max_drawdown_pct).toFixed(1)}% | R StdDev: ${num(p.r_stddev).toFixed(2)}
Trade Count: ${num(p.trade_count)} | Data Completeness: ${(num(p.data_completeness) * 100).toFixed(0)}%
Cherry-Pick Score: ${(cherry * 100).toFixed(0)}% (${cherryLabel}) | Delete Rate: ${(num(p.cherry_delete_rate) * 100).toFixed(1)}%
Sample Confidence: ${p.sample_confidence || 'unknown'}

Give a 2-3 sentence assessment of this provider's quality, reliability, and any red flags.`;

    const text = await callHuggingFace(prompt);
    res.json({ text });
  } catch (err: any) {
    console.error('[ai/provider-iq]', err.message);
    res.status(500).json({ text: 'Unable to generate insight: ' + err.message });
  }
});

export default router;
