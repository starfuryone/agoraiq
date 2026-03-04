"use strict";
// src/pages/MarketsPage.tsx — AgoraIQ Markets Console (Main)
// Dense terminal-grade market grid with inspector, filters, live updates
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = MarketsPage;
const react_1 = __importStar(require("react"));
const markets_utils_1 = require("./markets-utils");
// ─── Icons (inline SVG) ───────────────────────────────────────────────────────
const Icon = {
    Search: () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
    Filter: () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>,
    Columns: () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="18"/><rect x="14" y="3" width="7" height="18"/></svg>,
    Export: () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
    Live: () => <svg className="w-3 h-3 fill-emerald-400"><circle cx="6" cy="6" r="6"/></svg>,
    Close: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    Sort: (d) => <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">{d === 'asc' ? <path d="M12 5l7 7H5z"/> : <path d="M12 19l-7-7h14z"/>}</svg>,
    Chevron: (open) => <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>,
    Copy: () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
    Check: () => <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
    Refresh: () => <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>,
};
// ─── Default filter state ─────────────────────────────────────────────────────
const DEFAULT_FILTERS = {
    exchanges: [],
    search: '',
    bases: [],
    quotes: [],
    status: ['ONLINE', 'POST_ONLY', 'LIMIT_ONLY'],
    marginAvailable: false,
    minVolume: null,
    maxSpreadBps: null,
};
// ─── Top Bar ──────────────────────────────────────────────────────────────────
function TopBar({ filters, onFilter, live, onToggleLive, onOpenColumns, onExport, onOpenExchanges, totalCount, visibleCount, }) {
    const searchRef = (0, react_1.useRef)(null);
    // "/" to focus search
    (0, react_1.useEffect)(() => {
        const handler = (e) => {
            if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
                e.preventDefault();
                searchRef.current?.focus();
            }
            if (e.key === 'e' || e.key === 'E') {
                if (document.activeElement?.tagName !== 'INPUT')
                    onOpenExchanges();
            }
            if (e.key === 'c' || e.key === 'C') {
                if (document.activeElement?.tagName !== 'INPUT')
                    onOpenColumns();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onOpenExchanges, onOpenColumns]);
    const STATUS_OPTIONS = ['ONLINE', 'POST_ONLY', 'LIMIT_ONLY', 'CANCEL_ONLY', 'DELISTED'];
    return (<div className="flex items-center gap-2 px-3 py-2 bg-[#0d0e10] border-b border-[#1e2025] flex-wrap">
      {/* Search */}
      <div className="relative flex items-center">
        <Icon.Search />
        <input ref={searchRef} type="text" value={filters.search} onChange={e => onFilter({ search: e.target.value })} placeholder="Search pairs, assets… (/)" className="ml-1.5 bg-[#161820] border border-[#2a2d35] rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500 w-52"/>
        {filters.search && (<button onClick={() => onFilter({ search: '' })} className="absolute right-2 text-zinc-500 hover:text-zinc-300">×</button>)}
      </div>

      {/* Exchange quick-select */}
      <button onClick={onOpenExchanges} className="flex items-center gap-1.5 px-2.5 py-1 bg-[#161820] border border-[#2a2d35] rounded text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors">
        <span>Exchanges</span>
        {filters.exchanges.length > 0
            ? <span className="text-blue-400 font-medium">{filters.exchanges.length}</span>
            : <span className="text-zinc-600">All</span>}
        <kbd className="text-[9px] text-zinc-600 border border-zinc-700 rounded px-0.5">E</kbd>
      </button>

      {/* Status filter pills */}
      <div className="flex items-center gap-1">
        {STATUS_OPTIONS.map(s => {
            const active = filters.status.includes(s);
            const color = active ? markets_utils_1.STATUS_COLOR[s] : 'text-zinc-600 bg-transparent';
            return (<button key={s} onClick={() => {
                    const next = active
                        ? filters.status.filter(x => x !== s)
                        : [...filters.status, s];
                    onFilter({ status: next });
                }} className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-all ${active
                    ? `${markets_utils_1.STATUS_COLOR[s]} border-current/30`
                    : 'border-transparent text-zinc-600 hover:text-zinc-400'}`}>
              {s === 'CANCEL_ONLY' ? 'CANCEL' : s === 'LIMIT_ONLY' ? 'LIMIT' : s === 'POST_ONLY' ? 'POST' : s}
            </button>);
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1"/>

      {/* Row count */}
      <span className="text-[10px] text-zinc-600 font-mono tabular-nums">
        {visibleCount.toLocaleString()} / {totalCount.toLocaleString()} pairs
      </span>

      {/* Columns */}
      <button onClick={onOpenColumns} className="flex items-center gap-1.5 px-2.5 py-1 bg-[#161820] border border-[#2a2d35] rounded text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors">
        <Icon.Columns />
        <span>Columns</span>
        <kbd className="text-[9px] text-zinc-600 border border-zinc-700 rounded px-0.5">C</kbd>
      </button>

      {/* Export */}
      <button onClick={onExport} className="flex items-center gap-1.5 px-2.5 py-1 bg-[#161820] border border-[#2a2d35] rounded text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors">
        <Icon.Export />
        <span>CSV</span>
      </button>

      {/* Live toggle */}
      <button onClick={onToggleLive} className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${live
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-[#161820] border-[#2a2d35] text-zinc-500'}`}>
        {live ? (<span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"/>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"/>
          </span>) : (<span className="w-2 h-2 rounded-full bg-zinc-700"/>)}
        {live ? 'LIVE' : 'PAUSED'}
      </button>
    </div>);
}
// ─── Left Rail ────────────────────────────────────────────────────────────────
function LeftRail({ open, filters, onFilter, exchanges, }) {
    const TOP_BASES = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOGE', 'DOT', 'MATIC', 'LINK', 'UNI'];
    const TOP_QUOTES = ['USDT', 'USDC', 'USD', 'EUR', 'BTC', 'ETH'];
    const [exOpen, setExOpen] = (0, react_1.useState)(true);
    const [baseOpen, setBaseOpen] = (0, react_1.useState)(true);
    const [quoteOpen, setQuoteOpen] = (0, react_1.useState)(false);
    const [advOpen, setAdvOpen] = (0, react_1.useState)(false);
    if (!open)
        return null;
    const toggleEx = (ex) => {
        const list = filters.exchanges;
        onFilter({ exchanges: list.includes(ex) ? list.filter(e => e !== ex) : [...list, ex] });
    };
    const toggleBase = (b) => {
        const list = filters.bases;
        onFilter({ bases: list.includes(b) ? list.filter(x => x !== b) : [...list, b] });
    };
    const toggleQuote = (q) => {
        const list = filters.quotes;
        onFilter({ quotes: list.includes(q) ? list.filter(x => x !== q) : [...list, q] });
    };
    return (<div className="w-48 flex-shrink-0 bg-[#0d0e10] border-r border-[#1e2025] overflow-y-auto flex flex-col text-xs">

      {/* Header */}
      <div className="px-3 py-2 border-b border-[#1e2025] flex items-center justify-between">
        <span className="text-[10px] text-zinc-500 font-medium tracking-widest uppercase">Filters</span>
        {(filters.exchanges.length > 0 || filters.bases.length > 0 || filters.quotes.length > 0 || filters.marginAvailable) && (<button onClick={() => onFilter({ exchanges: [], bases: [], quotes: [], marginAvailable: false, minVolume: null, maxSpreadBps: null })} className="text-[10px] text-zinc-500 hover:text-red-400">Clear</button>)}
      </div>

      {/* Exchanges */}
      <div className="border-b border-[#1e2025]">
        <button onClick={() => setExOpen(v => !v)} className="w-full flex items-center justify-between px-3 py-2 text-zinc-400 hover:text-zinc-200">
          <span className="font-medium">Exchanges</span>
          <div className="flex items-center gap-1">
            {filters.exchanges.length > 0 && (<span className="text-[9px] text-blue-400 font-medium">{filters.exchanges.length}</span>)}
            {Icon.Chevron(exOpen)}
          </div>
        </button>

        {exOpen && (<div className="pb-2 px-2">
            <div className="flex gap-1 mb-1.5">
              <button onClick={() => onFilter({ exchanges: [] })} className="px-1.5 py-0.5 text-[9px] bg-[#161820] border border-[#2a2d35] rounded text-zinc-500 hover:text-zinc-300">All</button>
              <button onClick={() => {
                const t1 = exchanges.filter(e => e.tier === 1).map(e => e.exchange);
                onFilter({ exchanges: t1 });
            }} className="px-1.5 py-0.5 text-[9px] bg-[#161820] border border-[#2a2d35] rounded text-zinc-500 hover:text-zinc-300">Tier 1</button>
            </div>
            {exchanges.map(ex => (<label key={ex.exchange} className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-[#161820] px-1 rounded">
                <input type="checkbox" checked={filters.exchanges.includes(ex.exchange)} onChange={() => toggleEx(ex.exchange)} className="w-3 h-3 rounded accent-blue-500"/>
                <span className={`flex-1 text-[11px] ${filters.exchanges.includes(ex.exchange) ? 'text-zinc-200' : 'text-zinc-500'}`}>
                  {ex.displayName}
                </span>
                {ex.tier === 1 && <span className="w-1 h-1 rounded-full bg-blue-500 flex-shrink-0"/>}
              </label>))}
          </div>)}
      </div>

      {/* Base asset */}
      <div className="border-b border-[#1e2025]">
        <button onClick={() => setBaseOpen(v => !v)} className="w-full flex items-center justify-between px-3 py-2 text-zinc-400 hover:text-zinc-200">
          <span className="font-medium">Base Asset</span>
          <div className="flex items-center gap-1">
            {filters.bases.length > 0 && <span className="text-[9px] text-blue-400">{filters.bases.length}</span>}
            {Icon.Chevron(baseOpen)}
          </div>
        </button>
        {baseOpen && (<div className="pb-2 px-2 flex flex-wrap gap-1">
            {TOP_BASES.map(b => (<button key={b} onClick={() => toggleBase(b)} className={`px-2 py-0.5 text-[10px] rounded border font-medium transition-colors ${filters.bases.includes(b)
                    ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                    : 'bg-[#161820] border-[#2a2d35] text-zinc-500 hover:text-zinc-300'}`}>{b}</button>))}
          </div>)}
      </div>

      {/* Quote */}
      <div className="border-b border-[#1e2025]">
        <button onClick={() => setQuoteOpen(v => !v)} className="w-full flex items-center justify-between px-3 py-2 text-zinc-400 hover:text-zinc-200">
          <span className="font-medium">Quote</span>
          <div className="flex items-center gap-1">
            {filters.quotes.length > 0 && <span className="text-[9px] text-blue-400">{filters.quotes.length}</span>}
            {Icon.Chevron(quoteOpen)}
          </div>
        </button>
        {quoteOpen && (<div className="pb-2 px-2 flex flex-wrap gap-1">
            {TOP_QUOTES.map(q => (<button key={q} onClick={() => toggleQuote(q)} className={`px-2 py-0.5 text-[10px] rounded border font-medium transition-colors ${filters.quotes.includes(q)
                    ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                    : 'bg-[#161820] border-[#2a2d35] text-zinc-500 hover:text-zinc-300'}`}>{q}</button>))}
          </div>)}
      </div>

      {/* Advanced */}
      <div>
        <button onClick={() => setAdvOpen(v => !v)} className="w-full flex items-center justify-between px-3 py-2 text-zinc-400 hover:text-zinc-200">
          <span className="font-medium">Advanced</span>
          {Icon.Chevron(advOpen)}
        </button>
        {advOpen && (<div className="pb-3 px-3 space-y-3">
            {/* Margin toggle */}
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-zinc-400 text-[11px]">Margin only</span>
              <div onClick={() => onFilter({ marginAvailable: !filters.marginAvailable })} className={`w-8 h-4 rounded-full transition-colors relative cursor-pointer ${filters.marginAvailable ? 'bg-blue-500' : 'bg-zinc-700'}`}>
                <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${filters.marginAvailable ? 'translate-x-4' : 'translate-x-0.5'}`}/>
              </div>
            </label>

            {/* Min volume */}
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">Min Vol 24h</label>
              <input type="number" value={filters.minVolume ?? ''} onChange={e => onFilter({ minVolume: e.target.value ? parseFloat(e.target.value) : null })} placeholder="e.g. 100000" className="w-full bg-[#161820] border border-[#2a2d35] rounded px-2 py-1 text-[11px] text-zinc-300 font-mono focus:outline-none focus:border-blue-500"/>
            </div>

            {/* Max spread */}
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">Max Spread (bps)</label>
              <input type="number" value={filters.maxSpreadBps ?? ''} onChange={e => onFilter({ maxSpreadBps: e.target.value ? parseFloat(e.target.value) : null })} placeholder="e.g. 50" className="w-full bg-[#161820] border border-[#2a2d35] rounded px-2 py-1 text-[11px] text-zinc-300 font-mono focus:outline-none focus:border-blue-500"/>
            </div>
          </div>)}
      </div>
    </div>);
}
// ─── Column Picker Modal ───────────────────────────────────────────────────────
function ColumnPicker({ columns, onClose, onChange, }) {
    const groups = ['identity', 'live', 'specs', 'ops'];
    const groupLabels = { identity: 'Identity', live: 'Live Intelligence', specs: 'Market Specs', ops: 'Operations' };
    return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#13141a] border border-[#2a2d35] rounded-lg shadow-2xl w-80">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2d35]">
          <span className="text-sm font-semibold text-zinc-200">Columns</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><Icon.Close /></button>
        </div>
        <div className="p-4 space-y-4 max-h-[400px] overflow-y-auto">
          {groups.map(group => (<div key={group}>
              <div className="text-[10px] text-zinc-600 font-medium tracking-widest uppercase mb-2">
                {groupLabels[group]}
              </div>
              {columns.filter(c => c.group === group).map(col => (<label key={col.key} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-[#1e2025] px-2 rounded">
                  <input type="checkbox" checked={col.visible} onChange={() => onChange(columns.map(c => c.key === col.key ? { ...c, visible: !c.visible } : c))} className="w-3.5 h-3.5 rounded accent-blue-500"/>
                  <span className="text-xs text-zinc-400">{col.label}</span>
                </label>))}
            </div>))}
        </div>
        <div className="px-4 py-3 border-t border-[#2a2d35] flex justify-end">
          <button onClick={() => onChange(columns.map(c => ({ ...c, visible: markets_utils_1.DEFAULT_COLUMNS.find(d => d.key === c.key)?.visible ?? true })))} className="text-xs text-zinc-500 hover:text-zinc-300 mr-3">Reset</button>
          <button onClick={onClose} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded">Done</button>
        </div>
      </div>
    </div>);
}
// ─── Bottom Inspector ─────────────────────────────────────────────────────────
function Inspector({ row, onClose, height, onResize, }) {
    const [tab, setTab] = (0, react_1.useState)('overview');
    const [compareData, setCompareData] = (0, react_1.useState)([]);
    const [changelog, setChangelog] = (0, react_1.useState)([]);
    const [syncHistory, setSyncHistory] = (0, react_1.useState)([]);
    const [loading, setLoading] = (0, react_1.useState)(false);
    const [copied, setCopied] = (0, react_1.useState)('');
    const resizeRef = (0, react_1.useRef)(null);
    const copyToClipboard = (text, key) => {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(''), 1500);
    };
    // Load data when tab or row changes
    (0, react_1.useEffect)(() => {
        if (tab === 'compare') {
            setLoading(true);
            fetch(`${markets_utils_1.API_BASE}/markets/compare?base=${row.baseCanonical}&quote=${row.quoteCanonical}`)
                .then(r => r.json())
                .then(d => setCompareData(d.data || []))
                .catch(() => {
                // Demo: generate mock compare data
                setCompareData([]);
            })
                .finally(() => setLoading(false));
        }
        else if (tab === 'changelog') {
            setLoading(true);
            fetch(`${markets_utils_1.API_BASE}/markets/${row.exchange}/${row.pairId}`)
                .then(r => r.json())
                .then(d => setChangelog(d.changelog || []))
                .catch(() => setChangelog([]))
                .finally(() => setLoading(false));
        }
        else if (tab === 'sync') {
            setLoading(true);
            fetch(`${markets_utils_1.API_BASE}/markets/${row.exchange}/${row.pairId}`)
                .then(r => r.json())
                .then(d => setSyncHistory(d.syncHistory || []))
                .catch(() => setSyncHistory([]))
                .finally(() => setLoading(false));
        }
    }, [tab, row.exchange, row.pairId, row.baseCanonical, row.quoteCanonical]);
    // Drag-to-resize
    const handleResizeMouseDown = (e) => {
        e.preventDefault();
        resizeRef.current = { startY: e.clientY, startH: height };
        const onMove = (ev) => {
            if (!resizeRef.current)
                return;
            const delta = resizeRef.current.startY - ev.clientY;
            onResize(resizeRef.current.startH + delta);
        };
        const onUp = () => {
            resizeRef.current = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };
    const TABS = [
        { id: 'overview', label: 'Overview' },
        { id: 'compare', label: 'Cross-Exchange' },
        { id: 'changelog', label: 'Changelog' },
        { id: 'sync', label: 'Sync History' },
        { id: 'raw', label: 'Raw' },
    ];
    return (<div className="bg-[#0d0e10] border-t border-[#1e2025] flex flex-col flex-shrink-0" style={{ height }}>
      {/* Resize handle */}
      <div onMouseDown={handleResizeMouseDown} className="h-1 bg-transparent hover:bg-blue-500/30 cursor-ns-resize transition-colors flex-shrink-0"/>

      {/* Tab bar */}
      <div className="flex items-center border-b border-[#1e2025] px-3 gap-1 flex-shrink-0">
        {TABS.map(t => (<button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${tab === t.id
                ? 'border-blue-500 text-zinc-200'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>{t.label}</button>))}
        <div className="flex-1"/>
        {/* Identity badge */}
        <span className="text-[10px] font-mono text-zinc-500 mr-2">
          <span className="text-zinc-400">{row.exchangeDisplayName}</span>
          <span className="mx-1 text-zinc-700">·</span>
          <span className="text-white font-semibold">{row.symbol}</span>
        </span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 p-1">
          <Icon.Close />
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {tab === 'overview' && (<div className="flex gap-0 h-full">
            {/* Left: pair identity + specs */}
            <div className="w-64 border-r border-[#1e2025] p-4 flex-shrink-0">
              <div className="mb-3">
                <div className="text-lg font-bold text-white tracking-tight">{row.symbol}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{row.pairId} · {row.exchangeDisplayName}</div>
              </div>
              <div className="space-y-1.5">
                {[
                ['Status', <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${markets_utils_1.STATUS_COLOR[row.status] || ''}`}>{row.status}</span>],
                ['Tick Size', <span className="font-mono text-zinc-300 text-xs">{row.tickSize || '—'}</span>],
                ['Min Qty', <span className="font-mono text-zinc-300 text-xs">{row.orderMin || '—'}</span>],
                ['Min Value', <span className="font-mono text-zinc-300 text-xs">{row.orderMinValue || '—'}</span>],
                ['Price Dec', <span className="font-mono text-zinc-300 text-xs">{row.pairDecimals ?? '—'}</span>],
                ['Lot Dec', <span className="font-mono text-zinc-300 text-xs">{row.lotDecimals ?? '—'}</span>],
                ['Margin', row.marginAvailable ? <span className="text-blue-400 text-xs">Yes</span> : <span className="text-zinc-600 text-xs">No</span>],
                ['Last Sync', <span className="text-zinc-400 text-xs">{markets_utils_1.fmt.relTime(row.lastSyncedAt)}</span>],
            ].map(([label, val]) => (<div key={label} className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-600">{label}</span>
                    {val}
                  </div>))}
              </div>
              {/* Copy buttons */}
              <div className="mt-4 space-y-1.5">
                {[
                ['Symbol', row.symbol],
                ['TV Symbol', row.tvSymbol || ''],
                ['Pair ID', row.pairId],
            ].map(([label, val]) => val && (<button key={label} onClick={() => copyToClipboard(val, label)} className="w-full flex items-center justify-between px-2 py-1.5 bg-[#161820] border border-[#2a2d35] rounded text-[10px] text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-colors">
                    <span>Copy {label}</span>
                    {copied === label ? <Icon.Check /> : <Icon.Copy />}
                  </button>))}
              </div>
            </div>

            {/* Right: live stats */}
            <div className="flex-1 p-4">
              <div className="text-[10px] text-zinc-600 font-medium tracking-widest uppercase mb-3">Live Market</div>
              <div className="grid grid-cols-4 gap-3">
                {[
                { label: 'Last Price', val: markets_utils_1.fmt.price(row.last), accent: 'text-white', mono: true },
                { label: 'Bid', val: markets_utils_1.fmt.price(row.bid), accent: 'text-emerald-400', mono: true },
                { label: 'Ask', val: markets_utils_1.fmt.price(row.ask), accent: 'text-red-400', mono: true },
                { label: 'Spread', val: markets_utils_1.fmt.price(row.spreadAbs), accent: 'text-zinc-300', mono: true },
                { label: 'Spread (bps)', val: markets_utils_1.fmt.bps(row.spreadBps) + ' bps', accent: row.spreadBps !== null && row.spreadBps < 5 ? 'text-emerald-400' : 'text-amber-400', mono: true },
                { label: 'Vol 24h', val: markets_utils_1.fmt.vol(row.volume24h), accent: 'text-zinc-300', mono: true },
                { label: 'Vol USD', val: '$' + markets_utils_1.fmt.vol(row.volume24hUsd), accent: 'text-zinc-400', mono: true },
                { label: 'Funding', val: markets_utils_1.fmt.funding(row.fundingRate), accent: row.fundingRate !== null && row.fundingRate >= 0 ? 'text-emerald-400' : 'text-red-400', mono: true },
            ].map(({ label, val, accent, mono }) => (<div key={label} className="bg-[#161820] border border-[#2a2d35] rounded p-3">
                    <div className="text-[10px] text-zinc-600 mb-1">{label}</div>
                    <div className={`text-sm font-semibold ${accent} ${mono ? 'font-mono' : ''}`}>{val}</div>
                  </div>))}
                <div className="bg-[#161820] border border-[#2a2d35] rounded p-3">
                  <div className="text-[10px] text-zinc-600 mb-1">Liquidity</div>
                  <div className={`text-sm font-bold ${row.liquidityScore !== null ? (row.liquidityScore >= 80 ? 'text-emerald-400' : row.liquidityScore >= 60 ? 'text-amber-400' : 'text-red-400') : 'text-zinc-600'}`}>
                    {row.liquidityScore ?? '—'}
                    <span className="text-[10px] font-normal text-zinc-600 ml-1">/100</span>
                  </div>
                </div>
                <div className="bg-[#161820] border border-[#2a2d35] rounded p-3">
                  <div className="text-[10px] text-zinc-600 mb-1">Volatility</div>
                  <div className={`text-sm font-bold ${row.volatilityScore !== null ? (row.volatilityScore >= 70 ? 'text-red-400' : row.volatilityScore >= 40 ? 'text-amber-400' : 'text-emerald-400') : 'text-zinc-600'}`}>
                    {row.volatilityScore ?? '—'}
                    <span className="text-[10px] font-normal text-zinc-600 ml-1">/100</span>
                  </div>
                </div>
              </div>
              {row.statTs && (<div className="mt-3 text-[10px] text-zinc-700">
                  Data snapshot: {new Date(row.statTs).toLocaleTimeString()}
                </div>)}
            </div>
          </div>)}

        {tab === 'compare' && (<div className="p-3">
            <div className="text-[10px] text-zinc-600 font-medium tracking-widest uppercase mb-2">
              {row.symbol} across all exchanges
            </div>
            {loading ? (<div className="text-zinc-600 text-xs py-8 text-center">Loading cross-exchange data…</div>) : compareData.length === 0 ? (<div className="text-zinc-600 text-xs py-8 text-center">
                No cross-exchange data available.
                <br />
                <span className="text-zinc-700">Connect to the MI API to populate live comparisons.</span>
              </div>) : (<table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-zinc-600 border-b border-[#1e2025]">
                    {['Exchange', 'Price', 'Spread bps', 'Vol 24h', 'Liquidity', 'Status', 'Best'].map(h => (<th key={h} className="py-2 px-3 text-left font-medium">{h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {compareData.map((r, i) => (<tr key={r.exchange} className={`border-b border-[#1e2025]/50 hover:bg-[#161820] ${r.exchange === row.exchange ? 'bg-blue-500/5' : ''}`}>
                      <td className="py-1.5 px-3">
                        <span className={`font-medium ${r.exchange === row.exchange ? 'text-blue-400' : 'text-zinc-400'}`}>
                          {r.displayName}
                        </span>
                        {r.tier === 1 && <span className="ml-1 w-1 h-1 rounded-full bg-blue-500 inline-block"/>}
                      </td>
                      <td className="py-1.5 px-3 font-mono text-zinc-200">{markets_utils_1.fmt.price(r.last)}</td>
                      <td className={`py-1.5 px-3 font-mono ${r.isBestSpread ? 'text-emerald-400 font-semibold' : 'text-zinc-400'}`}>{markets_utils_1.fmt.bps(r.spreadBps)}</td>
                      <td className="py-1.5 px-3 font-mono text-zinc-300">{markets_utils_1.fmt.vol(r.volume24h)}</td>
                      <td className="py-1.5 px-3">
                        {r.liquidityScore !== null
                        ? <span className={(0, markets_utils_1.SCORE_COLOR)(r.liquidityScore)}>{r.liquidityScore}</span>
                        : <span className="text-zinc-700">—</span>}
                      </td>
                      <td className="py-1.5 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${markets_utils_1.STATUS_COLOR[r.status] || ''}`}>{r.status}</span>
                      </td>
                      <td className="py-1.5 px-3">
                        <div className="flex gap-1">
                          {r.isBestSpread && <span className="text-[9px] text-emerald-400 bg-emerald-400/10 px-1 rounded">SPREAD</span>}
                          {r.isBestVolume && <span className="text-[9px] text-blue-400 bg-blue-400/10 px-1 rounded">VOL</span>}
                          {r.isBestLiq && <span className="text-[9px] text-amber-400 bg-amber-400/10 px-1 rounded">LIQ</span>}
                        </div>
                      </td>
                    </tr>))}
                </tbody>
              </table>)}
          </div>)}

        {tab === 'changelog' && (<div className="p-3">
            <div className="text-[10px] text-zinc-600 font-medium tracking-widest uppercase mb-2">Field Changes</div>
            {loading ? (<div className="text-zinc-600 text-xs py-8 text-center">Loading…</div>) : changelog.length === 0 ? (<div className="text-zinc-600 text-xs py-8 text-center">No changes recorded for this pair.</div>) : (<table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-zinc-600 border-b border-[#1e2025]">
                    {['Type', 'Field', 'Old', 'New', 'Detected'].map(h => (<th key={h} className="py-2 px-3 text-left font-medium">{h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {changelog.map(c => (<tr key={c.id} className="border-b border-[#1e2025]/50 hover:bg-[#161820]">
                      <td className="py-1.5 px-3">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${c.changeType === 'DELIST' ? 'text-red-400 bg-red-400/10' :
                        c.changeType === 'RELIST' ? 'text-emerald-400 bg-emerald-400/10' :
                            'text-amber-400 bg-amber-400/10'}`}>{c.changeType}</span>
                      </td>
                      <td className="py-1.5 px-3 font-mono text-zinc-400">{c.fieldName}</td>
                      <td className="py-1.5 px-3 font-mono text-red-400">{c.oldValue ?? '—'}</td>
                      <td className="py-1.5 px-3 font-mono text-emerald-400">{c.newValue ?? '—'}</td>
                      <td className="py-1.5 px-3 text-zinc-500">{markets_utils_1.fmt.relTime(c.detectedAt)}</td>
                    </tr>))}
                </tbody>
              </table>)}
          </div>)}

        {tab === 'sync' && (<div className="p-3">
            <div className="text-[10px] text-zinc-600 font-medium tracking-widest uppercase mb-2">
              Sync Runs — {row.exchangeDisplayName}
            </div>
            {loading ? (<div className="text-zinc-600 text-xs py-8 text-center">Loading…</div>) : syncHistory.length === 0 ? (<div className="text-zinc-600 text-xs py-8 text-center">No sync history available.</div>) : (<table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-zinc-600 border-b border-[#1e2025]">
                    {['Status', 'Fetched', 'Upserted', 'Delisted', 'Changes', 'Duration', 'Started'].map(h => (<th key={h} className="py-2 px-3 text-left font-medium">{h}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {syncHistory.map(s => (<tr key={s.id} className="border-b border-[#1e2025]/50 hover:bg-[#161820]">
                      <td className="py-1.5 px-3">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${s.status === 'SUCCESS' ? 'text-emerald-400 bg-emerald-400/10' :
                        s.status === 'FAILED' ? 'text-red-400 bg-red-400/10' :
                            'text-amber-400 bg-amber-400/10'}`}>{s.status}</span>
                        {s.errorMessage && (<span className="block text-[9px] text-red-400 mt-0.5">{s.errorMessage.slice(0, 40)}</span>)}
                      </td>
                      <td className="py-1.5 px-3 font-mono text-zinc-300">{s.totalFetched.toLocaleString()}</td>
                      <td className="py-1.5 px-3 font-mono text-zinc-300">{s.totalUpserted.toLocaleString()}</td>
                      <td className="py-1.5 px-3 font-mono text-red-400">{s.totalDelisted}</td>
                      <td className="py-1.5 px-3 font-mono text-amber-400">{s.totalChanges}</td>
                      <td className="py-1.5 px-3 font-mono text-zinc-400">{s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                      <td className="py-1.5 px-3 text-zinc-500">{markets_utils_1.fmt.relTime(s.startedAt)}</td>
                    </tr>))}
                </tbody>
              </table>)}
          </div>)}

        {tab === 'raw' && (<div className="p-3">
            <div className="text-[10px] text-zinc-600 font-medium tracking-widest uppercase mb-2">Raw Data</div>
            <pre className="text-[10px] font-mono text-zinc-400 bg-[#0a0b0d] border border-[#1e2025] rounded p-3 overflow-auto max-h-full">
              {JSON.stringify(row, null, 2)}
            </pre>
          </div>)}
      </div>
    </div>);
}
// ─── Main Grid ────────────────────────────────────────────────────────────────
const ROW_HEIGHT = 30;
const OVERSCAN = 5;
function MarketGrid({ rows, columns, sort, onSort, selectedId, onSelect, }) {
    const containerRef = (0, react_1.useRef)(null);
    const [scrollTop, setScrollTop] = (0, react_1.useState)(0);
    const [viewHeight, setViewHeight] = (0, react_1.useState)(400);
    const visibleCols = columns.filter(c => c.visible);
    const totalWidth = visibleCols.reduce((s, c) => s + c.width, 0);
    (0, react_1.useLayoutEffect)(() => {
        const el = containerRef.current;
        if (!el)
            return;
        const ro = new ResizeObserver(() => setViewHeight(el.clientHeight));
        ro.observe(el);
        setViewHeight(el.clientHeight);
        return () => ro.disconnect();
    }, []);
    const handleScroll = (0, react_1.useCallback)((e) => {
        setScrollTop(e.target.scrollTop);
    }, []);
    const totalHeight = rows.length * ROW_HEIGHT;
    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const endIdx = Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN);
    const visibleRows = rows.slice(startIdx, endIdx);
    const paddingTop = startIdx * ROW_HEIGHT;
    // Keyboard navigation
    (0, react_1.useEffect)(() => {
        const handler = (e) => {
            if (!selectedId)
                return;
            const idx = rows.findIndex(r => r.id === selectedId);
            if (e.key === 'ArrowDown' && idx < rows.length - 1) {
                onSelect(rows[idx + 1]);
                e.preventDefault();
            }
            else if (e.key === 'ArrowUp' && idx > 0) {
                onSelect(rows[idx - 1]);
                e.preventDefault();
            }
            else if (e.key === 'Escape') {
                onSelect(null);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [selectedId, rows, onSelect]);
    return (<div ref={containerRef} className="flex-1 overflow-auto relative" onScroll={handleScroll}>
      <div style={{ height: totalHeight + ROW_HEIGHT, minWidth: totalWidth }} className="relative">

        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex bg-[#0d0e10] border-b border-[#1e2025]" style={{ minWidth: totalWidth }}>
          {visibleCols.map(col => {
            const sortEntry = sort.find(s => s.col === col.key);
            return (<div key={col.key} style={{ width: col.width, minWidth: col.width }} className={`flex items-center gap-1 px-3 py-2 text-[10px] font-medium text-zinc-500 tracking-wider uppercase select-none flex-shrink-0 ${col.sortable ? 'cursor-pointer hover:text-zinc-300 hover:bg-[#161820]' : ''} ${col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : 'justify-start'}`} onClick={() => col.sortable && onSort(col.key)}>
                <span>{col.label}</span>
                {col.sortable && sortEntry && (<span className="text-blue-400">{Icon.Sort(sortEntry.dir)}</span>)}
              </div>);
        })}
        </div>

        {/* Padded virtual top */}
        <div style={{ height: paddingTop }}/>

        {/* Rows */}
        {visibleRows.map((row) => {
            const selected = row.id === selectedId;
            return (<div key={row.id} style={{ height: ROW_HEIGHT, minWidth: totalWidth }} onClick={() => onSelect(row)} className={`flex items-center cursor-pointer border-b border-[#1e2025]/50 transition-colors flex-shrink-0 ${selected
                    ? 'bg-blue-500/10 border-l-2 border-l-blue-500'
                    : 'hover:bg-[#161820]'}`}>
              {visibleCols.map(col => (<div key={col.key} style={{ width: col.width, minWidth: col.width }} className={`px-3 flex items-center flex-shrink-0 overflow-hidden ${col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : 'justify-start'}`}>
                  <markets_utils_1.Cell col={col} row={row}/>
                </div>))}
            </div>);
        })}
      </div>
    </div>);
}
// ─── Main Page ────────────────────────────────────────────────────────────────
function MarketsPage() {
    const [allRows, setAllRows] = (0, react_1.useState)([]);
    const [filters, setFilters] = (0, react_1.useState)(DEFAULT_FILTERS);
    const [sort, setSort] = (0, react_1.useState)([
        { col: 'liquidityScore', dir: 'desc' },
        { col: 'volume24h', dir: 'desc' },
    ]);
    const [columns, setColumns] = (0, react_1.useState)(markets_utils_1.DEFAULT_COLUMNS);
    const [selectedRow, setSelectedRow] = (0, react_1.useState)(null);
    const [inspectorHeight, setInspectorHeight] = (0, react_1.useState)(260);
    const [filterRailOpen, setFilterRailOpen] = (0, react_1.useState)(true);
    const [columnPickerOpen, setColumnPickerOpen] = (0, react_1.useState)(false);
    const [exchangePickerOpen, setExchangePickerOpen] = (0, react_1.useState)(false);
    const [live, setLive] = (0, react_1.useState)(false);
    const [loading, setLoading] = (0, react_1.useState)(false);
    const [exchanges, setExchanges] = (0, react_1.useState)([]);
    const [wsConnected, setWsConnected] = (0, react_1.useState)(false);
    const wsRef = (0, react_1.useRef)(null);
    const liveRef = (0, react_1.useRef)(live);
    liveRef.current = live;
    // ── Load data ───────────────────────────────────────────────────────────────
    const loadMarkets = (0, react_1.useCallback)(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (filters.exchanges.length)
                params.set('exchanges', filters.exchanges.join(','));
            if (filters.search)
                params.set('search', filters.search);
            if (filters.bases.length)
                params.set('base', filters.bases[0]);
            if (filters.quotes.length)
                params.set('quote', filters.quotes[0]);
            if (filters.status.length)
                params.set('status', filters.status.join(','));
            if (filters.marginAvailable)
                params.set('marginAvailable', 'true');
            if (filters.minVolume)
                params.set('minVolume', String(filters.minVolume));
            if (filters.maxSpreadBps)
                params.set('maxSpreadBps', String(filters.maxSpreadBps));
            const sortStr = sort.map(s => `${s.col}:${s.dir}`).join(',');
            params.set('sort', sortStr);
            params.set('pageSize', '2000');
            const res = await fetch(`${markets_utils_1.API_BASE}/markets?${params}`);
            const data = await res.json();
            setAllRows(data.data || []);
        }
        catch {
            // Fall back to mock data in dev/demo
            setAllRows((0, markets_utils_1.generateMockRows)(400));
        }
        finally {
            setLoading(false);
        }
    }, [filters, sort]);
    (0, react_1.useEffect)(() => { loadMarkets(); }, [loadMarkets]);
    // ── Load exchange meta ──────────────────────────────────────────────────────
    (0, react_1.useEffect)(() => {
        fetch(`${markets_utils_1.API_BASE}/markets/meta/exchanges`)
            .then(r => r.json())
            .then(d => setExchanges(d.data || []))
            .catch(() => {
            // Mock exchange meta
            const mocks = [
                'BINANCE', 'BYBIT', 'OKX', 'KUCOIN', 'KRAKEN', 'COINBASE', 'HTX',
                'BITFINEX', 'CRYPTOCOM', 'BINGX', 'BINANCEUS', 'POLONIEX', 'HITBTC', 'BITMART', 'BITVAVO', 'EXMO',
            ].map((e, i) => ({
                exchange: e, displayName: e, tier: i < 7 ? 1 : i < 14 ? 2 : 3,
                region: null, totalPairs: 0, onlinePairs: 0,
                uptimeScore: null, latencyScore: null, reliabilityScore: null, avgSpreadBps: null,
            }));
            setExchanges(mocks);
        });
    }, []);
    // ── WebSocket ──────────────────────────────────────────────────────────────
    (0, react_1.useEffect)(() => {
        if (!live) {
            wsRef.current?.close();
            wsRef.current = null;
            setWsConnected(false);
            return;
        }
        try {
            const ws = new WebSocket(markets_utils_1.WS_URL);
            wsRef.current = ws;
            ws.onopen = () => setWsConnected(true);
            ws.onclose = () => { setWsConnected(false); wsRef.current = null; };
            ws.onmessage = (event) => {
                if (!liveRef.current)
                    return;
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.channel === 'markets:snapshots' && Array.isArray(msg.rows)) {
                        setAllRows(prev => {
                            const map = new Map(prev.map(r => [`${r.exchange}:${r.pairId}`, r]));
                            for (const snap of msg.rows) {
                                const key = `${snap.exchange}:${snap.pairId}`;
                                const existing = map.get(key);
                                if (existing) {
                                    map.set(key, { ...existing, ...snap });
                                }
                            }
                            return Array.from(map.values());
                        });
                    }
                }
                catch { }
            };
            return () => { ws.close(); };
        }
        catch { }
    }, [live]);
    // ── Sort handling ──────────────────────────────────────────────────────────
    const handleSort = (0, react_1.useCallback)((col) => {
        setSort(prev => {
            const existing = prev.find(s => s.col === col);
            if (existing) {
                const next = existing.dir === 'desc' ? 'asc' : 'desc';
                return [{ col, dir: next }, ...prev.filter(s => s.col !== col)];
            }
            return [{ col, dir: 'desc' }, ...prev.slice(0, 2)];
        });
    }, []);
    // ── Client-side filtering + sorting (for fast local response) ───────────────
    const displayRows = (0, react_1.useMemo)(() => {
        let rows = allRows;
        // Search
        if (filters.search) {
            const q = filters.search.toUpperCase();
            rows = rows.filter(r => r.symbol.toUpperCase().includes(q) ||
                r.baseCanonical.includes(q) ||
                r.quoteCanonical.includes(q) ||
                r.pairId.toUpperCase().includes(q) ||
                (r.tvSymbol || '').toUpperCase().includes(q));
        }
        // Exchange
        if (filters.exchanges.length > 0) {
            const set = new Set(filters.exchanges);
            rows = rows.filter(r => set.has(r.exchange));
        }
        // Status
        if (filters.status.length > 0 && filters.status.length < 7) {
            const set = new Set(filters.status);
            rows = rows.filter(r => set.has(r.status));
        }
        // Base
        if (filters.bases.length > 0) {
            const set = new Set(filters.bases);
            rows = rows.filter(r => set.has(r.baseCanonical));
        }
        // Quote
        if (filters.quotes.length > 0) {
            const set = new Set(filters.quotes);
            rows = rows.filter(r => set.has(r.quoteCanonical));
        }
        // Margin
        if (filters.marginAvailable) {
            rows = rows.filter(r => r.marginAvailable);
        }
        // Volume
        if (filters.minVolume !== null) {
            rows = rows.filter(r => r.volume24h !== null && r.volume24h >= filters.minVolume);
        }
        // Spread
        if (filters.maxSpreadBps !== null) {
            rows = rows.filter(r => r.spreadBps !== null && r.spreadBps <= filters.maxSpreadBps);
        }
        // Client-side sort (rows from server are already sorted, but after local filter we re-sort)
        if (sort.length > 0) {
            rows = [...rows].sort((a, b) => {
                for (const s of sort) {
                    const av = a[s.col];
                    const bv = b[s.col];
                    if (av === null || av === undefined)
                        return 1;
                    if (bv === null || bv === undefined)
                        return -1;
                    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
                    if (cmp !== 0)
                        return s.dir === 'desc' ? -cmp : cmp;
                }
                return 0;
            });
        }
        return rows;
    }, [allRows, filters, sort]);
    // ── Export CSV ─────────────────────────────────────────────────────────────
    const exportCSV = (0, react_1.useCallback)(() => {
        const visibleCols = columns.filter(c => c.visible);
        const header = visibleCols.map(c => c.label).join(',');
        const rows = displayRows.map(row => visibleCols.map(c => {
            const v = row[c.key];
            if (v === null || v === undefined)
                return '';
            return String(v).includes(',') ? `"${v}"` : String(v);
        }).join(','));
        const csv = [header, ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `agoraiq-markets-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [columns, displayRows]);
    // ── F key for filter rail ──────────────────────────────────────────────────
    (0, react_1.useEffect)(() => {
        const handler = (e) => {
            if ((e.key === 'f' || e.key === 'F') && document.activeElement?.tagName !== 'INPUT') {
                setFilterRailOpen(v => !v);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);
    return (<div className="flex flex-col h-screen bg-[#0a0b0d] text-zinc-300 overflow-hidden" style={{ fontFamily: "'IBM Plex Sans', 'JetBrains Mono', monospace" }}>

      {/* Top bar */}
      <TopBar filters={filters} onFilter={(f) => setFilters(prev => ({ ...prev, ...f }))} live={live} onToggleLive={() => setLive(v => !v)} onOpenColumns={() => setColumnPickerOpen(true)} onExport={exportCSV} onOpenExchanges={() => setExchangePickerOpen(true)} totalCount={allRows.length} visibleCount={displayRows.length}/>

      {/* Sub-bar: status strip */}
      <div className="flex items-center gap-3 px-3 py-1 bg-[#0a0b0d] border-b border-[#1e2025] text-[10px] text-zinc-600">
        <button onClick={() => setFilterRailOpen(v => !v)} className="flex items-center gap-1 hover:text-zinc-400">
          <Icon.Filter />
          <kbd className="border border-zinc-800 rounded px-0.5">F</kbd>
          <span>{filterRailOpen ? 'Hide' : 'Show'} Filters</span>
        </button>
        <span className="text-zinc-800">|</span>
        {wsConnected && (<span className="flex items-center gap-1 text-emerald-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"/>
            WS Connected
          </span>)}
        {loading && (<span className="text-zinc-600">Syncing…</span>)}
        {sort.length > 0 && (<span className="text-zinc-700">
            Sort: {sort.map(s => `${s.col} ${s.dir}`).join(', ')}
            <button onClick={() => setSort([{ col: 'liquidityScore', dir: 'desc' }, { col: 'volume24h', dir: 'desc' }])} className="ml-1 text-zinc-600 hover:text-zinc-400">↺</button>
          </span>)}
        <div className="flex-1"/>
        <span>↑↓ navigate · Enter inspect · Esc close · / search · E exchanges · F filters · C columns</span>
      </div>

      {/* Main body */}
      <div className="flex flex-1 min-h-0">
        {/* Left rail */}
        <LeftRail open={filterRailOpen} filters={filters} onFilter={(f) => setFilters(prev => ({ ...prev, ...f }))} exchanges={exchanges}/>

        {/* Grid + inspector */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <MarketGrid rows={displayRows} columns={columns} sort={sort} onSort={handleSort} selectedId={selectedRow?.id || null} onSelect={(row) => {
            if (selectedRow?.id === row?.id) {
                setSelectedRow(null);
            }
            else {
                setSelectedRow(row);
            }
        }}/>

          {/* Inspector */}
          {selectedRow && (<Inspector row={selectedRow} onClose={() => setSelectedRow(null)} height={inspectorHeight} onResize={(h) => setInspectorHeight(Math.max(180, Math.min(600, h)))}/>)}
        </div>
      </div>

      {/* Column picker modal */}
      {columnPickerOpen && (<ColumnPicker columns={columns} onClose={() => setColumnPickerOpen(false)} onChange={setColumns}/>)}

      {/* Exchange picker modal */}
      {exchangePickerOpen && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#13141a] border border-[#2a2d35] rounded-lg shadow-2xl w-80">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2d35]">
              <span className="text-sm font-semibold text-zinc-200">Select Exchanges</span>
              <button onClick={() => setExchangePickerOpen(false)} className="text-zinc-500 hover:text-zinc-200"><Icon.Close /></button>
            </div>
            <div className="p-3 space-y-0.5 max-h-[400px] overflow-y-auto">
              <div className="flex gap-2 mb-3 px-1">
                <button onClick={() => setFilters(prev => ({ ...prev, exchanges: [] }))} className="text-[10px] text-zinc-500 hover:text-zinc-300 border border-zinc-700 px-2 py-1 rounded">All exchanges</button>
                <button onClick={() => {
                const t1 = exchanges.filter(e => e.tier === 1).map(e => e.exchange);
                setFilters(prev => ({ ...prev, exchanges: t1 }));
            }} className="text-[10px] text-zinc-500 hover:text-zinc-300 border border-zinc-700 px-2 py-1 rounded">Tier 1 only</button>
              </div>
              {[1, 2, 3].map(tier => (<div key={tier}>
                  <div className="text-[9px] text-zinc-700 font-medium tracking-widest uppercase px-2 py-1">
                    Tier {tier}
                  </div>
                  {exchanges.filter(e => e.tier === tier).map(ex => {
                    const active = filters.exchanges.includes(ex.exchange);
                    return (<label key={ex.exchange} className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-[#1e2025] rounded cursor-pointer">
                        <input type="checkbox" checked={active || filters.exchanges.length === 0} onChange={() => {
                            const list = filters.exchanges.length === 0
                                ? exchanges.map(e => e.exchange).filter(e => e !== ex.exchange)
                                : active
                                    ? filters.exchanges.filter(e => e !== ex.exchange)
                                    : [...filters.exchanges, ex.exchange];
                            setFilters(prev => ({ ...prev, exchanges: list }));
                        }} className="w-3.5 h-3.5 accent-blue-500"/>
                        <span className={`text-xs ${active || filters.exchanges.length === 0 ? 'text-zinc-200' : 'text-zinc-500'}`}>
                          {ex.displayName}
                        </span>
                        {ex.totalPairs > 0 && (<span className="ml-auto text-[10px] text-zinc-600 font-mono">{ex.totalPairs.toLocaleString()}</span>)}
                      </label>);
                })}
                </div>))}
            </div>
            <div className="px-4 py-3 border-t border-[#2a2d35] flex justify-end gap-2">
              <button onClick={() => setFilters(prev => ({ ...prev, exchanges: [] }))} className="text-xs text-zinc-500 hover:text-zinc-300">Clear</button>
              <button onClick={() => setExchangePickerOpen(false)} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded">Apply</button>
            </div>
          </div>
        </div>)}
    </div>);
}
//# sourceMappingURL=MarketsPage.js.map