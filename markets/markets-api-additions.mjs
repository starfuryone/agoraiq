// ═══════════════════════════════════════════════════════════════════════════════
// AgoraIQ Market Intelligence — Markets API routes (v7 addition)
// Drop these routes into server.mjs BEFORE the error handler
// ═══════════════════════════════════════════════════════════════════════════════
//
// Also add these imports at the top of server.mjs:
//   import { WebSocketServer } from 'ws';
//   import { createServer }    from 'http';
//
// And wrap the express app with createServer + ws:
//   const httpServer = createServer(app);
//   const wss = new WebSocketServer({ server: httpServer, path: '/ws/markets' });
//
// Replace: app.listen(PORT, '127.0.0.1', ...)
// With:    httpServer.listen(PORT, '127.0.0.1', ...)
//
// ─── WebSocket broadcast helper ───────────────────────────────────────────────
//
//   function wsBroadcast(channel, payload) {
//     const msg = JSON.stringify({ channel, ...payload });
//     wss.clients.forEach(client => {
//       if (client.readyState === 1) client.send(msg);
//     });
//   }
//
// ─── WebSocket connection handler ─────────────────────────────────────────────
//
//   wss.on('connection', (ws) => {
//     ws.send(JSON.stringify({ channel: 'connected', ts: new Date().toISOString() }));
//     ws.on('error', () => {});
//   });
//
// ═══════════════════════════════════════════════════════════════════════════════

