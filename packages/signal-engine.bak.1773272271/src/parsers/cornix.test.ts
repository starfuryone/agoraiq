import { parseCornix } from './cornix'

const CLASSIC = `
#BTCUSDT LONG
Exchange: Binance Futures
Entry: 65000 - 65500
Targets:
1) 66500
2) 68000
3) 70000
4) 72000
Stop: 63000
Leverage: Cross 10x
`

const NO_RANGE = `
ETHUSDT LONG
Entry: 3200
TP1: 3300
TP2: 3450
TP3: 3600
SL: 3050
Leverage: 5x
`

const MISSING_SL = `
#SOLUSDT SHORT
Entry: 180 - 185
Targets:
1) 175
2) 170
3) 165
`

const BAD_SL = `
#BNBUSDT LONG
Entry: 400 - 410
Targets:
1) 420
2) 440
Stop: 450
Leverage: Isolated 20x
`

const tests = [
  { name: 'Classic Cornix',  raw: CLASSIC    },
  { name: 'No range entry',  raw: NO_RANGE   },
  { name: 'Missing SL',      raw: MISSING_SL },
  { name: 'SL above entry',  raw: BAD_SL     },
]

for (const t of tests) {
  const r = parseCornix(t.raw)
  console.log(`\n── ${t.name} ──`)
  console.log(`Success:     ${r.success}`)
  console.log(`Confidence:  ${r.confidence}`)
  console.log(`Explanation: ${r.explanation}`)
  if (r.data) {
    console.log(`Pair:        ${r.data.pair} ${r.data.direction} [${r.data.marketType}]`)
    console.log(`Entry:       ${r.data.entryMin} – ${r.data.entryMax}`)
    console.log(`SL:          ${r.data.stopLoss}`)
    console.log(`TPs:         ${r.data.takeProfits.join(', ')}`)
    console.log(`Leverage:    ${r.data.leverage}x ${r.data.leverageType ?? ''}`)
    console.log(`Exchange:    ${r.data.exchange}`)
  }
  if (r.errors.length) console.log(`Errors:      ${r.errors.join(' | ')}`)
}
