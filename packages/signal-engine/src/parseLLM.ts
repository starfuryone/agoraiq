import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

export type Direction = 'LONG' | 'SHORT'
export type MarketType = 'SPOT' | 'FUTURES_PERP' | 'FUTURES_DATED'
export type LLMProvider = 'anthropic' | 'perplexity' | 'huggingface' | 'mistral' | 'openai'

export interface CornixSignal {
  pair: string; direction: Direction; marketType: MarketType
  exchange: string | null; entryMin: number | null; entryMax: number | null
  stopLoss: number | null; takeProfits: number[]; leverage: number | null
  leverageType: 'cross' | 'isolated' | null; rawMessage: string
}

export interface CornixParseResult {
  success: boolean; confidence: number; explanation: string
  data?: CornixSignal; errors: string[]
}

interface LLMSignalResponse {
  pair: string | null; direction: 'LONG' | 'SHORT' | null
  marketType: 'SPOT' | 'FUTURES_PERP' | 'FUTURES_DATED' | null
  exchange: string | null; entryMin: number | null; entryMax: number | null
  stopLoss: number | null; takeProfits: number[]; leverage: number | null
  leverageType: 'cross' | 'isolated' | null; confidence: number; explanation: string
}

const DEFAULT_PROMPT = 'You are a trading signal parser. Extract structured data from the raw message below.\nReturn ONLY valid JSON with this exact shape:\n{\n  "pair": "BTCUSDT",\n  "direction": "LONG" | "SHORT" | null,\n  "marketType": "SPOT" | "FUTURES_PERP" | "FUTURES_DATED" | null,\n  "exchange": "BINANCE" | "BYBIT" | null,\n  "entryMin": 65000,\n  "entryMax": 65500,\n  "stopLoss": 63000,\n  "takeProfits": [66500, 68000, 70000],\n  "leverage": 10,\n  "leverageType": "cross" | "isolated" | null,\n  "confidence": 0.85,\n  "explanation": "why you parsed it this way"\n}\nRules:\n- pair must be normalized e.g. BTCUSDT not BTC/USDT\n- If entry is a single price set both entryMin and entryMax to that value\n- takeProfits must be an ordered array, empty array if none found\n- confidence reflects completeness and plausibility\n- Do NOT invent values. If a field is absent set it to null\n- Return JSON only. No markdown, no explanation outside the JSON.'

function buildPrompt(raw: string, template?: string | null): string {
  return (template?.trim() || DEFAULT_PROMPT) + '\n\n---\nRAW MESSAGE:\n' + raw + '\n---'
}

function stripFences(text: string): string {
  return text.replace(/^[\s\n]*`{3}(?:json)?[\s\n]*/i, '').replace(/[\s\n]*`{3}[\s\n]*$/i, '').trim()
}

function validateResponse(raw: unknown): LLMSignalResponse | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const direction = r.direction === 'LONG' || r.direction === 'SHORT' ? r.direction : null
  const marketType = ['SPOT', 'FUTURES_PERP', 'FUTURES_DATED'].includes(r.marketType as string) ? r.marketType as MarketType : null
  return {
    pair: typeof r.pair === 'string' ? r.pair.replace(/[^A-Z0-9]/g, '').toUpperCase() : null,
    direction: direction as Direction | null, marketType,
    exchange: typeof r.exchange === 'string' ? r.exchange.toUpperCase() : null,
    entryMin: typeof r.entryMin === 'number' ? r.entryMin : null,
    entryMax: typeof r.entryMax === 'number' ? r.entryMax : null,
    stopLoss: typeof r.stopLoss === 'number' ? r.stopLoss : null,
    takeProfits: Array.isArray(r.takeProfits) ? (r.takeProfits as unknown[]).filter(n => typeof n === 'number') as number[] : [],
    leverage: typeof r.leverage === 'number' ? r.leverage : null,
    leverageType: r.leverageType === 'cross' || r.leverageType === 'isolated' ? r.leverageType : null,
    confidence: typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0.5,
    explanation: typeof r.explanation === 'string' ? r.explanation : 'No explanation provided',
  }
}

async function callAnthropic(prompt: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
  const block = msg.content[0]
  if (!block || block.type !== 'text') throw new Error('Non-text response from Anthropic')
  return stripFences(block.text)
}

