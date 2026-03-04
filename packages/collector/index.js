#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// AgoraIQ Market Stat Collector
//
// Subscribes to WebSocket ticker feeds from:
//   - Binance   (wss://stream.binance.com:9443)
//   - Bybit     (wss://stream.bybit.com/v5/public/spot)
//   - Kraken    (wss://ws.kraken.com/v2)
//   - Coinbase  (wss://advanced-trade-ws.coinbase.com)
//
// Buffers updates and POSTs batches to /api/v1/markets/stats
// every FLUSH_INTERVAL_MS (default 10s).
// Refreshes materialized view every REFRESH_INTERVAL_MS (60s).
// ═══════════════════════════════════════════════════════════════

const WebSocket = require('ws');
const { SocksProxyAgent } = require('socks-proxy-agent');
const BINANCE_PROXY = process.env.BINANCE_PROXY || 'socks5://143.198.202.65:1080';
const binanceAgent = new SocksProxyAgent(BINANCE_PROXY);
const https     = require('https');
const http      = require('http');

// ── Config ────────────────────────────────────────────────────
const API_BASE          = process.env.MI_API_BASE   || 'http://127.0.0.1:4000/api/v1/markets';
const FLUSH_INTERVAL_MS = parseInt(process.env.FLUSH_INTERVAL_MS  || '10000');
const REFRESH_INTERVAL_MS = parseInt(process.env.REFRESH_INTERVAL_MS || '60000');
const MAX_PAIRS_PER_EX  = parseInt(process.env.MAX_PAIRS_PER_EX   || '300');
const LOG_LEVEL         = process.env.LOG_LEVEL || 'info'; // debug|info|warn|error

// ── Logger ────────────────────────────────────────────────────
function log(level, msg, data = {}) {
  const levels = { debug:0, info:1, warn:2, error:3 };
  if ((levels[level] || 0) < (levels[LOG_LEVEL] || 1)) return;
  const ts = new Date().toISOString().slice(11,23);
  const ex = data.exchange ? ` [${data.exchange}]` : '';
  const suffix = Object.keys(data).filter(k=>k!=='exchange').map(k=>`${k}=${data[k]}`).join(' ');
  console.log(`${ts} ${level.toUpperCase().padEnd(5)}${ex} ${msg}${suffix?' — '+suffix:''}`);
}

// ── Buffer: exchange:pairId → latest stat ─────────────────────
const statBuffer = new Map(); // key: "EXCHANGE:pairId" → stat object

function buffer(exchange, pairId, stat) {
  const key = `${exchange}:${pairId}`;
  const existing = statBuffer.get(key);
  statBuffer.set(key, { ...existing, ...stat, exchange, pairId });
}


function calcScores(volume24hUsd, spreadBps) {
  // Liquidity: log-normalized volume, capped at 100
  let liquidityScore = null;
  if (volume24hUsd != null && volume24hUsd > 0) {
    // log10 scale: $1K=20, $100K=40, $1M=60, $10M=75, $100M=88, $1B=100
    const log = Math.log10(volume24hUsd);
    liquidityScore = Math.min(100, Math.max(0, Math.round((log - 3) * 12.5)));
  }
  // Volatility proxy: inverse of spread tightness
  let volatilityScore = null;
  if (spreadBps != null && spreadBps >= 0) {
    // tight spread (<1bps)=20 volatile, wide spread (>100bps)=90 volatile
    volatilityScore = Math.min(100, Math.max(0, Math.round(Math.log10(spreadBps + 0.1) * 40 + 20)));
  }
  return { liquidityScore, volatilityScore };
}

function calcSpread(bid, ask) {
  const b = parseFloat(bid), a = parseFloat(ask);
  if (!b || !a || b<=0 || a<=0) return { spreadAbs: null, spreadBps: null };
  const spreadAbs = a - b;
  const spreadBps = (spreadAbs / b) * 10000;
  return { spreadAbs: +spreadAbs.toFixed(8), spreadBps: +spreadBps.toFixed(4) };
}

