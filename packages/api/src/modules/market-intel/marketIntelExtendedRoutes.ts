import { Router, type Request, type Response } from 'express';
import { marketIntelGuard } from './marketIntelEntitlement';
import { db as prisma } from '@agoraiq/db';

export const marketIntelExtendedRouter: import("express").Router = Router();

marketIntelExtendedRouter.get('/top', ...marketIntelGuard, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '10'), 10), 50);
    const side  = String(req.query.side ?? '').toUpperCase() || null;
    const conf  = String(req.query.conf ?? '').toUpperCase() || null;
    const tag   = String(req.query.tag  ?? '') || null;
    const rows = await prisma.$queryRaw<any[]>`
      SELECT DISTINCT ON (symbol)
        id, symbol, side, score, "probabilityPct", confidence, "expectedR", "rawInputs", "createdAt"
      FROM market_intel_scores
      WHERE "createdAt" > NOW() - INTERVAL '2 hours'
      ORDER BY symbol, "createdAt" DESC
    `;
    let filtered = rows;
    if (side && ['LONG','SHORT'].includes(side)) filtered = filtered.filter(r => r.side === side);
    if (conf && ['HIGH','MED','LOW'].includes(conf)) filtered = filtered.filter(r => r.confidence === conf);
    if (tag === 'high_volatility') filtered = filtered.filter(r => (r.rawInputs?.volatility_regime ?? 0) > 0.6);
    filtered.sort((a, b) => b.score - a.score);
    filtered = filtered.slice(0, limit);
    const enriched = filtered.map(r => ({ ...r, score: Number(r.score), expectedR: Number(r.expectedR) }));
    res.json({ ok: true, data: enriched, meta: { count: enriched.length, generatedAt: new Date().toISOString() } });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Failed to fetch top opportunities' });
  }
});

marketIntelExtendedRouter.get('/score/:symbol', ...marketIntelGuard, async (req: Request, res: Response) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT id, symbol, side, score, "probabilityPct", confidence, "expectedR", "rawInputs", "createdAt"
      FROM market_intel_scores WHERE symbol = ${symbol}
      ORDER BY "createdAt" DESC LIMIT 1
    `;
    if (!rows.length) { res.status(404).json({ ok: false, error: `No score for ${symbol}` }); return; }
    res.json({ ok: true, data: { ...rows[0], score: Number(rows[0].score), expectedR: Number(rows[0].expectedR) } });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

marketIntelExtendedRouter.get('/radar', ...marketIntelGuard, async (req: Request, res: Response) => {
  try {
    const snaps = await prisma.$queryRaw<any[]>`
      SELECT DISTINCT ON (symbol, exchange) symbol, exchange, "normalizedData", "createdAt"
      FROM market_intel_snapshots
      WHERE "createdAt" > NOW() - INTERVAL '30 minutes'
      ORDER BY symbol, exchange, "createdAt" DESC
    `;
    const map = new Map<string, any>();
    for (const s of snaps) {
      const vr = s.normalizedData?.volRatio ?? 1;
      const ex = map.get(s.symbol);
      if (!ex || vr > ex.maxVolRatio) map.set(s.symbol, { symbol: s.symbol, maxVolRatio: vr, exchanges: [s.exchange] });
      else ex.exchanges.push(s.exchange);
    }
    const radar = Array.from(map.values()).sort((a,b) => b.maxVolRatio - a.maxVolRatio).map(r => ({
      ...r,
      regime: r.maxVolRatio >= 3 ? 'extreme' : r.maxVolRatio >= 2 ? 'breakout' : r.maxVolRatio >= 1.5 ? 'elevated' : 'normal',
      heat: Math.min(100, Math.round((r.maxVolRatio - 1) / 2 * 100)),
    }));
    res.json({ ok: true, data: radar });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

marketIntelExtendedRouter.get('/arbitrage-board', ...marketIntelGuard, async (req: Request, res: Response) => {
  try {
    const alerts = await prisma.$queryRaw<any[]>`
      SELECT DISTINCT ON (symbol) id, symbol, exchange, message, severity, metadata, "createdAt"
      FROM market_intel_alerts
      WHERE type = 'arbitrage' AND "createdAt" > NOW() - INTERVAL '2 hours'
      ORDER BY symbol, "createdAt" DESC
    `;
    const board = alerts.map(a => ({
      symbol: a.symbol, buyExchange: a.metadata?.buyExchange, sellExchange: a.metadata?.sellExchange,
      buyPrice: a.metadata?.buyPrice, sellPrice: a.metadata?.sellPrice,
      spreadPct: Number(a.metadata?.spreadPct ?? 0), netProfitPct: Number(a.metadata?.profitPotentialPct ?? 0),
      severity: a.severity, age: Date.now() - new Date(a.createdAt).getTime(),
    })).sort((a,b) => b.spreadPct - a.spreadPct);
    res.json({ ok: true, data: board });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

marketIntelExtendedRouter.get('/provider-alpha', ...marketIntelGuard, async (req: Request, res: Response) => {
  try {
    const alpha = await prisma.$queryRaw<any[]>`
      SELECT sg."providerId", p.name as "providerName", COUNT(*)::int as "totalGraded",
        ROUND(AVG(CASE WHEN sg.score_at_entry >= 0.7 AND t.status = 'HIT_TP' THEN 1.0 WHEN sg.score_at_entry >= 0.7 THEN 0.0 END)::numeric * 100, 1) as "highScoreWinRate",
        ROUND(AVG(CASE WHEN sg.score_at_entry < 0.55 AND t.status = 'HIT_TP' THEN 1.0 WHEN sg.score_at_entry < 0.55 THEN 0.0 END)::numeric * 100, 1) as "lowScoreWinRate",
        ROUND(AVG(CASE WHEN sg.volatility_regime_at_entry >= 0.6 AND t.status = 'HIT_TP' THEN 1.0 WHEN sg.volatility_regime_at_entry >= 0.6 THEN 0.0 END)::numeric * 100, 1) as "highVolWinRate",
        ROUND((AVG(sg.score_at_entry) * 100)::numeric, 1) as "avgScoreAtEntry"
      FROM signal_grades sg
      INNER JOIN trades t ON t."signalId" = sg."signalId" AND t.status IN ('HIT_TP','HIT_SL','EXPIRED')
      INNER JOIN providers p ON p.id = sg."providerId"
      WHERE sg."createdAt" > NOW() - INTERVAL '90 days'
      GROUP BY sg."providerId", p.name HAVING COUNT(*) >= 5
      ORDER BY "highScoreWinRate" DESC NULLS LAST LIMIT 20
    `;
    res.json({ ok: true, data: alpha });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

marketIntelExtendedRouter.get('/signal-grades', ...marketIntelGuard, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10), 100);
    const grades = await prisma.$queryRaw<any[]>`
      SELECT sg.*, p.name as "providerName", t.status as "tradeStatus"
      FROM signal_grades sg
      INNER JOIN providers p ON p.id = sg."providerId"
      LEFT JOIN trades t ON t."signalId" = sg."signalId"
      ORDER BY sg."createdAt" DESC
      LIMIT ${limit}
    `;
    res.json({ ok: true, data: grades });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

export default marketIntelExtendedRouter;
