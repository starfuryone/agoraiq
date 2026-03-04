"use strict";
// ═══════════════════════════════════════════════════════════════
// @agoraiq/tracker — Price Service (PATCHED — Proxy Hardened)
//
// Fetches candle/price data from Binance, Bybit, Kraken.
//
// SOCKS5 PROXY ROUTING (env-var-only, no hardcoded addresses):
//   Binance (spot + futures) and Bybit → via SOCKS5 proxy
//   Kraken and everything else         → direct (no proxy)
//
// If the proxy is unavailable:
//   1. Log a warning (never leaking credentials or host)
//   2. Retry via direct connection if OUTBOUND_PROXY_FALLBACK_DIRECT=true
//   3. Otherwise, fail the fetch gracefully (trade stays ACTIVE, retried later)
//
// Environment:
//   OUTBOUND_PROXY_SOCKS5_HOST     — e.g. "143.198.202.65"
//   OUTBOUND_PROXY_SOCKS5_PORT     — e.g. "1080"
//   OUTBOUND_PROXY_SOCKS5_USERNAME — optional auth
//   OUTBOUND_PROXY_SOCKS5_PASSWORD — optional auth
//   OUTBOUND_PROXY_FALLBACK_DIRECT — "true" to retry without proxy on failure (default: "true")
//
//   Legacy compat (read if new vars absent):
//   SOCKS_PROXY_URL / SOCKS_PROXY_USERNAME / SOCKS_PROXY_PASSWORD
// ═══════════════════════════════════════════════════════════════
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentPrice = getCurrentPrice;
exports.checkPriceHit = checkPriceHit;
const node_https_1 = __importDefault(require("node:https"));
const node_http_1 = __importDefault(require("node:http"));
const node_url_1 = require("node:url");
const socks_proxy_agent_1 = require("socks-proxy-agent");
const db_1 = require("@agoraiq/db");
const log = (0, db_1.createLogger)('price-service');
// ── SOCKS5 Proxy Configuration (ENV ONLY) ─────────────────────
function resolveProxyConfig() {
    // New env vars take precedence
    const host = process.env.OUTBOUND_PROXY_SOCKS5_HOST;
    const port = process.env.OUTBOUND_PROXY_SOCKS5_PORT || '1080';
    const user = process.env.OUTBOUND_PROXY_SOCKS5_USERNAME || '';
    const pass = process.env.OUTBOUND_PROXY_SOCKS5_PASSWORD || '';
    if (host) {
        const auth = user && pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
        return { url: `socks5://${auth}${host}:${port}`, enabled: true };
    }
    // Legacy fallback: SOCKS_PROXY_URL
    const legacyUrl = process.env.SOCKS_PROXY_URL;
    if (legacyUrl) {
        const legacyUser = process.env.SOCKS_PROXY_USERNAME || '';
        const legacyPass = process.env.SOCKS_PROXY_PASSWORD || '';
        if (legacyUser && legacyPass) {
            try {
                const parsed = new node_url_1.URL(legacyUrl);
                parsed.username = legacyUser;
                parsed.password = legacyPass;
                return { url: parsed.toString(), enabled: true };
            }
            catch {
                return { url: legacyUrl, enabled: true };
            }
        }
        return { url: legacyUrl, enabled: true };
    }
    // No proxy configured
    return { url: '', enabled: false };
}
const PROXY_CONFIG = resolveProxyConfig();
const PROXY_FALLBACK_DIRECT = (process.env.OUTBOUND_PROXY_FALLBACK_DIRECT || 'true') === 'true';
let _socksAgent = null;
function getSocksAgent() {
    if (!PROXY_CONFIG.enabled)
        return null;
    if (!_socksAgent) {
        try {
            _socksAgent = new socks_proxy_agent_1.SocksProxyAgent(PROXY_CONFIG.url);
            // Log that proxy is active WITHOUT leaking the full URL or credentials
            const safeHost = process.env.OUTBOUND_PROXY_SOCKS5_HOST || 'configured-host';
            log.info({ proxyHost: safeHost }, 'SOCKS5 proxy agent initialized');
        }
        catch (err) {
            log.error({ err: err.message }, 'Failed to create SOCKS5 agent — proxy disabled');
            return null;
        }
    }
    return _socksAgent;
}
// Exchanges that SHOULD route through the SOCKS proxy (when available)
const PROXIED_EXCHANGES = new Set([
    'BINANCE_SPOT',
    'BINANCE_FUTURES',
    'BYBIT',
]);
const priceCache = new Map();
const PRICE_CACHE_TTL_MS = 5 * 60_000; // 5 minutes
// ── Exchange Config ───────────────────────────────────────────
const BINANCE_SPOT = process.env.BINANCE_API_BASE || 'https://api.binance.com';
const BINANCE_FUTURES = process.env.BINANCE_FUTURES_API_BASE || 'https://fapi.binance.com';
const BYBIT_API = process.env.BYBIT_API_BASE || 'https://api.bybit.com';
const KRAKEN_API = process.env.KRAKEN_API_BASE || 'https://api.kraken.com';
const COINBASE_API = process.env.COINBASE_API_BASE || 'https://api.exchange.coinbase.com';
// ── Symbol Mapping ────────────────────────────────────────────
function mapSymbol(symbol, exchange) {
    const sym = symbol.toUpperCase();
    if (exchange === 'KRAKEN') {
        const krakenMap = {
            'BTCUSDT': 'XBTUSDT',
            'BTCUSD': 'XXBTZUSD',
            'ETHUSDT': 'ETHUSDT',
            'ETHUSD': 'XETHZUSD',
        };
        return krakenMap[sym] || sym;
    }
    if (exchange === 'COINBASE') {
        const coinbaseMap = {
            'BTCUSDT': 'BTC-USDT', 'BTCUSD': 'BTC-USD',
            'ETHUSDT': 'ETH-USDT', 'ETHUSD': 'ETH-USD',
            'SOLUSDT': 'SOL-USDT', 'SOLUSD': 'SOL-USD',
            'XRPUSDT': 'XRP-USDT', 'DOGEUSDT': 'DOGE-USDT',
            'ADAUSDT': 'ADA-USDT', 'AVAXUSDT': 'AVAX-USDT',
            'LINKUSDT': 'LINK-USDT', 'DOTUSDT': 'DOT-USDT',
        };
        if (coinbaseMap[sym])
            return coinbaseMap[sym];
        if (sym.endsWith('USDT'))
            return sym.slice(0, -4) + '-USDT';
        if (sym.endsWith('USD'))
            return sym.slice(0, -3) + '-USD';
        return sym;
    }
    return sym;
}
// ── HTTP GET (proxy-aware with safe fallback) ─────────────────
function httpGet(url, useProxy) {
    return new Promise((resolve, reject) => {
        const parsed = new node_url_1.URL(url);
        const isHttps = parsed.protocol === 'https:';
        const mod = isHttps ? node_https_1.default : node_http_1.default;
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'AgoraIQ-Tracker/1.0',
            },
            timeout: 15_000,
        };
        if (useProxy) {
            const agent = getSocksAgent();
            if (agent) {
                options.agent = agent;
            }
            else {
                // Proxy requested but agent unavailable — treat as no proxy
                log.debug({ host: parsed.hostname }, 'Proxy agent unavailable — connecting direct');
            }
        }
        const req = mod.request(options, (res) => {
            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                res.resume(); // drain to free socket
                reject(new Error(`HTTP ${res.statusCode} from ${parsed.hostname}${parsed.pathname}`));
                return;
            }
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy(new Error(`Timeout (15s) fetching ${parsed.hostname}`));
        });
        req.end();
    });
}
async function fetchJson(url, useProxy) {
    const body = await httpGet(url, useProxy);
    return JSON.parse(body);
}
// ── Fetch with Retry + Proxy Fallback ─────────────────────────
async function fetchWithRetry(url, useProxy, retries = 3, delay = 1000) {
    const urlHost = new node_url_1.URL(url).hostname; // safe to log (no credentials)
    // Phase 1: Try with proxy (if requested)
    if (useProxy) {
        for (let i = 0; i < retries; i++) {
            try {
                return await fetchJson(url, true);
            }
            catch (err) {
                const isLastRetry = i === retries - 1;
                if (isLastRetry) {
                    // Log warning WITHOUT leaking proxy credentials
                    log.warn({ host: urlHost, attempts: retries }, 'All proxy attempts failed — proxy may be down');
                }
                else {
                    const wait = delay * Math.pow(2, i);
                    log.warn({ attempt: i + 1, host: urlHost, wait, error: err?.message }, 'Price fetch retry (proxy)');
                    await new Promise(r => setTimeout(r, wait));
                }
            }
        }
        // Phase 2: Fallback to direct (if configured)
        if (PROXY_FALLBACK_DIRECT) {
            log.warn({ host: urlHost }, 'Falling back to direct connection (proxy unavailable)');
            // Reset the agent so next cycle tries fresh
            _socksAgent = null;
            try {
                return await fetchJson(url, false);
            }
            catch (err) {
                log.error({ host: urlHost, error: err?.message }, 'Direct fallback also failed');
                throw err;
            }
        }
        throw new Error(`Proxy fetch failed after ${retries} retries and no fallback enabled`);
    }
    // No proxy: standard retry
    for (let i = 0; i < retries; i++) {
        try {
            return await fetchJson(url, false);
        }
        catch (err) {
            if (i === retries - 1)
                throw err;
            const wait = delay * Math.pow(2, i);
            log.warn({ attempt: i + 1, host: urlHost, wait, error: err?.message }, 'Price fetch retry (direct)');
            await new Promise(r => setTimeout(r, wait));
        }
    }
}
// ── Get Current Price ─────────────────────────────────────────
async function getCurrentPrice(symbol, exchange) {
    const cacheKey = `${exchange}:${symbol}`;
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL_MS) {
        return { price: cached.price, high: cached.high, low: cached.low };
    }
    // Only use proxy if exchange is in the proxied set AND proxy is configured
    const useProxy = PROXIED_EXCHANGES.has(exchange) && PROXY_CONFIG.enabled;
    const mappedSymbol = mapSymbol(symbol, exchange);
    try {
        let data;
        // ── Binance Spot ──────────────────────────────────────
        if (exchange === 'BINANCE_SPOT') {
            data = await fetchWithRetry(`${BINANCE_SPOT}/api/v3/klines?symbol=${mappedSymbol}&interval=1m&limit=1`, useProxy);
            if (data?.length > 0) {
                const c = data[0];
                return cacheAndReturn(cacheKey, parseFloat(c[4]), parseFloat(c[2]), parseFloat(c[3]));
            }
            // ── Binance Futures ──────────────────────────────────
        }
        else if (exchange === 'BINANCE_FUTURES') {
            data = await fetchWithRetry(`${BINANCE_FUTURES}/fapi/v1/klines?symbol=${mappedSymbol}&interval=1m&limit=1`, useProxy);
            if (data?.length > 0) {
                const c = data[0];
                return cacheAndReturn(cacheKey, parseFloat(c[4]), parseFloat(c[2]), parseFloat(c[3]));
            }
            // ── Bybit V5 ─────────────────────────────────────────
        }
        else if (exchange === 'BYBIT') {
            data = await fetchWithRetry(`${BYBIT_API}/v5/market/kline?category=linear&symbol=${mappedSymbol}&interval=1&limit=1`, useProxy);
            const klines = data?.result?.list;
            if (klines?.length > 0) {
                const c = klines[0];
                return cacheAndReturn(cacheKey, parseFloat(c[4]), parseFloat(c[2]), parseFloat(c[3]));
            }
            // ── Kraken REST (always direct — no proxy) ───────────
        }
        else if (exchange === 'KRAKEN') {
            data = await fetchWithRetry(`${KRAKEN_API}/0/public/OHLC?pair=${mappedSymbol}&interval=1`, false);
            if (data && !data.error?.length && data.result) {
                const pairKey = Object.keys(data.result).find(k => k !== 'last');
                const klines = pairKey ? data.result[pairKey] : null;
                if (klines?.length > 0) {
                    const c = klines[klines.length - 1];
                    return cacheAndReturn(cacheKey, parseFloat(c[4]), parseFloat(c[2]), parseFloat(c[3]));
                }
            }
        }
        else if (exchange === 'COINBASE') {
            data = await fetchWithRetry(`${COINBASE_API}/products/${mappedSymbol}/candles?granularity=60`, false);
            if (Array.isArray(data) && data.length > 0) {
                const c = data[0];
                return cacheAndReturn(cacheKey, parseFloat(c[4]), parseFloat(c[2]), parseFloat(c[1]));
            }
        }
        else {
            log.warn({ exchange, symbol }, 'Unknown exchange — cannot fetch price');
        }
        return null;
    }
    catch (err) {
        log.error({ err, symbol, exchange, proxy: useProxy }, 'Failed to fetch price');
        return null;
    }
}
// ── Cache helper ──────────────────────────────────────────────
function cacheAndReturn(key, price, high, low) {
    priceCache.set(key, { price, high, low, ts: Date.now() });
    return { price, high, low };
}
async function checkPriceHit(symbol, exchange, direction, // LONG | SHORT
tpPrice, slPrice) {
    const priceData = await getCurrentPrice(symbol, exchange);
    if (!priceData)
        return null;
    const { price, high, low } = priceData;
    let hitTP = false;
    let hitSL = false;
    if (direction === 'LONG') {
        if (tpPrice && high >= tpPrice)
            hitTP = true;
        if (slPrice && low <= slPrice)
            hitSL = true;
    }
    else {
        if (tpPrice && low <= tpPrice)
            hitTP = true;
        if (slPrice && high >= slPrice)
            hitSL = true;
    }
    return { hitTP, hitSL, currentPrice: price, high, low };
}
//# sourceMappingURL=price-service.js.map