// ── HTTP helpers ──────────────────────────────────────────────
function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url  = new URL(API_BASE + path);
    const mod  = url.protocol === 'https:' ? https : http;
    const req  = mod.request({
      hostname: url.hostname,
      port:     url.port || (url.protocol==='https:'?443:80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(data) },
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

// ── Flush buffer → API ────────────────────────────────────────
let flushCount = 0;
async function flush() {
  if (!statBuffer.size) return;

  const rows = [];
  for (const stat of statBuffer.values()) {
    if (!stat.pairId || !stat.exchange) continue;
    // Compute scores from available data
    // Use volUsd if available, else estimate from base volume * last price
    const volUsd = stat.volume24hUsd != null ? parseFloat(stat.volume24hUsd) :
                   (stat.volume24h != null && stat.last != null) ? parseFloat(stat.volume24h) * parseFloat(stat.last) :
                   stat.volume24h != null ? parseFloat(stat.volume24h) : null;
    const { liquidityScore, volatilityScore } = calcScores(volUsd, stat.spreadBps ? parseFloat(stat.spreadBps) : null);
    if (liquidityScore  != null) stat.liquidityScore  = liquidityScore;
    if (volatilityScore != null) stat.volatilityScore = volatilityScore;
    rows.push(stat);
  }
  if (!rows.length) return;

  // Split into batches of 500
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      const r = await post('/stats', batch);
      if (r.status === 200) {
        const d = JSON.parse(r.body);
        inserted += d.inserted || 0;
      } else {
        log('warn', 'Flush batch failed', { status: r.status, body: r.body.slice(0,100) });
      }
    } catch (e) {
      log('error', 'Flush error', { err: e.message });
    }
  }

  flushCount++;
  if (flushCount % 6 === 0) { // log every minute
    log('info', `Flush #${flushCount}`, { rows: rows.length, inserted });
  }
}

// ── Refresh materialized view ─────────────────────────────────
async function refreshView() {
  try {
    const r = await post('/refresh-view', {});
    if (r.status === 200) {
      log('debug', 'Materialized view refreshed');
    }
  } catch(e) {
    log('warn', 'View refresh failed', { err: e.message });
  }
}

// ── WebSocket manager ─────────────────────────────────────────
class ExchangeConnector {
  constructor(name, url, wsOptions, onOpen, onMessage) {
    this.name      = name;
    this.url       = url;
    this.wsOptions = wsOptions || {};
    this.onOpen    = onOpen;
    this.onMessage = onMessage;
    this.ws        = null;
    this.reconnectDelay = 5000;
    this.alive     = false;
    this.tickCount = 0;
    this.pingTimer = null;
  }

  connect() {
    log('info', 'Connecting…', { exchange: this.name });
    this.ws = new WebSocket(this.url, { handshakeTimeout: 10000, ...this.wsOptions });

    this.ws.on('open', () => {
      this.alive = true;
      this.reconnectDelay = 5000;
      log('info', 'Connected', { exchange: this.name });
      this.onOpen(this.ws);
      this.startPing();
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.onMessage(msg);
        this.tickCount++;
      } catch(e) {}
    });

    this.ws.on('close', (code) => {
      this.alive = false;
      this.stopPing();
      log('warn', `Disconnected (${code}), reconnecting in ${this.reconnectDelay/1000}s`, { exchange: this.name });
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 60000);
    });

    this.ws.on('error', (e) => {
      log('warn', 'WS error', { exchange: this.name, err: e.message });
    });

    this.ws.on('pong', () => { this.alive = true; });
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  startPing() {
    this.pingTimer = setInterval(() => {
      if (!this.alive) {
        log('warn', 'Ping timeout, closing', { exchange: this.name });
        this.ws?.terminate();
        return;
      }
      this.alive = false;
      this.ws?.ping();
    }, 30000);
  }

  stopPing() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }
}

// ── BINANCE ───────────────────────────────────────────────────
// Subscribe to all mini-tickers (24h rolling) — one message per symbol
function connectBinance() {
  const conn = new ExchangeConnector(
    'BINANCE',
    'wss://stream.binance.com:9443/ws/!miniTicker@arr',
    { agent: binanceAgent },
    (ws) => {
      // Stream is push-only, no subscription message needed
    },
    (msg) => {
      if (!Array.isArray(msg)) return;
      let count = 0;
      for (const t of msg) {
        if (count >= MAX_PAIRS_PER_EX) break;
        if (t.e !== '24hrMiniTicker') continue;
        // t.s = symbol (BTCUSDT), t.c = close, t.v = volume, t.q = quoteVolume
        const pairId = t.s;
        buffer('BINANCE', pairId, {
          last:         parseFloat(t.c) || null,
          volume24h:    parseFloat(t.v) || null,
          volume24hUsd: parseFloat(t.q) || null,
        });
        count++;
      }
    }
  );

  // Also connect to book ticker for bid/ask
  const bookConn = new ExchangeConnector(
    'BINANCE_BOOK',
    'wss://stream.binance.com:9443/ws/!bookTicker',
    { agent: binanceAgent },
    () => {},
    (msg) => {
      if (!msg.s) return;
      const { spreadAbs, spreadBps } = calcSpread(msg.b, msg.a);
      const existing = statBuffer.get(`BINANCE:${msg.s}`) || {};
      buffer('BINANCE', msg.s, {
        bid: parseFloat(msg.b) || null,
        ask: parseFloat(msg.a) || null,
        spreadAbs,
        spreadBps,
      });
    }
  );

  conn.connect();
  bookConn.connect();

  // Log stats every minute
  setInterval(() => {
    log('debug', `Tick count`, { exchange: 'BINANCE', ticks: conn.tickCount });
    conn.tickCount = 0;
  }, 60000);
}

