// src/pages/MarketsPage.tsx — AgoraIQ Markets Console
// Terminal-grade market intelligence grid with real-time updates
// Keyboard shortcuts: / search | E exchanges | F filters | C columns | ↑↓ navigate | Enter inspector | Esc close

import React, {
  useState, useEffect, useRef, useCallback, useMemo, useReducer,
} from 'react';
import type {
  MarketRow, MarketStatus, SortSpec, SortDir,
  FilterState, ColumnDef, CompareRow, ChangelogRow, SyncRow, ExchangeMeta,
} from '../types/market';

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_MI_API_URL || 'https://intel.agoraiq.net/api/v1';
const WS_URL   = import.meta.env.VITE_MI_WS_URL  || 'wss://intel.agoraiq.net/ws/markets';

const STATUS_COLOR: Record<string, string> = {
  ONLINE:       'text-emerald-400 bg-emerald-400/10',
  POST_ONLY:    'text-amber-400 bg-amber-400/10',
  LIMIT_ONLY:   'text-amber-400 bg-amber-400/10',
  REDUCE_ONLY:  'text-orange-400 bg-orange-400/10',
  CANCEL_ONLY:  'text-red-400 bg-red-400/10',
  DELISTED:     'text-zinc-500 bg-zinc-500/10',
  UNKNOWN:      'text-zinc-500 bg-zinc-500/10',
};

const STATUS_DOT: Record<string, string> = {
  ONLINE:      '#34d399',
  POST_ONLY:   '#fbbf24',
  LIMIT_ONLY:  '#fbbf24',
  REDUCE_ONLY: '#fb923c',
  CANCEL_ONLY: '#f87171',
  DELISTED:    '#52525b',
  UNKNOWN:     '#52525b',
};

const EXCHANGE_TIERS: Record<number, string> = {
  1: 'text-blue-400',
  2: 'text-zinc-400',
  3: 'text-zinc-500',
};

const SCORE_COLOR = (score: number | null) => {
  if (score === null) return 'text-zinc-600';
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
};

const SCORE_BAR = (score: number | null) => {
  if (score === null) return 'bg-zinc-800';
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-amber-500';
  if (score >= 40) return 'bg-orange-500';
  return 'bg-red-500';
};

// ─── Column Definitions ───────────────────────────────────────────────────────

const DEFAULT_COLUMNS: ColumnDef[] = [
  // Identity
  { key: 'exchange',           label: 'Exchange',   width: 110, align: 'left',  sortable: true,  group: 'identity', visible: true  },
  { key: 'symbol',             label: 'Pair',       width: 120, align: 'left',  sortable: true,  group: 'identity', visible: true  },
  { key: 'status',             label: 'Status',     width: 100, align: 'center',sortable: true,  group: 'identity', visible: true  },
  // Live intelligence
  { key: 'last',               label: 'Price',      width: 130, align: 'right', sortable: true,  group: 'live',     visible: true,  mono: true },
  { key: 'spreadBps',          label: 'Spread bps', width: 100, align: 'right', sortable: true,  group: 'live',     visible: true,  mono: true },
  { key: 'spreadAbs',          label: 'Spread',     width: 110, align: 'right', sortable: true,  group: 'live',     visible: false, mono: true },
  { key: 'volume24h',          label: 'Vol 24h',    width: 120, align: 'right', sortable: true,  group: 'live',     visible: true,  mono: true },
  { key: 'volume24hUsd',       label: 'Vol USD',    width: 120, align: 'right', sortable: true,  group: 'live',     visible: false, mono: true },
  { key: 'liquidityScore',     label: 'Liquidity',  width: 100, align: 'right', sortable: true,  group: 'live',     visible: true  },
  { key: 'volatilityScore',    label: 'Volatility', width: 100, align: 'right', sortable: true,  group: 'live',     visible: true  },
  { key: 'fundingRate',        label: 'Funding',    width: 100, align: 'right', sortable: true,  group: 'live',     visible: false, mono: true },
  // Specs
  { key: 'tickSize',           label: 'Tick Size',  width: 100, align: 'right', sortable: false, group: 'specs',    visible: false, mono: true },
  { key: 'orderMin',           label: 'Min Qty',    width: 100, align: 'right', sortable: false, group: 'specs',    visible: false, mono: true },
  { key: 'pairDecimals',       label: 'Price Dec',  width: 90,  align: 'right', sortable: false, group: 'specs',    visible: false },
  { key: 'marginAvailable',    label: 'Margin',     width: 80,  align: 'center',sortable: true,  group: 'specs',    visible: true  },
  // Ops
  { key: 'lastSyncedAt',       label: 'Synced',     width: 110, align: 'right', sortable: true,  group: 'ops',      visible: false },
];

// ─── Format helpers ───────────────────────────────────────────────────────────