async function callOpenAICompat(prompt: string, baseURL: string, apiKey: string, model: string): Promise<string> {
  const client = new OpenAI({ apiKey, baseURL })
  const res = await client.chat.completions.create({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
  return stripFences(res.choices[0]?.message?.content ?? '')
}

async function callPerplexity(prompt: string): Promise<string> { return callOpenAICompat(prompt, 'https://api.perplexity.ai', process.env.PERPLEXITY_API_KEY ?? '', process.env.PERPLEXITY_MODEL ?? 'sonar') }
async function callHuggingFace(prompt: string): Promise<string> { return callOpenAICompat(prompt, 'https://api-inference.huggingface.co/v1', process.env.HUGGINGFACE_API_KEY ?? '', process.env.HUGGINGFACE_MODEL ?? 'mistralai/Mistral-7B-Instruct-v0.3') }
async function callMistral(prompt: string): Promise<string> { return callOpenAICompat(prompt, 'https://api.mistral.ai/v1', process.env.MISTRAL_API_KEY ?? '', process.env.MISTRAL_MODEL ?? 'mistral-small-latest') }
async function callOpenAI(prompt: string): Promise<string> { return callOpenAICompat(prompt, 'https://api.openai.com/v1', process.env.OPENAI_API_KEY ?? '', process.env.OPENAI_MODEL ?? 'gpt-4o-mini') }

const PROVIDERS: Record<LLMProvider, (prompt: string) => Promise<string>> = { anthropic: callAnthropic, perplexity: callPerplexity, huggingface: callHuggingFace, mistral: callMistral, openai: callOpenAI }
const PROVIDER_ORDER: LLMProvider[] = ['anthropic', 'perplexity', 'huggingface', 'mistral', 'openai']

function isProviderConfigured(provider: LLMProvider): boolean {
  const keyMap: Record<LLMProvider, string> = { anthropic: 'ANTHROPIC_API_KEY', perplexity: 'PERPLEXITY_API_KEY', huggingface: 'HUGGINGFACE_API_KEY', mistral: 'MISTRAL_API_KEY', openai: 'OPENAI_API_KEY' }
  return !!process.env[keyMap[provider]]
}

export async function parseLLM(raw: string, options?: { promptTemplate?: string | null; promptVersion?: number; providers?: LLMProvider[] }): Promise<CornixParseResult & { provider?: LLMProvider }> {
  const prompt = buildPrompt(raw, options?.promptTemplate)
  const providers = options?.providers ?? PROVIDER_ORDER
  const errors: string[] = []
  for (const provider of providers) {
    if (!isProviderConfigured(provider)) { console.log('[llm] Skipping ' + provider + ' no API key'); continue }
    try {
      console.log('[llm] Trying provider: ' + provider)
      const responseText = await PROVIDERS[provider](prompt)
      const parsed = validateResponse(JSON.parse(responseText))
      if (!parsed) { errors.push(provider + ': validation failed'); continue }
      if (!parsed.pair || !parsed.direction) { errors.push(provider + ': missing pair/direction'); continue }
      const signal: CornixSignal = { pair: parsed.pair, direction: parsed.direction, marketType: parsed.marketType ?? 'FUTURES_PERP', exchange: parsed.exchange, entryMin: parsed.entryMin, entryMax: parsed.entryMax, stopLoss: parsed.stopLoss, takeProfits: parsed.takeProfits, leverage: parsed.leverage, leverageType: parsed.leverageType, rawMessage: raw }
      const signalErrors: string[] = []
      if (!signal.entryMin) signalErrors.push('Missing entry price')
      if (!signal.stopLoss) signalErrors.push('Missing stop loss')
      if (signal.takeProfits.length === 0) signalErrors.push('No take profits found')
      console.log('[llm] Success via ' + provider + ' (confidence: ' + parsed.confidence + ')')
      return { success: signalErrors.length === 0, confidence: parsed.confidence, explanation: '[' + provider + '] ' + parsed.explanation, data: signal, errors: signalErrors, provider }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[llm] ' + provider + ' failed: ' + msg)
      errors.push(provider + ': ' + msg)
    }
  }
  return { success: false, confidence: 0, explanation: 'All LLM providers failed: ' + errors.join(' | '), errors: ['All providers exhausted'] }
}
