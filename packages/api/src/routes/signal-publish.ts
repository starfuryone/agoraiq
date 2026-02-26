// ─────────────────────────────────────────────────────────────────────────────
// packages/api/src/routes/signal-publish.ts
//
// Automation-ready signal publishing routes (Pro/Elite only).
//
// Routes:
//   POST /api/v1/signal-publish/:tradeId/validate  — live validation (any plan)
//   POST /api/v1/signal-publish/:tradeId/preview   — formatted previews (Pro+)
//   POST /api/v1/signal-publish/:tradeId/publish   — publish to channels (Pro+)
//   GET  /api/v1/signal-publish/templates          — list user's templates (Pro+)
//   POST /api/v1/signal-publish/templates          — create template (Pro+)
//   PUT  /api/v1/signal-publish/templates/:id      — update template (Pro+)
//   DELETE /api/v1/signal-publish/templates/:id    — delete template (Pro+)
//
// Mount in index.ts:
//   app.use(
//     '/api/v1/signal-publish',
//     authenticate,
//     membershipGate,
//     authenticatedLimiter,
//     attachTenantContext,
//     createSignalPublishRoutes(),
//   )
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express'
import { PrismaClient } from '@agoraiq/db'
import { SignalValidator, SignalFormatter, cornixTelegramOptions, buildDiscordCornixPayload } from '@agoraiq/signal-engine'
import type { SignalFields } from '@agoraiq/signal-engine'
import { requireAuth } from '../middleware/auth'

const validator = new SignalValidator()
const formatter = new SignalFormatter()

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Allowed plan tiers for publish features */
const PRO_TIERS = new Set(['PRO', 'ELITE'])

function requirePro(req: Request, res: Response): boolean {
  const tier = (req as any).user?.plan ?? 'FREE'
  if (!PRO_TIERS.has(tier)) {
    res.status(403).json({
      error: 'Pro plan required',
      code: 'PLAN_UPGRADE_REQUIRED',
      requiredPlan: 'PRO',
      currentPlan: tier,
    })
    return false
  }
  return true
}

/**
 * Convert a Trade record from the DB into a SignalFields object.
 * Trade.symbol is stored as "BTC/USDT" — Cornix requires "BTCUSDT".
 * Trade.targets is stored as [{level,price}] JSON — we extract price as number[].
 * Trade.exchange is an enum (BINANCE_FUTURES) — we map to display name.
 * Template overrides exchange/leverage/footer when provided.
 */
function tradeToSignalFields(
  trade: any,
  template?: { exchange?: string | null; leverage?: string | null; footer?: string | null } | null,
): Partial<SignalFields> {
  // Normalise symbol: "BTC/USDT" → "BTCUSDT"
  const symbol = trade.symbol.replace('/', '').toUpperCase()

  // Collect TPs from discrete tp1Price/tp2Price/tp3Price columns
  const targets: number[] = [trade.tp1Price, trade.tp2Price, trade.tp3Price]
    .map(Number)
    .filter((p) => Number.isFinite(p) && p > 0)

  const exchangeDisplay = template?.exchange ?? exchangeEnumToDisplay(trade.exchange)

  const leverage =
    template?.leverage ??
    (trade.leverage ? `Cross ${Math.round(trade.leverage)}x` : undefined) ??
    undefined

  return {
    symbol,
    direction: trade.direction === 'SHORT' ? 'SHORT' : 'LONG',
    exchange: exchangeDisplay,
    entries: [Number(trade.entryPrice)] as [number],
    stopLoss: Number(trade.slPrice),
    targets: targets.length > 0 ? (targets as [number, ...number[]]) : undefined,
    leverage: leverage || undefined,
    footer: template?.footer ?? undefined,
  }
}

const EXCHANGE_MAP: Record<string, string> = {
  BINANCE_FUTURES: 'Binance Futures',
  BINANCE_SPOT: 'Binance Spot',
  BYBIT: 'Bybit',
  KRAKEN: 'Kraken',
}

function exchangeEnumToDisplay(enumValue: string): string {
  return EXCHANGE_MAP[enumValue] ?? enumValue.replace(/_/g, ' ')
}

