export type Direction = 'LONG' | 'SHORT'
export type MarketType = 'SPOT' | 'FUTURES_PERP' | 'FUTURES_DATED'

export interface CornixParseResult {
  success:      boolean
  confidence:   number
  explanation:  string
  data?:        CornixSignal
  errors:       string[]
}

export interface CornixSignal {
  pair:         string
  direction:    Direction
  marketType:   MarketType
  exchange:     string | null
  entryMin:     number | null
  entryMax:     number | null
  stopLoss:     number | null
  takeProfits:  number[]
  leverage:     number | null
  leverageType: 'cross' | 'isolated' | null
  rawMessage:   string
}

function normalisePair(raw: string): string {
  return (raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

function parseEntryZone(raw: string): { min: number; max: number } | null {
  const clean = raw.replace(/,/g, '').trim()
  const rangeMatch = clean.match(/^([\d.]+)\s*[-–—]\s*([\d.]+)$/)
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1] ?? '0')
    const max = parseFloat(rangeMatch[2] ?? '0')
    if (!isNaN(min) && !isNaN(max)) return { min, max }
  }
  const singleMatch = clean.match(/^([\d.]+)$/)
  if (singleMatch) {
    const val = parseFloat(singleMatch[1] ?? '0')
    if (!isNaN(val)) return { min: val, max: val }
  }
  return null
}

function parseLeverage(raw: string): { leverage: number; type: 'cross' | 'isolated' | null } | null {
  const clean = raw.toLowerCase().trim()
  const match = clean.match(/(?:(cross|isolated)\s+)?(\d+)x/)
  if (!match) return null
  return {
    leverage: parseInt(match[2] ?? '0'),
    type: (match[1] as 'cross' | 'isolated' | undefined) ?? null,
  }
}

function parseTakeProfits(lines: string[]): number[] {
  const tps: number[] = []
  for (const line of lines) {
    const numberedMatch = line.match(/(?:tp\s*\d+|target\s*\d+|\d+[).:])\s*([\d,. ]+)/i)
    if (numberedMatch) {
      const val = parseFloat((numberedMatch[1] ?? '0').replace(/,/g, '').trim())
      if (!isNaN(val)) tps.push(val)
      continue
    }
    if (line.includes(',')) {
      const parts = line.split(',').map(p => parseFloat(p.replace(/,/g, '').trim()))
      if (parts.every(p => !isNaN(p) && p > 0)) {
        tps.push(...parts)
        continue
      }
    }
  }
  return tps
}

function detectMarketType(text: string): MarketType {
  const lower = text.toLowerCase()
  if (lower.includes('futures') || lower.includes('perp') || lower.includes('swap')) return 'FUTURES_PERP'
  if (lower.includes('leverage') || lower.includes('cross') || lower.includes('isolated')) return 'FUTURES_PERP'
  return 'SPOT'
}

function sanityCheck(signal: CornixSignal): string[] {
  const errors: string[] = []
  if (!signal.pair)                    errors.push('Missing pair')
  if (!signal.stopLoss)                errors.push('Missing stop loss')
  if (signal.takeProfits.length === 0) errors.push('No take profits found')
  if (signal.entryMin && signal.stopLoss) {
    if (signal.direction === 'LONG' && signal.stopLoss! >= signal.entryMin!)
      errors.push('SL is above entry for LONG — invalid')
    if (signal.direction === 'SHORT' && signal.stopLoss! <= signal.entryMin!)
      errors.push('SL is below entry for SHORT — invalid')
  }
  if (signal.entryMin && signal.takeProfits.length > 0) {
    const badTps = signal.direction === 'LONG'
      ? signal.takeProfits.filter(tp => tp <= signal.entryMin!)
      : signal.takeProfits.filter(tp => tp >= signal.entryMin!)
    if (badTps.length > 0)
      errors.push(`${badTps.length} TP(s) on wrong side of entry for ${signal.direction}`)
  }
  if (signal.takeProfits.length > 1) {
    for (let i = 1; i < signal.takeProfits.length; i++) {
      const curr = signal.takeProfits[i] ?? 0
      const prev = signal.takeProfits[i - 1] ?? 0
      const ascending  = curr > prev
      const descending = curr < prev
      const expected   = signal.direction === 'LONG' ? ascending : descending
      if (!expected) { errors.push('TP levels are not in correct order'); break }
    }
  }
  if (signal.leverage && signal.leverage > 125)
    errors.push(`Leverage ${signal.leverage}x seems unrealistically high`)
  return errors
}

