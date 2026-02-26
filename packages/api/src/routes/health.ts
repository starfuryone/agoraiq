import { Router, Request, Response } from 'express';
import { PrismaClient } from '@agoraiq/db';

export function createHealthRoutes(db: PrismaClient): Router {
  const router = Router();

  router.get('/health', async (_req: Request, res: Response) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
    }
  });

  return router;
}
