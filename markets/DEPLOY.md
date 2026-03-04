# AgoraIQ Markets Module — Deploy Guide (v7)

## Deliverables

```
markets/
├── market-stat-migration.sql       → Run against your PostgreSQL
├── markets-api-additions.mjs       → Routes to splice into server.mjs
└── src/
    ├── types/market.ts             → TypeScript types
    └── pages/
        ├── markets-utils.tsx       → Column defs, formatters, Cell renderer
        └── MarketsPage.tsx         → Full Markets page component
```

---

## 1. Database — Run the Migration

```bash
# Against your market_intelligence schema
psql $DATABASE_URL -f market-stat-migration.sql
```

This creates:
- `market_stats` — time-bucketed price/spread/volume snapshots
- `market_stats_latest` — materialized view of the latest stat per pair
- `exchange_meta` — exchange display names, tiers, scores
- `prune_market_stats()` — retention function (call daily)

---

## 2. Backend — Add API Routes

### Splice routes into server.mjs

Copy the entire contents of `markets-api-additions.mjs` and paste it
into `server.mjs` BEFORE the `// ── Error handler` line.

Then add WebSocket support at the top of server.mjs:

```js
import { WebSocketServer } from 'ws';
import { createServer }    from 'http';

// ... existing imports ...

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws/markets' });

function wsBroadcast(channel, payload) {
  const msg = JSON.stringify({ channel, ...payload });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ channel: 'connected', ts: new Date().toISOString() }));
  ws.on('error', () => {});
});

// Replace app.listen with:
httpServer.listen(PORT, '127.0.0.1', () => { /* ... */ });
```

Add `ws` to your package.json dependencies:
```bash
npm install ws
```

---

## 3. Frontend — Add to React App

### Install IBM Plex Sans font (add to index.html)
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### Copy source files to your React project
```
src/types/market.ts            → your-app/src/types/market.ts
src/pages/markets-utils.tsx    → your-app/src/pages/markets-utils.tsx
src/pages/MarketsPage.tsx      → your-app/src/pages/MarketsPage.tsx
```

### Add env vars (.env)
```
VITE_MI_API_URL=https://intel.agoraiq.net/api/v1
VITE_MI_WS_URL=wss://intel.agoraiq.net/ws/markets
```

### Add to your router
```tsx
import MarketsPage from './pages/MarketsPage';

// In your router:
<Route path="/markets" element={<MarketsPage />} />
```

### Tailwind config — ensure these are present in content array
```js
content: ['./src/**/*.{ts,tsx}']
```

---

## 4. MarketStat Data Pipeline

The `market_stats` table needs a feeder. Options:

### Option A — REST ingest (immediate)
POST batches to `/api/v1/markets/stats` from any data source:
```bash
curl -X POST https://intel.agoraiq.net/api/v1/markets/stats \
  -H 'Content-Type: application/json' \
  -d '[{"exchange":"BINANCE","pairId":"BTCUSDT","bid":67000,"ask":67002,"last":67001,"spreadAbs":2,"spreadBps":0.03,"volume24h":45000,"liquidityScore":95,"volatilityScore":32}]'
```

### Option B — Dedicated stat collector (recommended)
Create `src/stats-collector.mjs` that:
1. Subscribes to exchange WebSocket ticker feeds
2. Computes spread, scores, funding
3. POSTs batches to your own `/api/v1/markets/stats` every 5–10 seconds

### Refresh materialized view
Run every 30–60 seconds via cron or after each stat batch:
```bash
curl -X POST https://intel.agoraiq.net/api/v1/markets/stats/refresh-view
```

Or via pg_cron:
```sql
SELECT cron.schedule('refresh-market-stats', '* * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY market_stats_latest');
```

---

## 5. New API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/markets` | Main grid — paginated, filtered, sorted |
| GET | `/api/v1/markets/compare?base=BTC&quote=USDT` | Cross-exchange compare |
| GET | `/api/v1/markets/:exchange/:pairId` | Full row detail |
| GET | `/api/v1/markets/meta/exchanges` | Exchange list + stats |
| GET | `/api/v1/markets/meta/assets` | Top base/quote assets |
| POST | `/api/v1/markets/stats` | Ingest stat snapshots (batch) |
| POST | `/api/v1/markets/stats/refresh-view` | Refresh materialized view |

---

## 6. Features at a Glance

### Top Bar
- Global typeahead search (/, shortcut)
- Status filter pills (ONLINE / POST / LIMIT / CANCEL / DELISTED)
- Exchange picker (E shortcut)
- Live/Paused toggle (WebSocket)
- Column chooser (C shortcut)
- CSV export

### Left Rail (F to toggle)
- Exchange checkboxes with Tier 1 quick-select
- Base asset pills (BTC / ETH / SOL…)
- Quote pills (USDT / USDC / USD…)
- Margin toggle
- Min volume input
- Max spread bps input

### Main Grid
- Virtualized (handles 5000+ rows without frame drops)
- Multi-sort (click header, holds 3 sort levels)
- Click-to-select row → opens inspector
- ↑↓ keyboard navigation, Esc to close
- Columns: Exchange, Pair, Status, Price, Spread bps, Vol 24h,
  Liquidity score, Volatility score, Funding, Margin, and more

### Bottom Inspector (drag to resize)
- Tab 1: Overview — stats grid + pair specs + copy buttons
- Tab 2: Cross-Exchange Compare — best spread/volume/liquidity tags
- Tab 3: Changelog — field change history from MarketChangelog
- Tab 4: Sync History — exchange sync run log
- Tab 5: Raw — full JSON dump
