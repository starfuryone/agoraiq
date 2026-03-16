// ─────────────────────────────────────────────────────────────────────────────
// formatter.test.ts
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import { SignalFormatter } from '../src/formatter'
import type { SignalFields } from '../src/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fullLong: SignalFields = {
  symbol: 'BTCUSDT',
  direction: 'LONG',
  exchange: 'Binance Futures',
  entries: [94500],
  stopLoss: 93000,
  targets: [96000, 97500, 99000],
  leverage: 'Cross 10x',
  footer: 'By @AgoraIQ',
}

const fullShort: SignalFields = {
  symbol: 'ETHUSDT',
  direction: 'SHORT',
  exchange: 'Bybit',
  entries: [3200],
  stopLoss: 3350,
  targets: [3100, 3000, 2900],
  leverage: 'Isolated 5x',
  footer: 'By @TestChannel',
}

const rangeEntry: SignalFields = {
  ...fullLong,
  entries: [94000, 95000],
}

const minimal: SignalFields = {
  symbol: 'SOLUSDT',
  direction: 'LONG',
  exchange: 'OKX',
  entries: [150],
  stopLoss: 145,
  targets: [160],
}

// ─────────────────────────────────────────────────────────────────────────────
describe('SignalFormatter', () => {
  let f: SignalFormatter

  beforeEach(() => {
    f = new SignalFormatter()
  })

  // ── formatCornix ────────────────────────────────────────────────────────────
  describe('formatCornix', () => {
    it('returns format: cornix', () => {
      expect(f.formatCornix(fullLong).format).toBe('cornix')
    })

    it('includes symbol with hash prefix', () => {
      const { text } = f.formatCornix(fullLong)
      expect(text).toContain('#BTCUSDT LONG')
    })

    it('includes exchange', () => {
      const { text } = f.formatCornix(fullLong)
      expect(text).toContain('Exchange: Binance Futures')
    })

    it('formats single entry correctly', () => {
      const { text } = f.formatCornix(fullLong)
      expect(text).toContain('Entry: 94500')
      expect(text).not.toContain('94500 - 94500')
    })

    it('formats range entry correctly', () => {
      const { text } = f.formatCornix(rangeEntry)
      expect(text).toContain('Entry: 94000 - 95000')
    })

    it('formats targets as TP1, TP2, TP3', () => {
      const { text } = f.formatCornix(fullLong)
      expect(text).toContain('TP1 - 96000')
      expect(text).toContain('TP2 - 97500')
      expect(text).toContain('TP3 - 99000')
    })

    it('includes stop loss', () => {
      const { text } = f.formatCornix(fullLong)
      expect(text).toContain('Stop Loss: 93000')
    })

    it('includes leverage when provided', () => {
      const { text } = f.formatCornix(fullLong)
      expect(text).toContain('Leverage: Cross 10x')
    })

    it('omits leverage section when not provided', () => {
      const { text } = f.formatCornix(minimal)
      expect(text).not.toContain('Leverage')
    })

    it('includes footer when provided', () => {
      const { text } = f.formatCornix(fullLong)
      expect(text).toContain('By @AgoraIQ')
    })

    it('omits footer when not provided', () => {
      const { text } = f.formatCornix(minimal)
      expect(text).not.toContain('By @')
    })

    it('copyText equals text for cornix format', () => {
      const result = f.formatCornix(fullLong)
      expect(result.copyText).toBe(result.text)
    })

    it('contains no markdown characters (asterisk, underscore, backtick)', () => {
      const { text } = f.formatCornix(fullLong)
      expect(text).not.toMatch(/[*_`]/)
    })

    it('uses SHORT direction in title', () => {
      const { text } = f.formatCornix(fullShort)
      expect(text).toContain('#ETHUSDT SHORT')
    })

    it('uses 📉 emoji for SHORT entry', () => {
      const { text } = f.formatCornix(fullShort)
      expect(text).toContain('📉 Entry')
    })

    it('uses 📈 emoji for LONG entry', () => {
      const { text } = f.formatCornix(fullLong)
      expect(text).toContain('📈 Entry')
    })

    it('formats a single TP correctly', () => {
      const { text } = f.formatCornix(minimal)
      expect(text).toContain('TP1 - 160')
      expect(text).not.toContain('TP2')
    })

    // Critical: Cornix line-parser test
    it('has entry line before targets section', () => {
      const { text } = f.formatCornix(fullLong)
      const entryIdx = text.indexOf('Entry:')
      const targetsIdx = text.indexOf('Targets:')
      expect(entryIdx).toBeLessThan(targetsIdx)
    })

    it('has targets section before stop loss', () => {
      const { text } = f.formatCornix(fullLong)
      const targetsIdx = text.indexOf('Targets:')
      const slIdx = text.indexOf('Stop Loss:')
      expect(targetsIdx).toBeLessThan(slIdx)
    })
  })

  // ── formatDiscordEmbed ──────────────────────────────────────────────────────
  describe('formatDiscordEmbed', () => {
    it('returns format: discord_embed', () => {
      expect(f.formatDiscordEmbed(fullLong).format).toBe('discord_embed')
    })

    it('has no text property', () => {
      const result = f.formatDiscordEmbed(fullLong)
      expect(result.text).toBeUndefined()
    })

    it('has embed property', () => {
      const result = f.formatDiscordEmbed(fullLong)
      expect(result.embed).toBeDefined()
    })

    it('embed title contains symbol and direction for LONG', () => {
      const { embed } = f.formatDiscordEmbed(fullLong)
      expect(embed!.title).toContain('BTCUSDT')
      expect(embed!.title).toContain('LONG')
      expect(embed!.title).toContain('🟢')
    })

    it('embed title uses red emoji for SHORT', () => {
      const { embed } = f.formatDiscordEmbed(fullShort)
      expect(embed!.title).toContain('🔴')
    })

    it('uses green color for LONG (0x00c896)', () => {
      const { embed } = f.formatDiscordEmbed(fullLong)
      expect(embed!.color).toBe(0x00c896)
    })

    it('uses red color for SHORT (0xff4757)', () => {
      const { embed } = f.formatDiscordEmbed(fullShort)
      expect(embed!.color).toBe(0xff4757)
    })

    it('includes exchange field', () => {
      const { embed } = f.formatDiscordEmbed(fullLong)
      expect(embed!.fields.some((f) => f.value === 'Binance Futures')).toBe(true)
    })

    it('includes leverage field when provided', () => {
      const { embed } = f.formatDiscordEmbed(fullLong)
      expect(embed!.fields.some((f) => f.value === 'Cross 10x')).toBe(true)
    })

    it('omits leverage field when not provided', () => {
      const { embed } = f.formatDiscordEmbed(minimal)
      const leverageField = embed!.fields.find((f) => f.name.includes('Leverage'))
      expect(leverageField).toBeUndefined()
    })

    it('includes all targets in targets field', () => {
      const { embed } = f.formatDiscordEmbed(fullLong)
      const targetsField = embed!.fields.find((f) => f.name.includes('Targets'))
      expect(targetsField?.value).toContain('96000')
      expect(targetsField?.value).toContain('97500')
      expect(targetsField?.value).toContain('99000')
    })

    it('includes stop loss field', () => {
      const { embed } = f.formatDiscordEmbed(fullLong)
      const slField = embed!.fields.find((f) => f.name.includes('Stop Loss'))
      expect(slField?.value).toBe('93000')
    })

    it('uses footer text from signal', () => {
      const { embed } = f.formatDiscordEmbed(fullLong)
      expect(embed!.footer.text).toBe('By @AgoraIQ')
    })

    it('uses default footer when not provided', () => {
      const { embed } = f.formatDiscordEmbed(minimal)
      expect(embed!.footer.text).toBe('AgoraIQ Signal Intelligence')
    })

    it('has a valid ISO timestamp', () => {
      const { embed } = f.formatDiscordEmbed(fullLong)
      expect(() => new Date(embed!.timestamp)).not.toThrow()
      expect(new Date(embed!.timestamp).getTime()).toBeGreaterThan(0)
    })

    it('copyText is Cornix-compatible plain text (no markdown)', () => {
      const { copyText } = f.formatDiscordEmbed(fullLong)
      expect(copyText).not.toMatch(/[*_`]/)
      expect(copyText).toContain('#BTCUSDT LONG')
      expect(copyText).toContain('TP1 - 96000')
    })
  })

  // ── formatPlainTelegram ─────────────────────────────────────────────────────
  describe('formatPlainTelegram', () => {
    it('returns format: plain_telegram', () => {
      expect(f.formatPlainTelegram(fullLong).format).toBe('plain_telegram')
    })

    it('contains symbol in bold markdown', () => {
      const { text } = f.formatPlainTelegram(fullLong)
      expect(text).toContain('*')  // MarkdownV2 bold
      expect(text).toContain('BTCUSDT')
    })

    it('formats single entry in backtick code', () => {
      const { text } = f.formatPlainTelegram(fullLong)
      expect(text).toContain('`94500`')
    })

    it('formats range entry in backtick code', () => {
      const { text } = f.formatPlainTelegram(rangeEntry)
      expect(text).toContain('`94000 - 95000`')
    })

    it('formats targets with escaped dash (MarkdownV2)', () => {
      const { text } = f.formatPlainTelegram(fullLong)
      // MarkdownV2 requires - to be escaped as \-
      expect(text).toContain('TP1 \\-')
    })

    it('includes stop loss in backtick', () => {
      const { text } = f.formatPlainTelegram(fullLong)
      expect(text).toContain('`93000`')
    })

    it('copyText is Cornix plain text, not Telegram markdown', () => {
      const { copyText } = f.formatPlainTelegram(fullLong)
      // copyText should be plain Cornix, not markdown
      expect(copyText).not.toMatch(/\\\-/)   // no escaped dashes
      expect(copyText).toContain('TP1 - 96000')
    })

    it('copyText matches formatCornix output', () => {
      const telegramResult = f.formatPlainTelegram(fullLong)
      const cornixResult = f.formatCornix(fullLong)
      expect(telegramResult.copyText).toBe(cornixResult.text)
    })
  })

  // ── Cross-format consistency ────────────────────────────────────────────────
  describe('cross-format consistency', () => {
    it('all formats produce copyText identical to Cornix text', () => {
      const cornix = f.formatCornix(fullLong)
      const discord = f.formatDiscordEmbed(fullLong)
      const telegram = f.formatPlainTelegram(fullLong)

      expect(discord.copyText).toBe(cornix.text)
      expect(telegram.copyText).toBe(cornix.text)
    })

    it('all formats include all 3 TPs in their respective outputs', () => {
      const tps = [96000, 97500, 99000]

      const cornixText = f.formatCornix(fullLong).text!
      tps.forEach((tp) => expect(cornixText).toContain(String(tp)))

      const discordEmbed = f.formatDiscordEmbed(fullLong).embed!
      const targetsField = discordEmbed.fields.find((f) => f.name.includes('Targets'))!
      tps.forEach((tp) => expect(targetsField.value).toContain(String(tp)))

      const telegramText = f.formatPlainTelegram(fullLong).text!
      tps.forEach((tp) => expect(telegramText).toContain(String(tp)))
    })
  })
})