// ── BYBIT ─────────────────────────────────────────────────────
function connectBybit() {
  let pairsFetched = false;

  // First fetch pair list from DB via API to know what to subscribe to
  fetchBybitPairs().then(pairs => {
    connectBybitBook(pairs);
    const conn = new ExchangeConnector(
      'BYBIT',
      'wss://stream.bybit.com/v5/public/spot',
      (ws) => {
        // Subscribe to tickers in batches of 10 (Bybit limit per message)
        const top = pairs.slice(0, MAX_PAIRS_PER_EX);
        const topics = top.map(p => `tickers.${p}`);
        for (let i = 0; i < topics.length; i += 10) {
          ws.send(JSON.stringify({
            op: 'subscribe',
            args: topics.slice(i, i + 10),
          }));
        }
        log('info', `Subscribed to ${top.length} pairs`, { exchange: 'BYBIT' });
      },
      (msg) => {
        if (msg.topic?.startsWith('tickers.') && msg.data) {
          const d = msg.data;
          const pairId = d.symbol;
          if (!pairId) return;
          const { spreadAbs, spreadBps } = calcSpread(d.bid1Price, d.ask1Price);
          buffer('BYBIT', pairId, {
            bid:          parseFloat(d.bid1Price)  || null,
            ask:          parseFloat(d.ask1Price)  || null,
            last:         parseFloat(d.lastPrice)  || null,
            volume24h:    parseFloat(d.volume24h)  || null,
            volume24hUsd: parseFloat(d.turnover24h)|| null,
            spreadAbs,
            spreadBps,
          });
        }
      }
    );
    conn.connect();
  });
}


// ── BYBIT ORDERBOOK (bid/ask) ──────────────────────────────────────────────
function connectBybitBook(pairs) {
  const conn = new ExchangeConnector(
    'BYBIT_BOOK',
    'wss://stream.bybit.com/v5/public/spot',
    {},
    (ws) => {
      const top = pairs.slice(0, MAX_PAIRS_PER_EX);
      const topics = top.map(p => `orderbook.1.${p}`);
      for (let i = 0; i < topics.length; i += 10) {
        ws.send(JSON.stringify({ op: 'subscribe', args: topics.slice(i, i + 10) }));
      }
      log('info', `Subscribed to ${top.length} orderbook streams`, { exchange: 'BYBIT_BOOK' });
    },
    (msg) => {
      if (!msg.topic?.startsWith('orderbook.1.') || !msg.data) return;
      const d = msg.data;
      const pairId = msg.topic.replace('orderbook.1.', '');
      const bid = d.b?.[0]?.[0]; // best bid
      const ask = d.a?.[0]?.[0]; // best ask
      if (!bid && !ask) return;
      const { spreadAbs, spreadBps } = calcSpread(bid, ask);
      buffer('BYBIT', pairId, {
        bid:      parseFloat(bid) || null,
        ask:      parseFloat(ask) || null,
        spreadAbs,
        spreadBps,
      });
    }
  );
  conn.connect();
}

