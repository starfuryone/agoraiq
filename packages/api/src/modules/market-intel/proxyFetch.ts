import { SocksProxyAgent } from 'socks-proxy-agent';
import https from 'https';

const PROXY_PRIMARY  = 'socks5://143.198.202.65:1080';
const PROXY_FALLBACK = 'socks5://159.223.62.162:1080';

const agentPrimary  = new SocksProxyAgent(PROXY_PRIMARY);
const agentFallback = new SocksProxyAgent(PROXY_FALLBACK);

function fetchViaAgent(url: string, agent: SocksProxyAgent, timeoutMs: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const req = https.get(url, { agent } as any, (res) => {
      clearTimeout(timer);
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolve(new Response(Buffer.concat(chunks).toString(), { status: res.statusCode ?? 200 }));
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

export async function proxyFetch(url: string, timeoutMs = 6000): Promise<Response> {
  try {
    return await fetchViaAgent(url, agentPrimary, timeoutMs);
  } catch (err) {
    console.warn('[proxyFetch] Primary failed, trying fallback');
    return fetchViaAgent(url, agentFallback, timeoutMs);
  }
}
