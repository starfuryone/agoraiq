// ─────────────────────────────────────────────────────────────────────────────
// backfillSignalCards.ts — Populate formatted_html for existing trades
//
// Zero LLM cost — deterministic renderer only.
//
// Usage:
//   npx ts-node scripts/backfillSignalCards.ts --dry-run
//   npx ts-node scripts/backfillSignalCards.ts
//
// Place at /opt/agoraiq/scripts/backfillSignalCards.ts
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@agoraiq/db'
import {
  tradeToCard,
  renderSignalCard,
  type TradeRow,
} from '@agoraiq/signal-engine'

const BATCH = 100
const DRY = process.argv.includes('--dry-run')

async function main() {
  console.log(`[backfill] Starting${DRY ? ' (DRY RUN)' : ''}...`)

  let processed = 0, rendered = 0, skipped = 0
  let cursor: string | undefined

  while (true) {
    const batch = await db.trade.findMany({
      where: { formattedHtml: null },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true, symbol: true, direction: true, exchange: true,
        leverage: true, entryPrice: true, tpPrice: true, slPrice: true,
        tp1Price: true, tp2Price: true, tp3Price: true, notes: true,
      },
    })

    if (batch.length === 0) break

    for (const t of batch) {
      processed++
      const row: TradeRow = {
        symbol: t.symbol, direction: t.direction, exchange: t.exchange,
        leverage: t.leverage, entryPrice: t.entryPrice, tpPrice: t.tpPrice,
        slPrice: t.slPrice, tp1Price: t.tp1Price, tp2Price: t.tp2Price,
        tp3Price: t.tp3Price, notes: t.notes,
      }
      const card = tradeToCard(row)
      if (!card) { skipped++; continue }

      const html = renderSignalCard(card)
      if (!DRY) {
        await db.trade.update({ where: { id: t.id }, data: { formattedHtml: html } })
      }
      rendered++
    }

    cursor = batch[batch.length - 1].id
    console.log(`[backfill] ${processed} processed (${rendered} rendered, ${skipped} skipped)`)
  }

  console.log(`[backfill] Done. ${processed} total, ${rendered} rendered, ${skipped} skipped`)
  await db.$disconnect()
}

main().catch(err => { console.error('[backfill] Fatal:', err); process.exit(1) })
