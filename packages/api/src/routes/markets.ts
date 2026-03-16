
// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Markets Routes
//
//   GET  /api/v1/markets                        — Main grid (paginated, filtered, sorted)
//   GET  /api/v1/markets/meta/exchanges          — Exchange list + stats
//   GET  /api/v1/markets/meta/assets             — Top base/quote assets
//   GET  /api/v1/markets/compare                 — Cross-exchange compare for a pair
//   GET  /api/v1/markets/:exchange/:pairId        — Full row detail
//   POST /api/v1/markets/stats                   — Ingest stat snapshots (batch)
//   POST /api/v1/markets/stats/refresh-view      — Refresh materialized view
//
// Grid endpoints: public (no auth required) — stats ingest: token-auth
// ═══════════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@agoraiq/db';
import { createLogger } from '@agoraiq/db';
import { SocksProxyAgent } from 'socks-proxy-agent';
const cgAgent = new SocksProxyAgent('socks5://143.198.202.65:1080');

const log = createLogger('markets-routes');

// ── Sort column whitelist → SQL mapping ────────────────────────────────────────
const SORT_COL_MAP: Record<string, string> = {
  exchange:         'mp.exchange',
  symbol:           'mp.symbol',
  status:           'mp.status',
  tickSize:         'mp."tickSize"',
  marginAvailable:  'mp."marginAvailable"',
  lastSyncedAt:     'mp."lastSyncedAt"',
  spreadBps:        'ms."spreadBps"',
  spreadAbs:        'ms."spreadAbs"',
  volume24h:        'ms."volume24h"',
  volume24hUsd:     'ms."volume24hUsd"',
  liquidityScore:   'ms."liquidityScore"',
  volatilityScore:  'ms."volatilityScore"',
  fundingRate:      'ms."fundingRate"',
  last:             'ms.last',
};