const fmt = {
  price: (v: number | null, dec = 6): string => {
    if (v === null || v === undefined) return '—';
    const n = parseFloat(String(v));
    if (isNaN(n)) return '—';
    if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 1)    return n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
    return n.toFixed(Math.min(dec, 8));
  },

  vol: (v: number | null): string => {
    if (v === null || v === undefined) return '—';
    const n = parseFloat(String(v));
    if (isNaN(n)) return '—';
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
    if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)         return `${(n / 1_000).toFixed(2)}K`;
    return n.toFixed(2);
  },

  bps: (v: number | null): string => {
    if (v === null || v === undefined) return '—';
    const n = parseFloat(String(v));
    if (isNaN(n)) return '—';
    return n.toFixed(2);
  },

  funding: (v: number | null): string => {
    if (v === null || v === undefined) return '—';
    const n = parseFloat(String(v));
    if (isNaN(n)) return '—';
    const pct = (n * 100).toFixed(4);
    return `${n >= 0 ? '+' : ''}${pct}%`;
  },

  relTime: (iso: string | null): string => {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000)   return `${Math.floor(ms / 1000)}s`;
    if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86400_000)return `${Math.floor(ms / 3600_000)}h`;
    return `${Math.floor(ms / 86400_000)}d`;
  },

  score: (v: number | null): string => {
    if (v === null || v === undefined) return '—';
    return String(v);
  },
};

// ─── Mock data generator (dev/demo mode) ─────────────────────────────────────

function generateMockRows(count = 300): MarketRow[] {
  const exchanges = ['BINANCE','BYBIT','OKX','KUCOIN','KRAKEN','COINBASE','HTX','BITFINEX','CRYPTOCOM','BINGX','BINANCEUS','POLONIEX','HITBTC','BITMART','BITVAVO','EXMO'];
  const exDisplay: Record<string,string> = {
    BINANCE:'Binance',BYBIT:'Bybit',OKX:'OKX',KUCOIN:'KuCoin',KRAKEN:'Kraken',
    COINBASE:'Coinbase',HTX:'HTX',BITFINEX:'Bitfinex',CRYPTOCOM:'Crypto.com',
    BINGX:'BingX',BINANCEUS:'Binance.US',POLONIEX:'Poloniex',HITBTC:'HitBTC',
    BITMART:'BitMart',BITVAVO:'Bitvavo',EXMO:'EXMO',
  };
  const exTier: Record<string,number> = {
    BINANCE:1,BYBIT:1,OKX:1,KUCOIN:1,KRAKEN:1,COINBASE:1,HTX:1,
    BITFINEX:2,CRYPTOCOM:2,BINGX:2,BINANCEUS:2,POLONIEX:3,HITBTC:2,BITMART:2,BITVAVO:2,EXMO:3
  };
  const bases = ['BTC','ETH','SOL','BNB','XRP','ADA','AVAX','DOGE','DOT','MATIC','LINK','UNI','ATOM','LTC','BCH','TRX','NEAR','FIL','APT','OP'];
  const quotes = ['USDT','USDC','USD','EUR','BTC','ETH','BNB'];
  const statuses: MarketStatus[] = ['ONLINE','ONLINE','ONLINE','ONLINE','ONLINE','POST_ONLY','LIMIT_ONLY','CANCEL_ONLY'];

  const rows: MarketRow[] = [];
  const r = (a: number, b: number) => a + Math.random() * (b - a);

  for (let i = 0; i < count; i++) {
    const base = bases[Math.floor(Math.random() * bases.length)];
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    const ex = exchanges[Math.floor(Math.random() * exchanges.length)];
    const price = base === 'BTC' ? r(50000, 70000) : base === 'ETH' ? r(2000, 4000) : r(0.1, 200);
    const spread = price * r(0.0001, 0.005);
    const spreadBps = (spread / price) * 10000;
    const vol = r(10000, 50_000_000);
    const liq = Math.floor(r(20, 100));
    const vola = Math.floor(r(10, 90));

    rows.push({
      id: `${ex}-${base}${quote}-${i}`,
      exchange: ex,
      exchangeDisplayName: exDisplay[ex] || ex,
      exchangeTier: exTier[ex] || 2,
      pairId: `${base}${quote}`,
      symbol: `${base}/${quote}`,
      baseCanonical: base,
      quoteCanonical: quote,
      tvSymbol: `${ex}:${base}${quote}`,
      status: statuses[Math.floor(Math.random() * statuses.length)],
      tickSize: price > 1000 ? '0.01' : '0.0001',
      orderMin: '0.001',
      orderMinValue: '10',
      pairDecimals: price > 1000 ? 2 : 4,
      lotDecimals: 4,
      marginAvailable: Math.random() > 0.7,
      lastSyncedAt: new Date(Date.now() - r(0, 600_000)).toISOString(),
      // Stats
      bid: price - spread / 2,
      ask: price + spread / 2,
      last: price,
      spreadAbs: spread,
      spreadBps: spreadBps,
      volume24h: vol,
      volume24hUsd: vol * price,
      fundingRate: Math.random() > 0.7 ? r(-0.001, 0.001) : null,
      liquidityScore: liq,
      volatilityScore: vola,
      statTs: new Date(Date.now() - r(0, 30_000)).toISOString(),
    });
  }

  return rows;
}

