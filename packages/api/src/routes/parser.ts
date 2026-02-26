import { Router, Request, Response, IRouter } from 'express'
import { parseSignal } from '@agoraiq/signal-engine'

export function createParserRoutes(): IRouter {
  const router = Router()

  router.post('/test', async (req: Request, res: Response) => {
    try {
      const { raw, parserMode, confidenceThreshold, promptTemplate } = req.body

      if (!raw || typeof raw !== 'string') {
        return res.status(400).json({ error: 'raw message is required' })
      }

      const result = await parseSignal(raw, {
        mode:                parserMode ?? 'CORNIX',
        confidenceThreshold: confidenceThreshold ?? 0.75,
        llmPromptTemplate:   promptTemplate ?? null,
      })

      return res.json(result)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      return res.status(500).json({ error: msg })
    }
  })

  return router
}
