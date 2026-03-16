// ─────────────────────────────────────────────────────────────────────────────
// cardRenderer.ts — Deterministic Cornix-style HTML card renderer
//
// Lives in @agoraiq/signal-engine alongside formatter.ts.
// formatter.ts → text/embed for Telegram/Discord/Cornix bots
// cardRenderer.ts → HTML cards for the web dashboard
//
// Three input mappers cover every path:
//   tradeToCard()   — from a Prisma Trade row (pipeline signals)
//   cornixToCard()  — from a CornixSignal (output of parseLLM)
//   fieldsToCard()  — from a SignalFields (signal-engine canonical type)
// ─────────────────────────────────────────────────────────────────────────────


// ─── Renderer input ───────────────────────────────────────────────────────────

export interface SignalCardInput {
  pair: string
  direction?: 'LONG' | 'SHORT'
  exchange?: string
  entries: (number | string)[]
  takeProfits: (number | string)[]
  stopLoss?: number | string
  leverage?: string
  tradeType?: string
  comment?: string
}

// ─── Trade row mapper ─────────────────────────────────────────────────────────
// Column names match packages/db/prisma/schema.prisma model Trade exactly.

export interface TradeRow {
  symbol: string
  direction: string               // "LONG" | "SHORT"
  exchange: string                // "BINANCE_FUTURES" etc.
  leverage?: number | null
  entryPrice?: number | null
  tpPrice?: number | null
  slPrice?: number | null
  tp1Price?: number | null
  tp2Price?: number | null
  tp3Price?: number | null
  notes?: string | null
}

export function tradeToCard(t: TradeRow): SignalCardInput | null {
  const entries: number[] = []
  if (t.entryPrice != null) entries.push(t.entryPrice)
  if (entries.length === 0) return null

  const tps: number[] = []
  if (t.tp1Price != null) tps.push(t.tp1Price)
  if (t.tp2Price != null) tps.push(t.tp2Price)
  if (t.tp3Price != null) tps.push(t.tp3Price)
  if (tps.length === 0 && t.tpPrice != null) tps.push(t.tpPrice)

  const dir = t.direction?.toUpperCase()
  const direction: 'LONG' | 'SHORT' | undefined =
    dir === 'LONG' ? 'LONG' : dir === 'SHORT' ? 'SHORT' : undefined

  return {
    pair: t.symbol,
    direction,
    exchange: formatExchange(t.exchange),
    entries,
    takeProfits: tps,
    stopLoss: t.slPrice ?? undefined,
    leverage: t.leverage != null ? `${t.leverage}x` : undefined,
    comment: t.notes ?? undefined,
  }
}

// ─── CornixSignal mapper ─────────────────────────────────────────────────────
// Shape returned by parseLLM() in parsers/llm.ts → result.data

export interface CornixSignalLike {
  pair: string
  direction: 'LONG' | 'SHORT' | null
  exchange?: string | null
  entryMin?: number | null
  entryMax?: number | null
  stopLoss?: number | null
  takeProfits: number[]
  leverage?: number | null
  leverageType?: 'cross' | 'isolated' | null
  marketType?: string | null
}

export function cornixToCard(s: CornixSignalLike): SignalCardInput | null {
  const entries: number[] = []
  if (s.entryMin != null) entries.push(s.entryMin)
  if (s.entryMax != null && s.entryMax !== s.entryMin) entries.push(s.entryMax)
  if (entries.length === 0) return null

  let leverage: string | undefined
  if (s.leverage != null) {
    const prefix = s.leverageType === 'cross' ? 'Cross '
      : s.leverageType === 'isolated' ? 'Isolated '
      : ''
    leverage = `${prefix}${s.leverage}x`
  }

  return {
    pair: s.pair,
    direction: s.direction ?? undefined,
    exchange: s.exchange ? formatExchange(s.exchange) : undefined,
    entries,
    takeProfits: s.takeProfits,
    stopLoss: s.stopLoss ?? undefined,
    leverage,
  }
}


// ─── HTML renderer ────────────────────────────────────────────────────────────

export function renderSignalCard(input: SignalCardInput): string {
  const p: string[] = []

  p.push(`<div class="signal-card">`)

  // Header
  p.push(`  <div class="signal-header">`)
  p.push(`    <h2>${esc(input.pair)}</h2>`)
  if (input.direction) {
    const cls = input.direction === 'LONG' ? 'badge-long' : 'badge-short'
    p.push(`    <span class="signal-badge ${cls}">${input.direction}</span>`)
  }
  p.push(`  </div>`)

  // Meta
  const meta: string[] = []
  if (input.exchange)  meta.push(`    <div><strong>Exchange:</strong> ${esc(input.exchange)}</div>`)
  if (input.tradeType) meta.push(`    <div><strong>Trade Type:</strong> ${esc(input.tradeType)}</div>`)
  if (input.leverage)  meta.push(`    <div><strong>Leverage:</strong> ${esc(input.leverage)}</div>`)
  if (meta.length > 0) {
    p.push(`  <div class="signal-meta">`)
    p.push(...meta)
    p.push(`  </div>`)
  }

  // Entry Targets
  if (input.entries.length > 0) {
    p.push(`  <div class="signal-section">`)
    p.push(`    <h3>Entry Targets</h3>`)
    p.push(`    <ol>`)
    for (const e of input.entries) p.push(`      <li>${esc(String(e))}</li>`)
    p.push(`    </ol>`)
    p.push(`  </div>`)
  }

  // Take Profit Targets
  if (input.takeProfits.length > 0) {
    p.push(`  <div class="signal-section">`)
    p.push(`    <h3>Take Profit Targets</h3>`)
    p.push(`    <ol>`)
    for (const tp of input.takeProfits) p.push(`      <li>${esc(String(tp))}</li>`)
    p.push(`    </ol>`)
    p.push(`  </div>`)
  }

  // Stop Loss
  if (input.stopLoss != null) {
    p.push(`  <div class="signal-section stop-loss">`)
    p.push(`    <h3>Stop Loss</h3>`)
    p.push(`    <p>${esc(String(input.stopLoss))}</p>`)
    p.push(`  </div>`)
  }

  // Comment
  if (input.comment) {
    p.push(`  <div class="signal-note">`)
    p.push(`    <p>${esc(input.comment)}</p>`)
    p.push(`  </div>`)
  }

  p.push(`</div>`)
  return p.join('\n')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatExchange(raw: string): string {
  return raw.split(/[_\s]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}