// ── Helper: parse multi-sort param ───────────────────────────────────────────
// sort=liquidityScore:desc,volume24h:desc → SQL ORDER BY clause
function parseSortParam(sortStr, allowedColumns) {
  if (!sortStr) return null;
  const parts = sortStr.split(',').map(s => s.trim()).filter(Boolean);
  const clauses = [];

  for (const part of parts) {
    const [col, dir] = part.split(':');
    if (!allowedColumns.includes(col)) continue;
    const direction = (dir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    // Map friendly names to SQL columns
    const colMap = {
      exchange:        'mp.exchange',
      symbol:          'mp.symbol',
      status:          'mp.status',
      tickSize:        'mp."tickSize"',
      marginAvailable: 'mp."marginAvailable"',
      lastSyncedAt:    'mp."lastSyncedAt"',
      spreadBps:       'ms."spreadBps"',
      spreadAbs:       'ms."spreadAbs"',
      volume24h:       'ms."volume24h"',
      volume24hUsd:    'ms."volume24hUsd"',
      liquidityScore:  'ms."liquidityScore"',
      volatilityScore: 'ms."volatilityScore"',
      fundingRate:     'ms."fundingRate"',
      last:            'ms.last',
    };
    const sqlCol = colMap[col] || `mp.${col}`;
    clauses.push(`${sqlCol} ${direction} NULLS LAST`);
  }

  return clauses.length ? clauses.join(', ') : null;
}

const ALLOWED_SORT_COLS = [
  'exchange', 'symbol', 'status', 'tickSize', 'marginAvailable', 'lastSyncedAt',
  'spreadBps', 'spreadAbs', 'volume24h', 'volume24hUsd',
  'liquidityScore', 'volatilityScore', 'fundingRate', 'last',
];

// ── GET /api/v1/markets ───────────────────────────────────────────────────────
// Main grid endpoint — paginated, server-side filtered and sorted
// MarketPair joined with latest MarketStat snapshot
app.get('/api/v1/markets', async (req, res) => {
  try {
    const pageSize  = Math.min(parseInt(req.query.pageSize || '200'), 2000);
    const page      = Math.max(parseInt(req.query.page || '1'), 1);
    const offset    = (page - 1) * pageSize;

    const {
      exchanges, search, base, quote, status, marginAvailable,
      minVolume, maxSpreadBps, sort,
    } = req.query;

    const conditions = ['1=1'];
    const params = [];

    // Exchange filter (comma-separated list)
    if (exchanges) {
      const list = exchanges.split(',').map(e => e.trim().toUpperCase()).filter(Boolean);
      params.push(list);
      conditions.push(`mp.exchange = ANY($${params.length})`);
    }

    // Status filter
    if (status) {
      const list = status.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      params.push(list);
      conditions.push(`mp.status = ANY($${params.length})`);
    }

    // Search (symbol / base / quote / pairId / tvSymbol)
    if (search) {
      params.push(`%${search.toUpperCase()}%`);
      const n = params.length;
      conditions.push(`(
        UPPER(mp.symbol) LIKE $${n} OR
        UPPER(mp."baseCanonical") LIKE $${n} OR
        UPPER(mp."quoteCanonical") LIKE $${n} OR
        UPPER(mp."pairId") LIKE $${n} OR
        UPPER(mp."tvSymbol") LIKE $${n}
      )`);
    }

    // Base asset filter
    if (base) {
      params.push(base.toUpperCase());
      conditions.push(`mp."baseCanonical" = $${params.length}`);
    }

    // Quote filter
    if (quote) {
      params.push(quote.toUpperCase());
      conditions.push(`mp."quoteCanonical" = $${params.length}`);
    }

    // Margin filter
    if (marginAvailable === 'true') {
      conditions.push(`mp."marginAvailable" = TRUE`);
    }

    // Minimum 24h volume
    if (minVolume) {
      params.push(parseFloat(minVolume));
      conditions.push(`ms."volume24h" >= $${params.length}`);
    }

    // Max spread bps
    if (maxSpreadBps) {
      params.push(parseFloat(maxSpreadBps));
      conditions.push(`ms."spreadBps" <= $${params.length}`);
    }

    const where = conditions.join(' AND ');

    // Sort
    const orderBy = parseSortParam(sort, ALLOWED_SORT_COLS) ||
      `ms."liquidityScore" DESC NULLS LAST, ms."volume24h" DESC NULLS LAST, mp.symbol ASC`;

    // Count
    const countRes = await query(
      `SELECT COUNT(*) AS total
       FROM market_pairs mp
       LEFT JOIN market_stats_latest ms ON ms.exchange = mp.exchange AND ms."pairId" = mp."pairId"
       WHERE ${where}`,
      params
    );

    // Data — join market_pairs + latest stats + exchange meta
    params.push(pageSize, offset);
    const dataRes = await query(
      `SELECT
         mp.id, mp.exchange, mp."pairId", mp.symbol,
         mp."baseCanonical", mp."quoteCanonical", mp."tvSymbol",
         mp.status, mp."tickSize", mp."orderMin", mp."orderMinValue",
         mp."pairDecimals", mp."lotDecimals", mp."marginAvailable",
         mp."lastSyncedAt",
         -- Live stats (may be null if never synced)
         ms.bid, ms.ask, ms.last,
         ms."spreadAbs", ms."spreadBps",
         ms."volume24h", ms."volume24hUsd",
         ms."fundingRate", ms."liquidityScore", ms."volatilityScore",
         ms.ts AS "statTs",
         -- Exchange meta
         em."displayName" AS "exchangeDisplayName",
         em.tier AS "exchangeTier"
       FROM market_pairs mp
       LEFT JOIN market_stats_latest ms
         ON ms.exchange = mp.exchange AND ms."pairId" = mp."pairId"
       LEFT JOIN exchange_meta em
         ON em.exchange = mp.exchange
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data:      dataRes.rows,
      total:     parseInt(countRes.rows[0].total),
      page,
      pageSize,
      pages:     Math.ceil(parseInt(countRes.rows[0].total) / pageSize),
    });
  } catch (err) {
    console.error('[API] /markets error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/v1/markets/compare ───────────────────────────────────────────────
// Cross-exchange comparison for a given base/quote pair
app.get('/api/v1/markets/compare', async (req, res) => {
  try {
    const { base, quote, symbol } = req.query;

    if (!base && !quote && !symbol) {
      return res.status(400).json({ error: 'base+quote or symbol required' });
    }

    const conditions = [];
    const params = [];

    if (symbol) {
      params.push(symbol.toUpperCase());
      conditions.push(`mp.symbol = $${params.length}`);
    } else {
      if (base)  { params.push(base.toUpperCase());  conditions.push(`mp."baseCanonical" = $${params.length}`); }
      if (quote) { params.push(quote.toUpperCase()); conditions.push(`mp."quoteCanonical" = $${params.length}`); }
    }

    const where = conditions.join(' AND ');

    const result = await query(
      `SELECT
         mp.exchange, mp."pairId", mp.symbol, mp."tvSymbol", mp.status,
         mp."marginAvailable",
         ms.bid, ms.ask, ms.last,
         ms."spreadAbs", ms."spreadBps",
         ms."volume24h", ms."volume24hUsd",
         ms."liquidityScore", ms."volatilityScore",
         ms."fundingRate", ms.ts AS "statTs",
         em."displayName", em.tier
       FROM market_pairs mp
       LEFT JOIN market_stats_latest ms ON ms.exchange = mp.exchange AND ms."pairId" = mp."pairId"
       LEFT JOIN exchange_meta em ON em.exchange = mp.exchange
       WHERE ${where} AND mp.status IN ('ONLINE','POST_ONLY','LIMIT_ONLY')
       ORDER BY ms."volume24h" DESC NULLS LAST`,
      params
    );

    // Tag the "best" exchange by spread, then volume
    const rows = result.rows;
    if (rows.length > 0) {
      const bestSpread  = rows.filter(r => r.spreadBps != null)
        .sort((a, b) => parseFloat(a.spreadBps) - parseFloat(b.spreadBps))[0];
      const bestVolume  = rows.filter(r => r.volume24h != null)
        .sort((a, b) => parseFloat(b.volume24h) - parseFloat(a.volume24h))[0];
      const bestLiq     = rows.filter(r => r.liquidityScore != null)
        .sort((a, b) => b.liquidityScore - a.liquidityScore)[0];

      rows.forEach(r => {
        r.isBestSpread = bestSpread && r.exchange === bestSpread.exchange;
        r.isBestVolume = bestVolume && r.exchange === bestVolume.exchange;
        r.isBestLiq    = bestLiq    && r.exchange === bestLiq.exchange;
      });
    }

    res.json({ data: rows, symbol: rows[0]?.symbol || symbol || `${base}/${quote}` });
  } catch (err) {
    console.error('[API] /markets/compare error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/v1/markets/:exchange/:pairId ─────────────────────────────────────
// Full row detail — pair + latest stat + recent changelog + sync history
app.get('/api/v1/markets/:exchange/:pairId', async (req, res) => {
  try {
    const { exchange, pairId } = req.params;
    const ex = exchange.toUpperCase();

    const [pairRes, statRes, changelogRes, syncRes, statsHistRes] = await Promise.all([
      // Core pair
      query(
        `SELECT mp.*, em."displayName", em.tier
         FROM market_pairs mp
         LEFT JOIN exchange_meta em ON em.exchange = mp.exchange
         WHERE mp.exchange = $1 AND mp."pairId" = $2`,
        [ex, pairId]
      ),
      // Latest stat
      query(
        `SELECT * FROM market_stats_latest WHERE exchange = $1 AND "pairId" = $2`,
        [ex, pairId]
      ),
      // Recent changelog (last 50)
      query(
        `SELECT id, "changeType", "fieldName", "oldValue", "newValue", "detectedAt"
         FROM market_changelog
         WHERE exchange = $1 AND "pairId" = $2
         ORDER BY "detectedAt" DESC LIMIT 50`,
        [ex, pairId]
      ),
      // Recent sync history (last 10)
      query(
        `SELECT id, status, "totalFetched", "totalUpserted", "totalSkipped",
                "totalDelisted", "totalChanges", "durationMs", "errorMessage",
                "startedAt", "completedAt"
         FROM sync_history
         WHERE exchange = $1
         ORDER BY "startedAt" DESC LIMIT 10`,
        [ex]
      ),
      // Stat history (last 24h, for mini-trend)
      query(
        `SELECT ts, last, "spreadBps", "volume24h", "liquidityScore", "volatilityScore"
         FROM market_stats
         WHERE exchange = $1 AND "pairId" = $2
           AND ts > NOW() - INTERVAL '24 hours'
         ORDER BY ts ASC`,
        [ex, pairId]
      ),
    ]);

    if (!pairRes.rows.length) {
      return res.status(404).json({ error: 'Pair not found' });
    }

    res.json({
      pair:         pairRes.rows[0],
      stat:         statRes.rows[0] || null,
      changelog:    changelogRes.rows,
      syncHistory:  syncRes.rows,
      statHistory:  statsHistRes.rows,
    });
  } catch (err) {
    console.error('[API] /markets/:ex/:pair error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/v1/markets/meta/exchanges ────────────────────────────────────────
// Exchange metadata for filter rail + exchange module
app.get('/api/v1/markets/meta/exchanges', async (_req, res) => {
  try {
    const result = await query(
      `SELECT em.*,
         COUNT(mp.id)::int AS "totalPairs",
         COUNT(mp.id) FILTER (WHERE mp.status = 'ONLINE')::int AS "onlinePairs"
       FROM exchange_meta em
       LEFT JOIN market_pairs mp ON mp.exchange = em.exchange
       GROUP BY em.exchange
       ORDER BY em.tier ASC, "totalPairs" DESC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/v1/markets/meta/assets ──────────────────────────────────────────
// Top base/quote assets for filter dropdowns
app.get('/api/v1/markets/meta/assets', async (_req, res) => {
  try {
    const [baseRes, quoteRes] = await Promise.all([
      query(`SELECT "baseCanonical" AS asset, COUNT(*) AS count
             FROM market_pairs WHERE status = 'ONLINE'
             GROUP BY "baseCanonical" ORDER BY count DESC LIMIT 50`),
      query(`SELECT "quoteCanonical" AS asset, COUNT(*) AS count
             FROM market_pairs WHERE status = 'ONLINE'
             GROUP BY "quoteCanonical" ORDER BY count DESC LIMIT 20`),
    ]);
    res.json({
      bases:  baseRes.rows.map(r => ({ asset: r.asset, count: parseInt(r.count) })),
      quotes: quoteRes.rows.map(r => ({ asset: r.asset, count: parseInt(r.count) })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/v1/markets/stats ────────────────────────────────────────────────
// Ingest stat snapshots (from stat collector daemon / external feed)
// Accepts a batch of up to 500 rows
app.post('/api/v1/markets/stats', async (req, res) => {
  try {
    const rows = Array.isArray(req.body) ? req.body : [req.body];
    if (!rows.length) return res.status(400).json({ error: 'Empty payload' });
    if (rows.length > 500) return res.status(400).json({ error: 'Max 500 rows per batch' });

    const values = [];
    const params = [];

    for (const r of rows) {
      if (!r.exchange || !r.pairId) continue;
      const i = params.length;
      params.push(
        r.exchange.toUpperCase(), r.pairId,
        r.bid ?? null, r.ask ?? null, r.last ?? null,
        r.spreadAbs ?? null, r.spreadBps ?? null,
        r.volume24h ?? null, r.volume24hUsd ?? null,
        r.fundingRate ?? null,
        r.liquidityScore ?? null, r.volatilityScore ?? null,
        r.fetchLatencyMs ?? null
      );
      values.push(
        `($${i+1},$${i+2},NOW(),$${i+3},$${i+4},$${i+5},$${i+6},$${i+7},$${i+8},$${i+9},$${i+10},$${i+11},$${i+12},$${i+13})`
      );
    }

    if (!values.length) return res.status(400).json({ error: 'No valid rows' });

    await query(
      `INSERT INTO market_stats
         (exchange,"pairId",ts,bid,ask,last,"spreadAbs","spreadBps","volume24h","volume24hUsd","fundingRate","liquidityScore","volatilityScore","fetchLatencyMs")
       VALUES ${values.join(',')}`,
      params
    );

    // Broadcast to WebSocket clients (call wsBroadcast if wss available)
    // wsBroadcast('markets:snapshots', { rows: rows.map(r => ({ ...r, ts: new Date().toISOString() })) });

    res.json({ inserted: values.length });
  } catch (err) {
    console.error('[API] /markets/stats POST error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/v1/markets/stats/refresh-view ───────────────────────────────────
// Manually refresh the materialized view (also run via cron)
app.post('/api/v1/markets/stats/refresh-view', async (_req, res) => {
  try {
    await query(`REFRESH MATERIALIZED VIEW CONCURRENTLY market_stats_latest`);
    res.json({ ok: true, refreshedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
