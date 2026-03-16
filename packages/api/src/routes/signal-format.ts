// ─────────────────────────────────────────────────────────────────────────────
// routes/signal-format.ts — Manual signal paste → formatted HTML card
//
//   POST /api/v1/signals/format
//     Body: { raw: string }
//     Returns: { html, parsed, provider, confidence }
//
// Architecture: raw text → parseLLM() → cornixToCard() → renderSignalCard()
// LLM only parses. Rendering is always deterministic.
//
// Mount in index.ts:
//   import { createSignalFormatRoutes } from './routes/signal-format'
//   app.use('/api/v1/signals', createSignalFormatRoutes(db))
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express'
import { PrismaClient } from '@agoraiq/db'
import { createLogger } from '@agoraiq/db'
import { parseLLM } from '@agoraiq/signal-engine'
import {
  cornixToCard,
  renderSignalCard,
} from '@agoraiq/signal-engine'
import { sanitizeSignalHtml } from '@agoraiq/signal-engine'

// Auth middleware — JWT bearer token, populates req.user
// Importing directly; the middleware is not a factory.
import { requireAuth } from '../middleware/auth'

const log = createLogger('signal-format')

export function createSignalFormatRoutes(_db: PrismaClient): Router {
  const router = Router()

  router.post('/format', requireAuth, async (req: Request, res: Response) => {
    const { raw } = req.body

    if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
      res.status(400).json({ error: 'Missing or empty "raw" field' })
      return
    }
    if (raw.length > 10_000) {
      res.status(400).json({ error: 'Input exceeds 10,000 character limit' })
      return
    }

    try {
      // 1. Parse via LLM fallback chain
      const result = await parseLLM(raw.trim())

      if (!result.success || !result.data) {
        res.status(422).json({
          error: 'Could not parse signal from input',
          details: result.errors,
          explanation: result.explanation,
        })
        return
      }

      // 2. Map to card input
      const cardInput = cornixToCard(result.data)
      if (!cardInput) {
        res.status(422).json({
          error: 'Parsed signal missing entry prices — cannot render card',
          parsed: result.data,
        })
        return
      }

      // 3. Render + sanitize
      const html = sanitizeSignalHtml(renderSignalCard(cardInput))

      res.json({
        html,
        parsed: result.data,
        provider: (result as any).provider,
        confidence: result.confidence,
      })
    } catch (err) {
      log.error({ err }, 'Signal format failed')
      res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  return router
}