// ─────────────────────────────────────────────────────────────────────────────
// Route factory
// ─────────────────────────────────────────────────────────────────────────────

export function createSignalPublishRoutes(db: PrismaClient): Router {
  const router = Router()

  router.use(requireAuth)

  // ── POST /:tradeId/validate ──────────────────────────────────────────────
  // No plan gate — called live as the user fills in trade fields.
  // Returns { valid, errors, warnings, riskReward }
  router.post(
    '/:tradeId/validate',
    async (req: Request, res: Response) => {
      try {
      const trade = await db.trade.findFirst({
        where: {
          id: req.params['tradeId'] as string,
          workspaceId: req.user!.workspaceId,
        },
        select: {
          symbol: true,
          direction: true,
          exchange: true,
          entryPrice: true,
          slPrice: true,
          tp1Price: true,
          tp2Price: true,
          tp3Price: true,
          leverage: true,
        },
      })

      if (!trade) {
        return res.status(404).json({ error: 'Trade not found' })
      }

      // Allow caller to override template fields for live preview
      const overrides = req.body as {
        exchange?: string
        leverage?: string
        footer?: string
      }

      const fields = tradeToSignalFields(trade as any, overrides)
      const result = validator.validate(fields)

      return res.json(result)
      } catch (err: any) {
        res.status(500).json({ error: err.message })
      }
    })

  // ── POST /:tradeId/preview ───────────────────────────────────────────────
  // Pro+ only. Returns all 3 format previews + validation result.
  router.post(
    '/:tradeId/preview',
    async (req: Request, res: Response) => {
      try {
      if (!requirePro(req, res)) return

      const { templateId } = req.body as { templateId?: string }

      const trade = await db.trade.findFirst({
        where: {
          id: req.params['tradeId'] as string,
          workspaceId: req.user!.workspaceId,
        },
      })

      if (!trade) {
        return res.status(404).json({ error: 'Trade not found' })
      }

      // Resolve template (explicit → user default → null)
      let template = null
      if (templateId) {
        template = await db.signalTemplate.findFirst({
          where: { id: templateId, userId: req.user!.userId },
        })
        if (!template) {
          return res.status(404).json({ error: 'Template not found' })
        }
      } else {
        template = await db.signalTemplate.findFirst({
          where: { userId: req.user!.userId, isDefault: true },
        })
      }

      const fields = tradeToSignalFields(trade as any, template)
      const validation = validator.validate(fields)

      if (!validation.valid) {
        return res.status(422).json({
          error: 'Signal incomplete — fix errors before previewing',
          errors: validation.errors,
          warnings: validation.warnings,
        })
      }

      // All three formats (safe to cast: validation passed, fields are complete)
      const completeFields = fields as SignalFields
      const previews = {
        cornix: formatter.formatCornix(completeFields),
        discord: formatter.formatDiscordEmbed(completeFields),
        telegram: formatter.formatPlainTelegram(completeFields),
      }

      return res.json({
        previews,
        validation: {
          warnings: validation.warnings,
          riskReward: validation.riskReward,
        },
        templateUsed: template
          ? { id: template.id, name: template.name }
          : null,
      })
      } catch (err: any) {
        res.status(500).json({ error: err.message })
      }
    })

  // ── POST /:tradeId/publish ───────────────────────────────────────────────
  // Pro+ only. Hard-validates, creates publish record, fires to channels.
  router.post(
    '/:tradeId/publish',
    async (req: Request, res: Response) => {
      try {
      if (!requirePro(req, res)) return

      const {
        channels,    // { telegram?: string[], discord?: string[] }
        templateId,
        format = 'cornix',
      } = req.body as {
        channels: { telegram?: string[]; discord?: string[] }
        templateId?: string
        format?: string
      }

      if (!channels || (!channels.telegram?.length && !channels.discord?.length)) {
        return res.status(400).json({
          error: 'At least one channel must be selected',
        })
      }

      const trade = await db.trade.findFirst({
        where: {
          id: req.params['tradeId'] as string,
          workspaceId: req.user!.workspaceId,
        },
      })

      if (!trade) {
        return res.status(404).json({ error: 'Trade not found' })
      }

      const template = templateId
        ? await db.signalTemplate.findFirst({
            where: { id: templateId, userId: req.user!.userId },
          })
        : await db.signalTemplate.findFirst({
            where: { userId: req.user!.userId, isDefault: true },
          })

      const fields = tradeToSignalFields(trade as any, template)
      const validation = validator.validate(fields)

      // Hard block — cannot publish an invalid signal
      if (!validation.valid) {
        return res.status(422).json({
          error: 'Signal failed validation — cannot publish',
          code: 'VALIDATION_FAILED',
          errors: validation.errors,
        })
      }

      const cornixFormatted = formatter.formatCornix(fields as SignalFields)

      // Create immutable publish record
      const publish = await db.signalPublish.create({
        data: {
          tradeId: trade.id,
          templateId: template?.id ?? null,
          userId: req.user!.userId,
          workspaceId: req.user!.workspaceId,
          channels,
          format,
          content: cornixFormatted.text!,
          status: 'VALIDATED',
          validatedAt: new Date(),
        },
      })

      // Fire-and-forget to channels (queue in production via BullMQ)
      // The status will be updated to PUBLISHED/FAILED by the worker
      dispatchPublishJob(publish.id, channels, cornixFormatted.text!, fields as SignalFields, db)
        .catch((err: Error) => {
          console.error({ publishId: publish.id, err: err.message }, 'publish dispatch failed')
        })

      return res.status(202).json({
        publishId: publish.id,
        status: 'PUBLISHING',
        message: 'Signal queued for delivery',
      })
      } catch (err: any) {
        res.status(500).json({ error: err.message })
      }
    })

  // ── GET /templates ───────────────────────────────────────────────────────
  router.get(
    '/templates',
    async (req: Request, res: Response) => {
      try {
      if (!requirePro(req, res)) return

      const templates = await db.signalTemplate.findMany({
        where: { userId: req.user!.userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      })

      return res.json(templates)
      } catch (err: any) {
        res.status(500).json({ error: err.message })
      }
    })

  // ── POST /templates ──────────────────────────────────────────────────────
  router.post(
    '/templates',
    async (req: Request, res: Response) => {
      try {
      if (!requirePro(req, res)) return

      const {
        name,
        exchange,
        leverage,
        footer,
        channels,
        isDefault = false,
      } = req.body as {
        name: string
        exchange: string
        leverage?: string
        footer?: string
        channels: { telegram: boolean; discord: boolean }
        isDefault?: boolean
      }

      if (!name?.trim() || !exchange?.trim()) {
        return res.status(400).json({ error: 'name and exchange are required' })
      }

      // Validate leverage format if provided
      if (leverage) {
        const levResult = validator.validate({ leverage })
        const levError = levResult.errors.find((e) => e.field === 'leverage')
        if (levError) {
          return res.status(400).json({ error: levError.message })
        }
      }

      const userId = req.user!.userId
      const workspaceId = req.user!.workspaceId

      if (isDefault) {
        // Unset existing default for this user atomically
        await db.signalTemplate.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        })
      }

      const template = await db.signalTemplate.create({
        data: {
          userId,
          workspaceId,
          name: name.trim(),
          exchange: exchange.trim(),
          leverage: leverage ?? null,
          footer: footer?.trim() ?? null,
          channels: channels ?? { telegram: true, discord: false },
          isDefault,
        },
      })

      return res.status(201).json(template)
      } catch (err: any) {
        res.status(500).json({ error: err.message })
      }
    })

  // ── PUT /templates/:id ───────────────────────────────────────────────────
  router.put(
    '/templates/:id',
    async (req: Request, res: Response) => {
      try {
      if (!requirePro(req, res)) return

      const userId = req.user!.userId

      const existing = await db.signalTemplate.findFirst({
        where: { id: req.params['id'] as string, userId },
      })
      if (!existing) {
        return res.status(404).json({ error: 'Template not found' })
      }

      const { name, exchange, leverage, footer, channels, isDefault } = req.body

      if (leverage) {
        const levResult = validator.validate({ leverage })
        const levError = levResult.errors.find((e: { field: string }) => e.field === 'leverage')
        if (levError) {
          return res.status(400).json({ error: (levError as { message: string }).message })
        }
      }

      if (isDefault && !existing.isDefault) {
        await db.signalTemplate.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        })
      }

      const updated = await db.signalTemplate.update({
        where: { id: existing.id },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(exchange !== undefined && { exchange: exchange.trim() }),
          ...(leverage !== undefined && { leverage }),
          ...(footer !== undefined && { footer: footer?.trim() ?? null }),
          ...(channels !== undefined && { channels }),
          ...(isDefault !== undefined && { isDefault }),
        },
      })

      return res.json(updated)
      } catch (err: any) {
        res.status(500).json({ error: err.message })
      }
    })

  // ── DELETE /templates/:id ────────────────────────────────────────────────
  router.delete(
    '/templates/:id',
    async (req: Request, res: Response) => {
      try {
      if (!requirePro(req, res)) return

      const userId = req.user!.userId

      const existing = await db.signalTemplate.findFirst({
        where: { id: req.params['id'] as string, userId },
      })
      if (!existing) {
        return res.status(404).json({ error: 'Template not found' })
      }

      await db.signalTemplate.delete({ where: { id: existing.id } })
      return res.status(204).send()
      } catch (err: any) {
        res.status(500).json({ error: err.message })
      }
    })

  return router
}