function scoreConfidence(signal: CornixSignal, errors: string[]): number {
  let score = 1.0
  if (!signal.pair)                    score -= 0.3
  if (!signal.entryMin)                score -= 0.05  // market order — soft penalty only
  if (!signal.stopLoss)                score -= 0.2
  if (signal.takeProfits.length === 0) score -= 0.2
  if (!signal.exchange)                score -= 0.05
  if (!signal.leverage)                score -= 0.05
  score -= errors.length * 0.15
  return Math.max(0, Math.min(1, parseFloat(score.toFixed(2))))
}

export function parseCornix(raw: string): CornixParseResult {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  const text   = lines.join('\n')

  let pair:         string | null = null
  let direction:    Direction | null = null
  let exchange:     string | null = null
  let entryMin:     number | null = null
  let entryMax:     number | null = null
  let stopLoss:     number | null = null
  let leverage:     number | null = null
  let leverageType: 'cross' | 'isolated' | null = null
  const tpLines:    string[] = []
  let inTargetsBlock = false

  for (const line of lines) {
    const lineLower = line.toLowerCase()

    if (!pair) {
      const headerMatch = line.match(/[#📈📉🔴🟢]?\s*([A-Za-z0-9/\-_]{3,12})\s*[\-\u2013\u2014]?\s*(LONG|SHORT|BUY|SELL)/i)
      if (headerMatch) {
        pair      = normalisePair(headerMatch[1] ?? '')
        const d2  = (headerMatch[2] ?? '').toUpperCase()
        direction = d2 === 'BUY' ? 'LONG' : d2 === 'SELL' ? 'SHORT' : d2 as Direction
      }
    }

    if (lineLower.startsWith('exchange:') || lineLower.startsWith('market:')) {
      const val = line.split(':')[1]?.trim()
      if (val) exchange = val.toUpperCase()
    }

    if (lineLower.startsWith('entry:') || lineLower.startsWith('buy:') || lineLower.startsWith('enter:')) {
      const val = line.split(':').slice(1).join(':').trim()
      if (!/market\s*price|at\s*market/i.test(val)) {
        const zone = parseEntryZone(val)
        if (zone) { entryMin = zone.min; entryMax = zone.max }
      }
    }

    if (lineLower.startsWith('stop:') || lineLower.startsWith('sl:') || lineLower.startsWith('stoploss:') || lineLower.startsWith('stop loss:')) {
      const val = line.split(':').slice(1).join(':').trim().replace(/,/g, '')
      const num = parseFloat(val)
      if (!isNaN(num)) stopLoss = num
    }

    if (lineLower.startsWith('leverage:') || lineLower.startsWith('lev:')) {
      const val = line.split(':').slice(1).join(':').trim()
      const parsed = parseLeverage(val)
      if (parsed) { leverage = parsed.leverage; leverageType = parsed.type }
    }

    if (lineLower.startsWith('target') || lineLower.startsWith('tp') || lineLower.startsWith('take profit') || lineLower.startsWith('• tp') || lineLower.startsWith('• target')) {
      inTargetsBlock = true
      tpLines.push(line)
      continue
    }

    if (inTargetsBlock) {
      if (line.match(/^\d+[).]\s*[\d,.]+$/) || line.match(/^[\d,.]+$/) || line.match(/^[•\-\*]\s*(tp|target|\d)/i)) {
        tpLines.push(line)
      } else {
        inTargetsBlock = false
      }
    }
  }

  const takeProfits = parseTakeProfits(tpLines)
  const marketType  = detectMarketType(text)

  if (!pair || !direction) {
    return {
      success:     false,
      confidence:  0,
      explanation: 'Could not extract pair or direction — not a recognisable Cornix signal',
      errors:      ['Missing pair or direction'],
    }
  }

  const signal: CornixSignal = {
    pair, direction, marketType, exchange,
    entryMin, entryMax, stopLoss, takeProfits,
    leverage, leverageType, rawMessage: raw,
  }

  const errors     = sanityCheck(signal)
  const confidence = scoreConfidence(signal, errors)

  return {
    success:     errors.length === 0,
    confidence,
    explanation: errors.length === 0
      ? `Parsed: ${pair} ${direction}, ${takeProfits.length} TPs, SL: ${stopLoss}`
      : `Parsed with issues: ${errors.join('; ')}`,
    data:   signal,
    errors,
  }
}
