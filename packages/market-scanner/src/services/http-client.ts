/**
 * @agoraiq/signal-engine — Shared HTTP Client
 *
 * Provides proxy-aware axios instances for outbound traffic.
 *
 * ROUTING POLICY
 * ──────────────
 * Traffic to these destinations routes through SOCKS5:
 *   - *.binance.com (spot + futures)
 *   - *.bybit.com
 *   - app.agoraiq.net / any AGORAIQ_API_BASE_URL host
 *
 * Traffic to these destinations goes DIRECT (no proxy):
 *   - api.anthropic.com (AI reasoning)
 *   - cryptopanic.com (news)
 *   - api.alternative.me (sentiment)
 *
 * WHY: Binance geo-blocks certain VPS IP ranges. AgoraIQ may be
 * behind Cloudflare which blocks some datacenter IPs. CryptoPanic,
 * Alternative.me, and Anthropic don't geo-block.
 *
 * CONFIGURATION
 * ─────────────
 * Set EXCHANGE_SOCKS_PROXY=socks5://143.198.202.65:1080 in .env
 * (or whatever port your SOCKS5 proxy listens on).
 * If empty, all traffic goes direct.
 */

import axios, { type AxiosInstance } from "axios";
import { SocksProxyAgent } from "socks-proxy-agent";
import { config } from "../config";
import { logger } from "./logger";

// ─── Proxy Agent ───────────────────────────────────────────────────────────────

let _agent: SocksProxyAgent | null = null;

function getProxyAgent(): SocksProxyAgent | null {
  if (_agent) return _agent;

  const proxyUrl = config.socksProxy;
  if (!proxyUrl) return null;

  try {
    _agent = new SocksProxyAgent(proxyUrl);
    logger.info(`SOCKS5 proxy agent initialized: ${proxyUrl}`);
    return _agent;
  } catch (err: any) {
    logger.error(`Failed to create SOCKS5 agent from ${proxyUrl}: ${err.message}`);
    return null;
  }
}

// ─── Proxied Axios Instance ────────────────────────────────────────────────────

let _proxiedAxios: AxiosInstance | null = null;

/**
 * Axios instance that routes through SOCKS5 proxy.
 * Use for: Binance, Bybit, AgoraIQ.
 *
 * If EXCHANGE_SOCKS_PROXY is not set, returns a plain axios instance
 * (direct connection). This makes dev/testing work without a proxy.
 */
export function getProxiedAxios(): AxiosInstance {
  if (_proxiedAxios) return _proxiedAxios;

  const agent = getProxyAgent();

  if (agent) {
    _proxiedAxios = axios.create({
      httpAgent: agent,
      httpsAgent: agent,
      // Disable axios's own proxy handling — we use the agent directly
      proxy: false,
    });
    logger.info("Proxied axios instance ready (SOCKS5)");
  } else {
    // No proxy configured — use plain axios
    _proxiedAxios = axios.create();
    logger.debug("Proxied axios instance ready (DIRECT — no SOCKS5 configured)");
  }

  return _proxiedAxios;
}

/**
 * Plain axios — no proxy. Use for services that don't need it:
 * CryptoPanic, Alternative.me, Anthropic.
 */
export function getDirectAxios(): AxiosInstance {
  return axios;
}

/**
 * Get the SOCKS5 proxy URL for CCXT instances.
 * Returns empty string if not configured.
 */
export function getProxyUrl(): string {
  return config.socksProxy || "";
}
