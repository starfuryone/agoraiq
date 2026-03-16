import { Router, Request, Response } from 'express';
import type { Router as IRouter } from 'express';
import { PrismaClient } from '@prisma/client';

import { requireAuth } from '../middleware/auth';

const router: IRouter = Router();
router.use(requireAuth as any);
const prisma = new PrismaClient();

interface StatsRow {
  win_rate: number | null;
  expectancy_r: number | null;
  r_stddev: number | null;
  data_completeness: number | null;
  cherry_pick_score: number | null;
}

function computeIqScore(stats: StatsRow): number {
  const wr  = Math.min(Number(stats.win_rate) || 0, 100);
  const rr  = Math.min(Math.max((Number(stats.expectancy_r) || 0) * 40, 0), 100);
  const dq  = Math.min((Number(stats.data_completeness) || 0) * 100, 100);
  const con = Math.max(0, 100 - (Number(stats.r_stddev) || 2) * 50);
  const ac  = Math.max(0, (1 - (Number(stats.cherry_pick_score) || 0)) * 100);
  const raw = wr * 0.30 + rr * 0.25 + dq * 0.20 + con * 0.15 + ac * 0.10;
  return Math.round(Math.min(Math.max(raw, 0), 100));
}

function num(v: any): number { return typeof v === 'number' ? v : Number(v) || 0; }

router.get('/', async (req: Request, res: Response) => {
  try {
    const sortParam = (req.query.sort as string) || 'iq_desc';
    const rows: any[] = await prisma.$queryRaw`
      SELECT DISTINCT ON (p.id)
        p.id, p.name, p.slug, p.description,
        p.marketplace_tier, p.is_verified,
        p.trading_style, p.market_type, p.exchange_focus,
        p.channel_type, p.subscriber_count,
        pss.win_rate, pss.expectancy_r, pss.vol_adj_expectancy,
        pss.r_stddev, pss.max_drawdown_pct, pss.trade_count,
        pss.profit_factor, pss.data_completeness,
        pss.cherry_pick_score, pss.cherry_delete_rate,
        pss.cherry_edit_rate, pss.cherry_unresolved_rate,
        pss.cherry_announce_ratio, pss.cherry_confidence,
        pss.sample_confidence
      FROM providers p
      INNER JOIN provider_stats_snapshot pss
        ON pss.provider_id = p.id AND pss.period = '30d'
      WHERE p.marketplace_visible = true
        AND p."isActive" = true
        AND pss.trade_count >= 20
      ORDER BY p.id, pss.computed_at DESC
    `;
    const scored = rows.map((row) => ({
      ...row,
      win_rate: num(row.win_rate), expectancy_r: num(row.expectancy_r),
      vol_adj_expectancy: num(row.vol_adj_expectancy), r_stddev: num(row.r_stddev),
      max_drawdown_pct: num(row.max_drawdown_pct), trade_count: num(row.trade_count),
      profit_factor: num(row.profit_factor), data_completeness: num(row.data_completeness),
      cherry_pick_score: num(row.cherry_pick_score), cherry_delete_rate: num(row.cherry_delete_rate),
      cherry_edit_rate: num(row.cherry_edit_rate), cherry_unresolved_rate: num(row.cherry_unresolved_rate),
      cherry_announce_ratio: num(row.cherry_announce_ratio), cherry_confidence: num(row.cherry_confidence),
      subscriber_count: num(row.subscriber_count),
      iq_score: computeIqScore(row),
    }));
    if (sortParam === 'iq_desc') scored.sort((a, b) => b.iq_score - a.iq_score);
    else if (sortParam === 'iq_asc') scored.sort((a, b) => a.iq_score - b.iq_score);
    else if (sortParam === 'win_rate') scored.sort((a, b) => b.win_rate - a.win_rate);
    else if (sortParam === 'trades') scored.sort((a, b) => b.trade_count - a.trade_count);
    const ranked = scored.map((row, i) => ({ ...row, rank: i + 1, delta_7d: null }));
    res.json({ data: ranked, total: ranked.length });
  } catch (err: any) {
    console.error('[provider-iq] List error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        p.id, p.name, p.slug, p.description,
        p.marketplace_tier, p.is_verified,
        p.trading_style, p.market_type, p.exchange_focus,
        p.channel_type, p.subscriber_count,
        pss.win_rate, pss.expectancy_r, pss.vol_adj_expectancy,
        pss.r_stddev, pss.max_drawdown_pct, pss.trade_count,
        pss.profit_factor, pss.data_completeness,
        pss.cherry_pick_score, pss.cherry_delete_rate,
        pss.cherry_edit_rate, pss.cherry_unresolved_rate,
        pss.cherry_announce_ratio, pss.cherry_confidence,
        pss.sample_confidence
      FROM providers p
      LEFT JOIN provider_stats_snapshot pss
        ON pss.provider_id = p.id AND pss.period = '30d'
      WHERE p.id = ${id}
      ORDER BY pss.computed_at DESC NULLS LAST
      LIMIT 1
    `;
    if (rows.length === 0) { res.status(404).json({ error: 'Provider not found' }); return; }
    const raw = rows[0];
    const data = {
      ...raw,
      win_rate: num(raw.win_rate), expectancy_r: num(raw.expectancy_r),
      vol_adj_expectancy: num(raw.vol_adj_expectancy), r_stddev: num(raw.r_stddev),
      max_drawdown_pct: num(raw.max_drawdown_pct), trade_count: num(raw.trade_count || 0),
      profit_factor: num(raw.profit_factor), data_completeness: num(raw.data_completeness),
      cherry_pick_score: num(raw.cherry_pick_score), cherry_delete_rate: num(raw.cherry_delete_rate),
      cherry_edit_rate: num(raw.cherry_edit_rate), cherry_unresolved_rate: num(raw.cherry_unresolved_rate),
      cherry_announce_ratio: num(raw.cherry_announce_ratio), cherry_confidence: num(raw.cherry_confidence),
      subscriber_count: num(raw.subscriber_count || 0),
      iq_score: computeIqScore(raw), rank: 0, delta_7d: null,
    };
    const monthlyRows: any[] = await prisma.$queryRaw`
      SELECT win_rate, expectancy_r, r_stddev, data_completeness, cherry_pick_score
      FROM provider_stats_snapshot
      WHERE provider_id = ${id}
      ORDER BY computed_at ASC
    `;
    const monthly_iq = monthlyRows.map((r: any) => computeIqScore(r));
    const pairRows: any[] = await prisma.$queryRaw`
      SELECT DISTINCT symbol FROM signals
      WHERE "providerId" = ${id} AND symbol IS NOT NULL
      ORDER BY symbol LIMIT 20
    `;
    const pairs = pairRows.map((r: any) => r.symbol).filter(Boolean);
    const badges: string[] = [];
    if (data.is_verified) badges.push('\u2713 Verified');
    if (data.iq_score >= 80) badges.push('\ud83c\udfc6 Top Performer');
    if (data.cherry_pick_score < 0.15) badges.push('\ud83d\udee1 Clean Record');
    if (data.trade_count >= 200) badges.push('\ud83d\udcca High Volume');
    res.json({ data, monthly_iq, pairs, badges });
  } catch (err: any) {
    console.error('[provider-iq] Detail error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