function buildOrderBy(sortStr?: string): string {
  if (!sortStr) {
    return 'ms."liquidityScore" DESC NULLS LAST, ms."volume24h" DESC NULLS LAST, mp.symbol ASC';
  }
  const clauses = sortStr
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(part => {
      const [col, rawDir] = part.split(':');
      const sqlCol = SORT_COL_MAP[col];
      if (!sqlCol) return null;
      const dir = (rawDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      return `${sqlCol} ${dir} NULLS LAST`;
    })
    .filter(Boolean);

  return clauses.length
    ? clauses.join(', ')
    : 'ms."liquidityScore" DESC NULLS LAST, ms."volume24h" DESC NULLS LAST, mp.symbol ASC';
}

export function createMarketsRoutes(db: PrismaClient): Router {
  const router = Router();

  // ── GET /meta/exchanges ──────────────────────────────────────────────────────
  // Must be registered BEFORE /:exchange/:pairId to avoid route collision
  router.get('/meta/exchanges', async (_req: Request, res: Response) => {
    try {
      const rows = await db.$queryRawUnsafe(`
        SELECT
          em.exchange,
          em."displayName",
          em.tier,
          em.region,
          em."uptimeScore",
          em."latencyScore",
          em."reliabilityScore",
          em."avgSpreadBps",
          em."apiUptime24h",
          em."lastSyncLatencyMs",
          COUNT(mp.id)::int            AS "totalPairs",
          COUNT(mp.id) FILTER (WHERE mp.status = 'ONLINE')::int AS "onlinePairs"
        FROM exchange_meta em
        LEFT JOIN market_intelligence.market_pairs mp ON mp.exchange = em.exchange
        GROUP BY em.exchange, em."displayName", em.tier, em.region,
                 em."uptimeScore", em."latencyScore", em."reliabilityScore",
                 em."avgSpreadBps", em."apiUptime24h", em."lastSyncLatencyMs"
        ORDER BY em.tier ASC, "totalPairs" DESC
      `);
      res.json({ data: rows });
    } catch (err: any) {
      log.error({ err }, 'GET /meta/exchanges error');
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // ── GET /meta/assets ─────────────────────────────────────────────────────────
  router.get('/meta/assets', async (_req: Request, res: Response) => {
    try {
      const [bases, quotes] = await Promise.all([
        db.$queryRawUnsafe(`
          SELECT "baseCanonical" AS asset, COUNT(*)::int AS count
          FROM market_intelligence.market_pairs WHERE status = 'ONLINE'
          GROUP BY "baseCanonical" ORDER BY count DESC LIMIT 50
        `),
        db.$queryRawUnsafe(`
          SELECT "quoteCanonical" AS asset, COUNT(*)::int AS count
          FROM market_intelligence.market_pairs WHERE status = 'ONLINE'
          GROUP BY "quoteCanonical" ORDER BY count DESC LIMIT 20
        `),
      ]);
      res.json({ bases, quotes });
    } catch (err: any) {
      log.error({ err }, 'GET /meta/assets error');
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // ── GET /compare ─────────────────────────────────────────────────────────────
  router.get('/compare', async (req: Request, res: Response) => {
    try {
      const { base, quote, symbol } = req.query as Record<string, string>;
      if (!base && !quote && !symbol) {
        return res.status(400).json({ error: 'base+quote or symbol required' });
      }

      const conditions: string[] = ["mp.status IN ('ONLINE','POST_ONLY','LIMIT_ONLY')"];
      const params: any[]        = [];

      if (symbol) {
        params.push(symbol.toUpperCase());
        conditions.push(`mp.symbol = $${params.length}`);
      } else {
        if (base)  { params.push(base.toUpperCase());  conditions.push(`mp."baseCanonical" = $${params.length}`); }
        if (quote) { params.push(quote.toUpperCase()); conditions.push(`mp."quoteCanonical" = $${params.length}`); }
      }

      const where = conditions.join(' AND ');

      const rows: any[] = await db.$queryRawUnsafe(`
        SELECT
          mp.exchange, mp."pairId", mp.symbol, mp."tvSymbol", mp.status,
          mp."marginAvailable",
          ms.bid, ms.ask, ms.last,
          ms."spreadAbs", ms."spreadBps",
          ms."volume24h", ms."volume24hUsd",
          ms."liquidityScore", ms."volatilityScore",
          ms."fundingRate", ms.ts AS "statTs",
          em."displayName", em.tier
        FROM market_intelligence.market_pairs mp
        LEFT JOIN market_stats_latest ms
          ON ms.exchange = mp.exchange AND ms."pairId" = mp."pairId"
        LEFT JOIN exchange_meta em ON em.exchange = mp.exchange
        WHERE ${where}
        ORDER BY ms."volume24h" DESC NULLS LAST
      `, ...params);

      // Tag best exchange per metric
      if (rows.length > 0) {
        const withSpread  = rows.filter(r => r.spreadBps != null);
        const withVolume  = rows.filter(r => r.volume24h != null);
        const withLiq     = rows.filter(r => r.liquidityScore != null);

        const bestSpread  = withSpread.sort((a, b) => Number(a.spreadBps) - Number(b.spreadBps))[0];
        const bestVolume  = withVolume.sort((a, b) => Number(b.volume24h) - Number(a.volume24h))[0];
        const bestLiq     = withLiq.sort((a, b) => Number(b.liquidityScore) - Number(a.liquidityScore))[0];

        rows.forEach(r => {
          r.isBestSpread = bestSpread && r.exchange === bestSpread.exchange;
          r.isBestVolume = bestVolume && r.exchange === bestVolume.exchange;
          r.isBestLiq    = bestLiq    && r.exchange === bestLiq.exchange;
        });
      }

      res.json({ data: rows, symbol: rows[0]?.symbol || symbol || `${base}/${quote}` });
    } catch (err: any) {
      log.error({ err }, 'GET /compare error');
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // ── POST /stats/refresh-view ─────────────────────────────────────────────────
  router.post('/stats/refresh-view', async (_req: Request, res: Response) => {
    try {
      await db.$executeRawUnsafe(
        `REFRESH MATERIALIZED VIEW CONCURRENTLY market_stats_latest`
      );
      res.json({ ok: true, refreshedAt: new Date().toISOString() });
    } catch (err: any) {
      log.error({ err }, 'POST /stats/refresh-view error');
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // ── POST /stats ──────────────────────────────────────────────────────────────
  // Ingest market stat snapshots in batch (max 500 rows)
  router.post('/stats', async (req: Request, res: Response) => {
    try {
      const rows = Array.isArray(req.body) ? req.body : [req.body];
      if (!rows.length)   return res.status(400).json({ error: 'Empty payload' });
      if (rows.length > 500) return res.status(400).json({ error: 'Max 500 rows per batch' });

      const values: string[] = [];
      const params: any[]    = [];

      for (const r of rows) {
        if (!r.exchange || !r.pairId) continue;
        const i = params.length;
        params.push(
          String(r.exchange).toUpperCase(),
          String(r.pairId),
          r.bid            ?? null,
          r.ask            ?? null,
          r.last           ?? null,
          r.spreadAbs      ?? null,
          r.spreadBps      ?? null,
          r.volume24h      ?? null,
          r.volume24hUsd   ?? null,
          r.fundingRate    ?? null,
          r.liquidityScore  != null ? Math.round(r.liquidityScore)  : null,
          r.volatilityScore != null ? Math.round(r.volatilityScore) : null,
          r.fetchLatencyMs ?? null
        );
        values.push(
          `($${i+1},$${i+2},NOW(),$${i+3},$${i+4},$${i+5},$${i+6},$${i+7},$${i+8},$${i+9},$${i+10},$${i+11},$${i+12},$${i+13})`
        );
      }

      if (!values.length) return res.status(400).json({ error: 'No valid rows' });

      await db.$executeRawUnsafe(
        `INSERT INTO market_stats
           (exchange,"pairId",ts,bid,ask,last,"spreadAbs","spreadBps",
            "volume24h","volume24hUsd","fundingRate","liquidityScore","volatilityScore","fetchLatencyMs")
         VALUES ${values.join(',')}`,
        ...params
      );

      res.json({ inserted: values.length });
    } catch (err: any) {
      log.error({ err }, 'POST /stats error');
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // ── GET / (main grid) ────────────────────────────────────────────────────────
  router.get('/', async (req: Request, res: Response) => {
    try {
      const pageSize = Math.min(parseInt(req.query.pageSize as string || '200', 10), 2000);
      const page     = Math.max(parseInt(req.query.page     as string || '1',   10), 1);
      const offset   = (page - 1) * pageSize;

      const {
        exchanges, search, base, quote, status,
        marginAvailable, minVolume, maxSpreadBps, sort,
      } = req.query as Record<string, string>;

      const conditions: string[] = ['1=1'];
      const params: any[]        = [];

      // Exchange filter (comma-separated)
      if (exchanges) {
        const list = exchanges.split(',').map(e => e.trim().toUpperCase()).filter(Boolean);
        if (list.length > 0) {
          params.push(list);
          conditions.push(`mp.exchange = ANY($${params.length})`);
        }
      }

      // Status filter (comma-separated)
      if (status) {
        const list = status.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        if (list.length > 0) {
          params.push(list);
          conditions.push(`mp.status = ANY($${params.length})`);
        }
      }

      // Search
      if (search) {
        params.push(`%${search.toUpperCase()}%`);
        const n = params.length;
        conditions.push(`(
          UPPER(mp.symbol)           LIKE $${n} OR
          UPPER(mp."baseCanonical")  LIKE $${n} OR
          UPPER(mp."quoteCanonical") LIKE $${n} OR
          UPPER(mp."pairId")         LIKE $${n} OR
          UPPER(COALESCE(mp."tvSymbol",'')) LIKE $${n}
        )`);
      }

      // Base asset
      if (base) {
        params.push(base.toUpperCase());
        conditions.push(`mp."baseCanonical" = $${params.length}`);
      }

      // Quote asset
      if (quote) {
        params.push(quote.toUpperCase());
        conditions.push(`mp."quoteCanonical" = $${params.length}`);
      }

      // Margin only
      if (marginAvailable === 'true') {
        conditions.push(`mp."marginAvailable" = TRUE`);
      }

      // Min volume
      if (minVolume) {
        params.push(parseFloat(minVolume));
        conditions.push(`ms."volume24h" >= $${params.length}`);
      }

      // Max spread bps
      if (maxSpreadBps) {
        params.push(parseFloat(maxSpreadBps));
        conditions.push(`ms."spreadBps" <= $${params.length}`);
      }

      const where   = conditions.join(' AND ');
      const orderBy = buildOrderBy(sort);

      // Count query
      const countResult: any[] = await db.$queryRawUnsafe(`
        SELECT COUNT(*)::int AS total
        FROM market_intelligence.market_pairs mp
        LEFT JOIN market_stats_latest ms
          ON ms.exchange = mp.exchange AND ms."pairId" = mp."pairId"
        WHERE ${where}
      `, ...params);

      const total = countResult[0]?.total ?? 0;

      // Data query
      params.push(pageSize, offset);
      const rows = await db.$queryRawUnsafe(`
        SELECT
          mp.id, mp.exchange, mp."pairId", mp.symbol,
          mp."baseCanonical", mp."quoteCanonical", mp."tvSymbol",
          mp.status, mp."tickSize", mp."orderMin", mp."orderMinValue",
          mp."pairDecimals", mp."lotDecimals", mp."marginAvailable",
          mp."lastSyncedAt",
          ms.bid, ms.ask, ms.last,
          ms."spreadAbs", ms."spreadBps",
          ms."volume24h", ms."volume24hUsd",
          ms."fundingRate", ms."liquidityScore", ms."volatilityScore",
          ms.ts AS "statTs",
          em."displayName" AS "exchangeDisplayName",
          em.tier          AS "exchangeTier"
        FROM market_intelligence.market_pairs mp
        LEFT JOIN market_stats_latest ms
          ON ms.exchange = mp.exchange AND ms."pairId" = mp."pairId"
        LEFT JOIN exchange_meta em ON em.exchange = mp.exchange
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `, ...params);

      res.json({
        data:     rows,
        total,
        page,
        pageSize,
        pages:    Math.ceil(total / pageSize),
      });
    } catch (err: any) {
      log.error({ err }, 'GET /markets error');
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // ── GET /:exchange/:pairId ────────────────────────────────────────────────────
  // Full row detail: pair + latest stat + changelog + sync history + stat history
  router.get('/:exchange/:pairId', async (req: Request, res: Response) => {
    try {
      const exchange = (req.params.exchange as string).toUpperCase();
      const pairId   = req.params.pairId as string;

      const [pairRows, statRows, changelogRows, syncRows, historyRows] =
        await Promise.all([
          db.$queryRawUnsafe(`
            SELECT mp.*, em."displayName", em.tier
            FROM market_intelligence.market_pairs mp
            LEFT JOIN exchange_meta em ON em.exchange = mp.exchange
            WHERE mp.exchange = $1 AND mp."pairId" = $2
          `, exchange, pairId),

          db.$queryRawUnsafe(`
            SELECT * FROM market_stats_latest
            WHERE exchange = $1 AND "pairId" = $2
          `, exchange, pairId),

          db.$queryRawUnsafe(`
            SELECT id, "changeType", "fieldName", "oldValue", "newValue", "detectedAt"
            FROM market_intelligence.market_changelog
            WHERE exchange = $1 AND "pairId" = $2
            ORDER BY "detectedAt" DESC LIMIT 50
          `, exchange, pairId),

          db.$queryRawUnsafe(`
            SELECT id, status, "totalFetched", "totalUpserted", "totalSkipped",
                   "totalDelisted", "totalChanges", "durationMs",
                   "errorMessage", "startedAt", "completedAt"
            FROM market_intelligence.sync_history
            WHERE exchange = $1
            ORDER BY "startedAt" DESC LIMIT 10
          `, exchange),

          db.$queryRawUnsafe(`
            SELECT ts, last, "spreadBps", "volume24h", "liquidityScore", "volatilityScore"
            FROM market_stats
            WHERE exchange = $1 AND "pairId" = $2
              AND ts > NOW() - INTERVAL '24 hours'
            ORDER BY ts ASC
          `, exchange, pairId),
        ]) as any[][];

      if (!pairRows.length) {
        return res.status(404).json({ error: 'Pair not found' });
      }

      res.json({
        pair:        pairRows[0],
        stat:        statRows[0]  || null,
        changelog:   changelogRows,
        syncHistory: syncRows,
        statHistory: historyRows,
      });
    } catch (err: any) {
      log.error({ err }, 'GET /markets/:exchange/:pairId error');
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // ── CoinGecko proxy (SOCKS5) ─────────────────────────────────
  router.get('/coins', async (req: Request, res: Response) => {
    try {
      const page     = parseInt(req.query.page     as string || '1',  10);
      const per_page = parseInt(req.query.per_page as string || '50', 10);
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${Math.min(per_page,250)}&page=${page}&sparkline=true&price_change_percentage=24h&locale=en`;
      const r = await fetch(url, { agent: cgAgent } as any);
      if (!r.ok) return res.status(r.status).json({ error: 'CoinGecko error' });
      const data = await r.json();
      res.setHeader('Cache-Control', 'public, max-age=30');
      res.json(data);
    } catch (err: any) {
      log.error({ err }, 'GET /markets/coins proxy error');
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
