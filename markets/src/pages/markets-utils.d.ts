import type { MarketRow, ColumnDef } from '../types/market';
declare const API_BASE: any;
declare const WS_URL: any;
declare const STATUS_COLOR: Record<string, string>;
declare const STATUS_DOT: Record<string, string>;
declare const SCORE_COLOR: (score: number | null) => "text-zinc-600" | "text-emerald-400" | "text-red-400" | "text-amber-400" | "text-orange-400";
declare const SCORE_BAR: (score: number | null) => "bg-zinc-800" | "bg-emerald-500" | "bg-amber-500" | "bg-orange-500" | "bg-red-500";
declare const DEFAULT_COLUMNS: ColumnDef[];
declare const fmt: {
    price: (v: number | null, dec?: number) => string;
    vol: (v: number | null) => string;
    bps: (v: number | null) => string;
    funding: (v: number | null) => string;
    relTime: (iso: string | null) => string;
    score: (v: number | null) => string;
};
declare function generateMockRows(count?: number): MarketRow[];
declare function ScoreBar({ score }: {
    score: number | null;
}): any;
declare function ExchangeChip({ exchange, displayName, tier }: {
    exchange: string;
    displayName: string;
    tier: number;
}): any;
declare function Cell({ col, row, prev }: {
    col: ColumnDef;
    row: MarketRow;
    prev?: MarketRow;
}): any;
export { DEFAULT_COLUMNS, STATUS_COLOR, STATUS_DOT, SCORE_COLOR, SCORE_BAR, fmt, generateMockRows, Cell, ScoreBar, ExchangeChip, API_BASE, WS_URL, };
//# sourceMappingURL=markets-utils.d.ts.map