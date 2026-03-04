// ═══════════════════════════════════════════════════════════════
// @agoraiq/tracker — Trade Resolution Worker
//
// Scheduled worker that:
//   1. Polls all ACTIVE trades
//   2. For each: fetch current price, check TP/SL hit
//   3. If hit → update status, exitPrice, exitedAt, rMultiple, pnlPct
//   4. If timeout exceeded → mark EXPIRED
//   5. Log to audit_logs
//
// Runs as a separate process via systemd.
// Poll interval configurable via TRACKER_POLL_INTERVAL_MS.
// ═══════════════════════════════════════════════════════════════

import { db, createLogger } from '@agoraiq/db';

const API_PORT = process.env.API_PORT || '4000';
const JWT_SECRET = process.env.JWT_SECRET || '';

async function emitToFeed(trade: any, status: string, rMultiple?: number) {
  try {
    const provider = await db.provider.findUnique({
      where: { id: trade.providerId },
      select: { name: true, slug: true, isVerified: true },
    });
    if (!provider) return;
    await fetch(`http://127.0.0.1:${API_PORT}/api/v1/feed/emit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: JWT_SECRET,
        type: status,
        providerId: trade.providerId,
        providerName: provider.name,
        providerSlug: provider.slug,
        pair: trade.symbol,
        rMultiple: rMultiple ?? 0,
        isVerified: provider.isVerified ?? false,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {}
}
import { checkPriceHit } from './price-service';

const log = createLogger('tracker-worker');

const POLL_INTERVAL = parseInt(process.env.TRACKER_POLL_INTERVAL_MS || '30000', 10);
const BATCH_SIZE = 50;

// ── R-Multiple Calculation ────────────────────────────────────

function calculateRMultiple(
  direction: string,
  entryPrice: number,
  exitPrice: number,
  slPrice: number,
): number {
  if (direction === 'LONG') {
    const risk = entryPrice - slPrice;
    if (risk <= 0) return 0;
    return (exitPrice - entryPrice) / risk;
  } else {
    const risk = slPrice - entryPrice;
    if (risk <= 0) return 0;
    return (entryPrice - exitPrice) / risk;
  }
}

function calculatePnlPct(
  direction: string,
  entryPrice: number,
  exitPrice: number,
  leverage?: number | null,
): number {
  const lev = leverage || 1;
  if (direction === 'LONG') {
    return ((exitPrice - entryPrice) / entryPrice) * 100 * lev;
  } else {
    return ((entryPrice - exitPrice) / entryPrice) * 100 * lev;
  }
}

// ── Resolve Single Trade ──────────────────────────────────────

async function resolveTrade(trade: any): Promise<void> {
  const now = new Date();

  // Check timeout first
  if (trade.timeoutAt && now >= new Date(trade.timeoutAt)) {
    log.info({ tradeId: trade.id, symbol: trade.symbol }, 'Trade expired (timeout)');
    await db.trade.update({
      where: { id: trade.id },
      data: {
        status: 'EXPIRED',
        exitedAt: now,
        exitPrice: null,
        rMultiple: 0,
        pnlPct: 0,
      },
    });
    await auditTradeResolution(trade.id, 'EXPIRED', trade.providerId);
    return;
  }

  // Skip if no entry price or TP/SL — can't resolve yet
  if (!trade.entryPrice) {
    log.debug({ tradeId: trade.id }, 'No entry price yet — skipping');
    return;
  }

  // Fetch current price and check hits
  const result = await checkPriceHit(
    trade.symbol,
    trade.exchange,
    trade.direction,
    trade.tpPrice,
    trade.slPrice,
  );

  if (!result) {
    log.debug({ tradeId: trade.id, symbol: trade.symbol }, 'Price fetch failed — will retry');
    return;
  }

  // If both hit in the same candle, SL takes priority (conservative)
  if (result.hitSL && trade.slPrice) {
    const exitPrice = trade.slPrice;
    const rMultiple = calculateRMultiple(trade.direction, trade.entryPrice, exitPrice, trade.slPrice);
    const pnlPct = calculatePnlPct(trade.direction, trade.entryPrice, exitPrice, trade.leverage);

    await db.trade.update({
      where: { id: trade.id },
      data: {
        status: 'HIT_SL',
        exitPrice,
        exitedAt: now,
        rMultiple: parseFloat(rMultiple.toFixed(4)),
        pnlPct: parseFloat(pnlPct.toFixed(4)),
      },
    });

    log.info({ tradeId: trade.id, symbol: trade.symbol, rMultiple, pnlPct }, 'Trade hit SL');
    await auditTradeResolution(trade.id, 'HIT_SL', trade.providerId);
    return;
  }

  // ── Multi-TP Resolution ──────────────────────────────────
  // Check each TP level independently. When highest TP hit → close trade.
  // When intermediate TP hit → record it, move SL to breakeven or prior TP.
  if (result.hitTP) {
    const now2 = new Date();
    const tpLevels = [
      { field: 'tp1Price' as const, hitField: 'tp1HitAt' as const, price: trade.tp1Price, hitAt: trade.tp1HitAt },
      { field: 'tp2Price' as const, hitField: 'tp2HitAt' as const, price: trade.tp2Price, hitAt: trade.tp2HitAt },
      { field: 'tp3Price' as const, hitField: 'tp3HitAt' as const, price: trade.tp3Price, hitAt: trade.tp3HitAt },
    ].filter(l => l.price != null);

    // If no multi-TP, fall back to single TP
    if (tpLevels.length === 0 && trade.tpPrice) {
      const exitPrice = trade.tpPrice;
      const rMultiple = calculateRMultiple(trade.direction, trade.entryPrice, exitPrice, trade.slPrice || trade.entryPrice);
      const pnlPct = calculatePnlPct(trade.direction, trade.entryPrice, exitPrice, trade.leverage);
      await db.trade.update({
        where: { id: trade.id },
        data: { status: 'HIT_TP', exitPrice, exitedAt: now2, rMultiple: parseFloat(rMultiple.toFixed(4)), pnlPct: parseFloat(pnlPct.toFixed(4)) },
      });
      log.info({ tradeId: trade.id, symbol: trade.symbol, rMultiple, pnlPct }, 'Trade hit TP');
      await auditTradeResolution(trade.id, 'HIT_TP', trade.providerId);
      return;
    }

    // Check which TPs have been hit by current price
    const currentPrice = result.currentPrice;
    const updateData: any = {};
    let newHits = 0;

    for (const level of tpLevels) {
      if (level.hitAt) continue; // Already hit
      const isHit = trade.direction === 'LONG'
        ? currentPrice >= level.price!
        : currentPrice <= level.price!;
      if (isHit) {
        updateData[level.hitField] = now2;
        newHits++;
      }
    }

    if (newHits > 0) {
      const totalHits = (trade.tpHitCount || 0) + newHits;
      const highestTP = tpLevels.filter(l => l.hitAt || updateData[l.hitField]).pop();
      updateData.tpHitCount = totalHits;

      // If ALL TPs hit (or highest TP hit) → close the trade
      const allHit = tpLevels.every(l => l.hitAt || updateData[l.hitField]);
      if (allHit) {
        const exitPrice = highestTP?.price || trade.tpPrice || currentPrice;
        const rMultiple = calculateRMultiple(trade.direction, trade.entryPrice, exitPrice, trade.slPrice || trade.entryPrice);
        const pnlPct = calculatePnlPct(trade.direction, trade.entryPrice, exitPrice, trade.leverage);
        updateData.status = 'HIT_TP';
        updateData.exitPrice = exitPrice;
        updateData.exitedAt = now2;
        updateData.rMultiple = parseFloat(rMultiple.toFixed(4));
        updateData.pnlPct = parseFloat(pnlPct.toFixed(4));
        await db.trade.update({ where: { id: trade.id }, data: updateData });
        log.info({ tradeId: trade.id, symbol: trade.symbol, tpHitCount: totalHits, rMultiple, pnlPct }, 'Trade hit ALL TPs — closed');
        await auditTradeResolution(trade.id, 'HIT_TP', trade.providerId);
        return;
      } else {
        // Partial TP hit — move SL to breakeven after TP1, or to TP1 after TP2
        if (totalHits === 1 && trade.entryPrice) {
          updateData.slPrice = trade.entryPrice; // Move SL to breakeven
          log.info({ tradeId: trade.id, symbol: trade.symbol }, 'TP1 hit — SL moved to breakeven');
        } else if (totalHits === 2 && trade.tp1Price) {
          updateData.slPrice = trade.tp1Price; // Move SL to TP1
          log.info({ tradeId: trade.id, symbol: trade.symbol }, 'TP2 hit — SL moved to TP1');
        }
        await db.trade.update({ where: { id: trade.id }, data: updateData });
        log.info({ tradeId: trade.id, symbol: trade.symbol, tpHitCount: totalHits }, 'Partial TP hit recorded');
        await auditTradeResolution(trade.id, `TP${totalHits}_HIT`, trade.providerId);
        return;
      }
    }
  }

  // Fallback: single TP check (legacy trades without multi-TP)
  if (result.hitTP && trade.tpPrice) {
    const exitPrice = trade.tpPrice;
    const rMultiple = calculateRMultiple(trade.direction, trade.entryPrice, exitPrice, trade.slPrice || trade.entryPrice);
    const pnlPct = calculatePnlPct(trade.direction, trade.entryPrice, exitPrice, trade.leverage);
    await db.trade.update({
      where: { id: trade.id },
      data: { status: 'HIT_TP', exitPrice, exitedAt: now, rMultiple: parseFloat(rMultiple.toFixed(4)), pnlPct: parseFloat(pnlPct.toFixed(4)) },
    });
    log.info({ tradeId: trade.id, symbol: trade.symbol, rMultiple, pnlPct }, 'Trade hit TP (legacy)');
    await auditTradeResolution(trade.id, 'HIT_TP', trade.providerId);
    return;
  }

  log.debug({ tradeId: trade.id, currentPrice: result.currentPrice }, 'Trade still active');
}

// ── Audit Helper ──────────────────────────────────────────────

async function auditTradeResolution(tradeId: string, status: string, providerId: string): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: 'trade.resolved',
        actorType: 'system',
        resourceType: 'trade',
        resourceId: tradeId,
        meta: { status, providerId },
      },
    });
    // Emit to marketplace SSE feed
    if (status === 'HIT_TP' || status === 'HIT_SL') {
      const trade = await db.trade.findUnique({
        where: { id: tradeId },
        select: { providerId: true, symbol: true, rMultiple: true },
      });
      if (trade) {
        await emitToFeed(trade, status, trade.rMultiple ?? undefined);
      }
    }
  } catch (err) {
    log.error({ err }, 'Audit log write failed');
  }
}

// ── Main Poll Loop ────────────────────────────────────────────

async function pollActiveTrades(): Promise<void> {
  try {
    const activeTrades = await db.trade.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    if (activeTrades.length === 0) {
      log.debug('No active trades to resolve');
      return;
    }

    log.info({ count: activeTrades.length }, 'Processing active trades');

    // Process sequentially to respect rate limits on exchange APIs
    for (const trade of activeTrades) {
      try {
        await resolveTrade(trade);
      } catch (err) {
        log.error({ err, tradeId: trade.id }, 'Failed to resolve trade');
      }
      // Small delay between API calls to avoid rate limiting
      await new Promise(r => setTimeout(r, 200));
    }
  } catch (err) {
    log.error({ err }, 'Poll cycle failed');
  }
}

// ── Worker Entrypoint ─────────────────────────────────────────

async function main() {
  log.info({ pollInterval: POLL_INTERVAL }, '🔄 Tracker worker starting');

  // Initial run
  await pollActiveTrades();

  // Schedule recurring polls
  setInterval(pollActiveTrades, POLL_INTERVAL);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    log.info('Received SIGTERM — shutting down');
    await db.$disconnect();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    log.info('Received SIGINT — shutting down');
    await db.$disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  log.error({ err }, 'Tracker worker fatal error');
  process.exit(1);
});