// ─────────────────────────────────────────────────────────────────────────────
// Publish dispatcher
// In production this should enqueue a BullMQ job. For now it runs inline
// and updates the publish record status directly.
// ─────────────────────────────────────────────────────────────────────────────

async function dispatchPublishJob(
  publishId: string,
  channels: { telegram?: string[]; discord?: string[] },
  cornixText: string,
  _fields: SignalFields,
  db: any,
): Promise<void> {
  const results: {
    telegram: { chatId: string; messageId?: string; ok: boolean; error?: string }[]
    discord: { channelId: string; messageId?: string; ok: boolean; error?: string }[]
  } = { telegram: [], discord: [] }

  // ── Telegram ──────────────────────────────────────────────────────────────
  // Import lazily — Telegram bot may not be initialised in all environments
  if (channels.telegram?.length) {
    for (const chatId of channels.telegram) {
      try {
        // Dynamic import keeps the route file free of hard bot dependencies
        // TODO: wire up when Telegram bot service exists
        // const bot = getTelegramBot()
        // const msg = await bot.sendMessage(chatId, cornixText, cornixTelegramOptions())
        // results.telegram.push({ chatId, messageId: String(msg.message_id), ok: true })
        throw new Error('Telegram delivery not yet wired — bot service not initialised')
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        results.telegram.push({ chatId, ok: false, error })
      }
    }
  }

  // ── Discord ───────────────────────────────────────────────────────────────
  if (channels.discord?.length) {
    // Generate the embed once — same fields, all channels get the same payload
    const discordFormatted = formatter.formatDiscordEmbed(_fields as SignalFields)
    const embed = discordFormatted.embed

    for (const channelId of channels.discord) {
      try {
        // TODO: wire up when Discord client service exists
        // const client = getDiscordClient()
        // const channel = await client.channels.fetch(channelId)
        // const payload = buildDiscordCornixPayload(cornixText, embed)
        // const msg = await channel.send(payload)
        // results.discord.push({ channelId, messageId: msg.id, ok: true })
        throw new Error('Discord delivery not yet wired — client service not initialised')
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        results.discord.push({ channelId, ok: false, error })
      }
    }
  }

  const allOk = [...results.telegram, ...results.discord].every((r) => r.ok)
  const anyOk = [...results.telegram, ...results.discord].some((r) => r.ok)

  await db.signalPublish.update({
    where: { id: publishId },
    data: {
      status: allOk ? 'PUBLISHED' : anyOk ? 'PARTIAL' : 'FAILED',
      publishedAt: anyOk ? new Date() : null,
      results,
      error: !anyOk ? 'All channel deliveries failed' : null,
    },
  })
}