// ─── ScoreBar component ───────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-zinc-600 font-mono text-xs">—</span>;
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <span className={`font-mono text-xs ${SCORE_COLOR(score)}`}>{score}</span>
      <div className="w-12 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${SCORE_BAR(score)}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

// ─── Exchange chip ────────────────────────────────────────────────────────────

function ExchangeChip({ exchange, displayName, tier }: { exchange: string; displayName: string; tier: number }) {
  const tierDot = tier === 1 ? 'bg-blue-500' : tier === 2 ? 'bg-zinc-500' : 'bg-zinc-700';
  return (
    <span className="inline-flex items-center gap-1 font-medium text-xs">
      <span className={`w-1.5 h-1.5 rounded-full ${tierDot} flex-shrink-0`} />
      <span className={EXCHANGE_TIERS[tier] || 'text-zinc-400'}>{displayName || exchange}</span>
    </span>
  );
}

// ─── Cell renderer ────────────────────────────────────────────────────────────

function Cell({ col, row, prev }: { col: ColumnDef; row: MarketRow; prev?: MarketRow }) {
  const key = col.key as keyof MarketRow;
  const val = row[key];

  // Flash animation for live updates
  const prevVal = prev?.[key];
  const changed = prev && prevVal !== val && (col.group === 'live');

  const cls = `${changed ? 'animate-pulse' : ''} ${col.mono ? 'font-mono' : ''}`;

  switch (col.key) {
    case 'exchange':
      return (
        <ExchangeChip
          exchange={row.exchange}
          displayName={row.exchangeDisplayName}
          tier={row.exchangeTier}
        />
      );

    case 'symbol':
      return (
        <span className="font-semibold text-white text-xs tracking-wide">
          {row.symbol}
        </span>
      );

    case 'status': {
      const dot = STATUS_DOT[row.status] || STATUS_DOT.UNKNOWN;
      const cls2 = STATUS_COLOR[row.status] || STATUS_COLOR.UNKNOWN;
      return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${cls2}`}>
          <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
          {row.status === 'CANCEL_ONLY' ? 'CANCEL' : row.status === 'LIMIT_ONLY' ? 'LIMIT' : row.status === 'REDUCE_ONLY' ? 'REDUCE' : row.status === 'POST_ONLY' ? 'POST' : row.status}
        </span>
      );
    }

    case 'last': {
      const n = val as number | null;
      const prevN = prevVal as number | null;
      const up = prevN !== null && n !== null && n > prevN;
      const down = prevN !== null && n !== null && n < prevN;
      const color = up ? 'text-emerald-400' : down ? 'text-red-400' : 'text-zinc-200';
      return <span className={`${cls} text-xs ${color}`}>{fmt.price(n)}</span>;
    }

    case 'spreadBps':
      return <span className={`${cls} text-xs text-zinc-300`}>{fmt.bps(val as number | null)}</span>;

    case 'spreadAbs':
      return <span className={`${cls} text-xs text-zinc-400`}>{fmt.price(val as number | null)}</span>;

    case 'volume24h':
      return <span className={`${cls} text-xs text-zinc-300`}>{fmt.vol(val as number | null)}</span>;

    case 'volume24hUsd':
      return <span className={`${cls} text-xs text-zinc-400`}>${fmt.vol(val as number | null)}</span>;

    case 'liquidityScore':
      return <ScoreBar score={val as number | null} />;

    case 'volatilityScore':
      return <ScoreBar score={val as number | null} />;

    case 'fundingRate': {
      const f = val as number | null;
      if (f === null) return <span className="text-zinc-600 font-mono text-xs">—</span>;
      const color = f >= 0 ? 'text-emerald-400' : 'text-red-400';
      return <span className={`font-mono text-xs ${color}`}>{fmt.funding(f)}</span>;
    }

    case 'marginAvailable':
      return val
        ? <span className="text-blue-400 text-[10px] font-medium px-1.5 py-0.5 bg-blue-400/10 rounded">MARGIN</span>
        : <span className="text-zinc-700 text-[10px]">—</span>;

    case 'lastSyncedAt':
      return <span className="text-zinc-500 text-xs">{fmt.relTime(val as string | null)}</span>;

    case 'tickSize':
    case 'orderMin':
      return <span className="font-mono text-zinc-400 text-xs">{val ? String(val) : '—'}</span>;

    case 'pairDecimals':
    case 'lotDecimals':
      return <span className="font-mono text-zinc-400 text-xs">{val !== null ? String(val) : '—'}</span>;

    default:
      return <span className="text-zinc-400 text-xs">{val !== null && val !== undefined ? String(val) : '—'}</span>;
  }
}

export {
  DEFAULT_COLUMNS, STATUS_COLOR, STATUS_DOT, SCORE_COLOR, SCORE_BAR,
  fmt, generateMockRows, Cell, ScoreBar, ExchangeChip,
  API_BASE, WS_URL,
};