async function fetchBybitPairs() {
  return new Promise((resolve) => {
    const url = new URL(API_BASE + '?exchanges=BYBIT&pageSize=500&status=ONLINE');
    const mod = url.protocol === 'https:' ? https : http;
    let raw = '';
    const req = mod.get({
      hostname: url.hostname, port: url.port || 80,
      path: url.pathname + url.search,
    }, res => {
      res.on('data', d => raw += d);
      res.on('end', () => {
        try {
          const d = JSON.parse(raw);
          resolve((d.data || []).map(r => r.pairId));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(10000, () => { req.destroy(); resolve([]); });
  });
}

// ── KRAKEN ────────────────────────────────────────────────────
function connectKraken() {
  fetchKrakenPairs().then(pairs => {
    const conn = new ExchangeConnector(
      'KRAKEN',
      'wss://ws.kraken.com/v2',
      (ws) => {
        const top = pairs.slice(0, MAX_PAIRS_PER_EX);
        ws.send(JSON.stringify({
          method: 'subscribe',
          params: {
            channel: 'ticker',
            symbol: top,
          }
        }));
        log('info', `Subscribed to ${top.length} pairs`, { exchange: 'KRAKEN' });
      },
      (msg) => {
        if (msg.channel !== 'ticker' || !Array.isArray(msg.data)) return;
        for (const d of msg.data) {
          // Kraken uses "XBT/USD" format → map to pairId
          const symbol = d.symbol; // e.g. "BTC/USD"
          if (!symbol) continue;
          // Convert to Kraken pairId format (remove slash)
          const pairId = symbol.replace('XBT','BTC').replace('/','');
          const { spreadAbs, spreadBps } = calcSpread(d.bid, d.ask);
          buffer('KRAKEN', pairId, {
            bid:          d.bid   || null,
            ask:          d.ask   || null,
            last:         d.last  || null,
            volume24h:    d.volume|| null,
            spreadAbs,
            spreadBps,
          });
        }
      }
    );
    conn.connect();
  });
}

async function fetchKrakenPairs() {
  return new Promise((resolve) => {
    const url = new URL(API_BASE + '?exchanges=KRAKEN&pageSize=500&status=ONLINE');
    const mod = url.protocol === 'https:' ? https : http;
    let raw = '';
    const req = mod.get({
      hostname: url.hostname, port: url.port || 80,
      path: url.pathname + url.search,
    }, res => {
      res.on('data', d => raw += d);
      res.on('end', () => {
        try {
          const d = JSON.parse(raw);
          // Kraken uses slash-separated symbols e.g. "BTC/USD"
          resolve((d.data || []).map(r => r.symbol));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(10000, () => { req.destroy(); resolve([]); });
  });
}

// ── COINBASE ──────────────────────────────────────────────────
function connectCoinbase() {
  fetchCoinbasePairs().then(pairs => {
    const conn = new ExchangeConnector(
      'COINBASE',
      'wss://advanced-trade-ws.coinbase.com',
      (ws) => {
        const top = pairs.slice(0, MAX_PAIRS_PER_EX);
        ws.send(JSON.stringify({
          type: 'subscribe',
          product_ids: top,
          channel: 'ticker',
        }));
        log('info', `Subscribed to ${top.length} pairs`, { exchange: 'COINBASE' });
      },
      (msg) => {
        if (msg.channel !== 'ticker') return;
        const events = msg.events || [];
        for (const ev of events) {
          for (const t of (ev.tickers || [])) {
            const pairId = t.product_id; // e.g. "BTC-USD"
            if (!pairId) continue;
            const { spreadAbs, spreadBps } = calcSpread(t.best_bid, t.best_ask);
            buffer('COINBASE', pairId, {
              bid:          parseFloat(t.best_bid)  || null,
              ask:          parseFloat(t.best_ask)  || null,
              last:         parseFloat(t.price)     || null,
              volume24h:    parseFloat(t.volume_24_h)|| null,
              spreadAbs,
              spreadBps,
            });
          }
        }
      }
    );
    conn.connect();
  });
}

async function fetchCoinbasePairs() {
  return new Promise((resolve) => {
    const url = new URL(API_BASE + '?exchanges=COINBASE&pageSize=500&status=ONLINE');
    const mod = url.protocol === 'https:' ? https : http;
    let raw = '';
    const req = mod.get({
      hostname: url.hostname, port: url.port || 80,
      path: url.pathname + url.search,
    }, res => {
      res.on('data', d => raw += d);
      res.on('end', () => {
        try {
          const d = JSON.parse(raw);
          // Coinbase uses dash-separated e.g. "BTC-USD"
          resolve((d.data || []).map(r => r.pairId));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(10000, () => { req.destroy(); resolve([]); });
  });
}

// ── Status reporter ───────────────────────────────────────────
setInterval(() => {
  log('info', 'Buffer status', {
    buffered: statBuffer.size,
    flushes:  flushCount,
  });
}, 120000);

// ── Boot ──────────────────────────────────────────────────────
log('info', '═══════════════════════════════════════════');
log('info', ' AgoraIQ Market Stat Collector starting…');
log('info', `  API:           ${API_BASE}`);
log('info', `  Flush every:   ${FLUSH_INTERVAL_MS/1000}s`);
log('info', `  Refresh every: ${REFRESH_INTERVAL_MS/1000}s`);
log('info', `  Max pairs/ex:  ${MAX_PAIRS_PER_EX}`);
log('info', '═══════════════════════════════════════════');

// Start exchange connectors
connectBinance();
setTimeout(connectBybit,   2000);
setTimeout(connectKraken,  4000);
setTimeout(connectCoinbase,6000);

// Flush loop
setInterval(flush, FLUSH_INTERVAL_MS);

// View refresh loop
setInterval(refreshView, REFRESH_INTERVAL_MS);

// Graceful shutdown
process.on('SIGTERM', async () => {
  log('info', 'SIGTERM received — flushing before exit…');
  await flush();
  process.exit(0);
});
process.on('SIGINT', async () => {
  log('info', 'SIGINT received — flushing before exit…');
  await flush();
  process.exit(0);
});
