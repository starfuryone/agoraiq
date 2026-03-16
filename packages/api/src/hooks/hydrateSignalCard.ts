// ─────────────────────────────────────────────────────────────────────────────
// hooks/hydrateSignalCard.ts — Post-ingestion hook
//
// Called fire-and-forget after Trade creation. Reads the trade row, maps
// to card input, renders HTML, writes formatted_html back.
//
// Receives db as a parameter — matches the pattern used throughout
// packages/api where PrismaClient is passed from index.ts.
//
// Usage in ingestion.ts:
//   import { hydrateSignalCard } from '../hooks/hydrateSignalCard'
//   if (result.trade) {
//     hydrateSignalCard(result.trade.id, db).catch(err =>
//       log.warn({ err, tradeId: result.trade!.id }, 'Card hydration failed')
//     )
//   }
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@agoraiq/db'
import { createLogger } from '@agoraiq/db'
import {
  tradeToCard,
  renderSignalCard,
  type TradeRow,
} from '@agoraiq/signal-engine'

const log = createLogger('hydrate-card')

export async function hydrateSignalCard(tradeId: string, db: PrismaClient): Promise<void> {
  const trade = await db.trade.findUnique({
    where: { id: tradeId },
    select: {
      id: true,
      symbol: true,
      direction: true,
      exchange: true,
      leverage: true,
      entryPrice: true,
      tpPrice: true,
      slPrice: true,
      tp1Price: true,
      tp2Price: true,
      tp3Price: true,
      notes: true,
      formattedHtml: true,
    },
  })

  if (!trade) {
    log.warn({ tradeId }, 'Trade not found')
    return
  }

  // Already has a card — skip (set force=true in backfill to re-render)
  if (trade.formattedHtml) return

  const row: TradeRow = {
    symbol: trade.symbol,
    direction: trade.direction,
    exchange: trade.exchange,
    leverage: trade.leverage,
    entryPrice: trade.entryPrice,
    tpPrice: trade.tpPrice,
    slPrice: trade.slPrice,
    tp1Price: trade.tp1Price,
    tp2Price: trade.tp2Price,
    tp3Price: trade.tp3Price,
    notes: trade.notes,
  }

  const cardInput = tradeToCard(row)
  if (!cardInput) {
    log.warn({ tradeId }, 'Missing entry price — skipping card')
    return
  }

  const html = renderSignalCard(cardInput)

  await db.trade.update({
    where: { id: tradeId },
    data: { formattedHtml: html },
  })

  log.info({ tradeId, symbol: trade.symbol }, 'Signal card rendered')
}
