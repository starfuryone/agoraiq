// ─────────────────────────────────────────────────────────────────────────────
// publish-guards.test.ts
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  assertCornixTelegramOptions,
  cornixTelegramOptions,
  assertUntypedCodeFence,
  buildDiscordCornixPayload,
} from './publish-guards'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CORNIX_TEXT = [
  '📊 #BTCUSDT LONG',
  '',
  '🏦 Exchange: Binance Futures',
  '',
  '📈 Entry: 94500',
  '',
  '🎯 Targets:',
  'TP1 - 96000',
  'TP2 - 97500',
  '',
  '🛡 Stop Loss: 93000',
].join('\n')

// ─────────────────────────────────────────────────────────────────────────────
describe('assertCornixTelegramOptions', () => {

  it('passes when parse_mode is undefined', () => {
    expect(() =>
      assertCornixTelegramOptions({ disable_web_page_preview: true }),
    ).not.toThrow()
  })

  it('passes when options object is empty', () => {
    expect(() => assertCornixTelegramOptions({})).not.toThrow()
  })

  it('throws when parse_mode is "Markdown"', () => {
    expect(() =>
      assertCornixTelegramOptions({ parse_mode: 'Markdown' }),
    ).toThrow(/plain text/)
  })

  it('throws when parse_mode is "MarkdownV2"', () => {
    expect(() =>
      assertCornixTelegramOptions({ parse_mode: 'MarkdownV2' }),
    ).toThrow(/plain text/)
  })

  it('throws when parse_mode is "HTML"', () => {
    expect(() =>
      assertCornixTelegramOptions({ parse_mode: 'HTML' }),
    ).toThrow(/plain text/)
  })

  it('error message names the bad parse_mode value', () => {
    expect(() =>
      assertCornixTelegramOptions({ parse_mode: 'MarkdownV2' }),
    ).toThrow(/MarkdownV2/)
  })

  it('error message explains the Cornix corruption reason', () => {
    expect(() =>
      assertCornixTelegramOptions({ parse_mode: 'Markdown' }),
    ).toThrow(/TP1/)
  })

  // Regression guard: future developer adds parse_mode to an options spread
  it('throws even when parse_mode is set alongside other safe options', () => {
    expect(() =>
      assertCornixTelegramOptions({
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    ).toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('cornixTelegramOptions', () => {

  it('returns options without parse_mode', () => {
    const opts = cornixTelegramOptions()
    expect(opts.parse_mode).toBeUndefined()
  })

  it('sets disable_web_page_preview: true by default', () => {
    const opts = cornixTelegramOptions()
    expect(opts.disable_web_page_preview).toBe(true)
  })

  it('merges extra options', () => {
    const opts = cornixTelegramOptions({ reply_to_message_id: 42 } as any)
    expect((opts as any).reply_to_message_id).toBe(42)
  })

  it('never has parse_mode even with arbitrary spread', () => {
    const opts = cornixTelegramOptions({ some_future_option: true } as any)
    expect(opts.parse_mode).toBeUndefined()
  })

  // Critical: cannot be tricked into accepting parse_mode via extras
  it('throws if caller somehow injects parse_mode via extras', () => {
    expect(() =>
      // Type cast simulates a caller bypassing TypeScript
      cornixTelegramOptions({ parse_mode: 'Markdown' } as any),
    ).toThrow(/plain text/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('assertUntypedCodeFence', () => {

  it('passes on a valid untyped fence', () => {
    expect(() =>
      assertUntypedCodeFence('```\nTP1 - 96000\n```'),
    ).not.toThrow()
  })

  it('passes on multi-line untyped fence', () => {
    expect(() =>
      assertUntypedCodeFence(`\`\`\`\n${CORNIX_TEXT}\n\`\`\``),
    ).not.toThrow()
  })

  it('passes on plain text (no fence at all)', () => {
    expect(() =>
      assertUntypedCodeFence('Some plain text without a fence'),
    ).not.toThrow()
  })

  it('throws on ```json fence', () => {
    expect(() =>
      assertUntypedCodeFence('```json\n{"key": "value"}\n```'),
    ).toThrow(/untyped/)
  })

  it('throws on ```text fence', () => {
    expect(() =>
      assertUntypedCodeFence('```text\nTP1 - 96000\n```'),
    ).toThrow()
  })

  it('throws on ```ts fence', () => {
    expect(() =>
      assertUntypedCodeFence('```ts\nconst x = 1\n```'),
    ).toThrow()
  })

  it('throws on ```javascript fence', () => {
    expect(() =>
      assertUntypedCodeFence('```javascript\ncode here\n```'),
    ).toThrow()
  })

  it('error message includes the offending language tag', () => {
    expect(() =>
      assertUntypedCodeFence('```json\n...\n```'),
    ).toThrow(/json/)
  })

  // Regression: ensure we only flag the opening fence, not language words in content
  it('does not throw when content contains "json" mid-text', () => {
    expect(() =>
      assertUntypedCodeFence('```\nThis message mentions json but fence is untyped\n```'),
    ).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('buildDiscordCornixPayload', () => {

  it('returns content with an untyped code fence', () => {
    const { content } = buildDiscordCornixPayload(CORNIX_TEXT)
    expect(content).toMatch(/^```\n/)
    expect(content).toMatch(/\n```$/)
  })

  it('wraps the full Cornix text inside the fence', () => {
    const { content } = buildDiscordCornixPayload(CORNIX_TEXT)
    expect(content).toContain(CORNIX_TEXT)
  })

  it('fence is untyped — no language tag', () => {
    const { content } = buildDiscordCornixPayload(CORNIX_TEXT)
    // Must not have ```<letters> at the start
    expect(content).not.toMatch(/^```[a-zA-Z]/)
  })

  it('does not include embeds when none provided', () => {
    const payload = buildDiscordCornixPayload(CORNIX_TEXT)
    expect(payload.embeds).toBeUndefined()
  })

  it('includes embed when provided', () => {
    const embed = {
      title: '🟢 BTCUSDT LONG',
      color: 0x00c896,
      fields: [],
      footer: { text: 'AgoraIQ' },
      timestamp: new Date().toISOString(),
    }
    const payload = buildDiscordCornixPayload(CORNIX_TEXT, embed)
    expect(payload.embeds).toHaveLength(1)
    expect(payload.embeds![0]!.title).toBe('🟢 BTCUSDT LONG')
  })

  it('content is always present even with embed', () => {
    const embed = {
      title: 'test',
      color: 0x00c896,
      fields: [],
      footer: { text: '' },
      timestamp: new Date().toISOString(),
    }
    const payload = buildDiscordCornixPayload(CORNIX_TEXT, embed)
    expect(payload.content).toBeTruthy()
    expect(payload.content).toContain(CORNIX_TEXT)
  })

  it('throws on empty cornixText', () => {
    expect(() => buildDiscordCornixPayload('')).toThrow(/empty/)
  })

  it('throws on whitespace-only cornixText', () => {
    expect(() => buildDiscordCornixPayload('   ')).toThrow(/empty/)
  })

  it('throws if caller passes pre-fenced text', () => {
    const preFenced = '```\nTP1 - 96000\n```'
    expect(() => buildDiscordCornixPayload(preFenced)).toThrow(/pre-fenced/)
  })

  // THE regression test: catches the ```json introduction
  it('throws if caller passes text with a typed fence', () => {
    const typedFenced = '```json\n{"price": 96000}\n```'
    expect(() => buildDiscordCornixPayload(typedFenced)).toThrow()
  })

  // Structural invariant: content always passes its own fence assertion
  it('content always passes assertUntypedCodeFence', () => {
    const payload = buildDiscordCornixPayload(CORNIX_TEXT)
    expect(() => assertUntypedCodeFence(payload.content)).not.toThrow()
  })

  // Critical Cornix parsing requirement: TP line survives round-trip
  it('TP targets are preserved verbatim inside the fence', () => {
    const { content } = buildDiscordCornixPayload(CORNIX_TEXT)
    expect(content).toContain('TP1 - 96000')
    expect(content).toContain('TP2 - 97500')
  })

  it('Stop Loss line is preserved verbatim inside the fence', () => {
    const { content } = buildDiscordCornixPayload(CORNIX_TEXT)
    expect(content).toContain('Stop Loss: 93000')
  })
})
