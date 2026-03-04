import { Request, Response, NextFunction } from 'express';
import { createLogger } from '@agoraiq/db';

const log = createLogger('bot-auth');

const BOT_API_KEY = process.env.TELEGRAM_INTERNAL_API_KEY || '';
const WORKER_API_KEY = process.env.TELEGRAM_WORKER_API_KEY || '';

if (!BOT_API_KEY) log.warn('TELEGRAM_INTERNAL_API_KEY not set');
if (!WORKER_API_KEY) log.warn('TELEGRAM_WORKER_API_KEY not set');

export function requireBotAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing Authorization header' });
    return;
  }
  const token = header.slice(7);
  if (token !== BOT_API_KEY) {
    log.warn({ ip: req.ip }, 'Invalid bot API key');
    res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid API key' });
    return;
  }
  next();
}

export function requireWorkerAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing Authorization header' });
    return;
  }
  const token = header.slice(7);
  if (token !== WORKER_API_KEY) {
    log.warn({ ip: req.ip }, 'Invalid worker API key');
    res.status(403).json({ error: 'FORBIDDEN', message: 'Invalid API key' });
    return;
  }
  next();
}
