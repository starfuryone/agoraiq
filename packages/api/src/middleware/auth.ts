// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Auth Middleware
//
// JWT bearer token auth for paid endpoints.
// Subscription entitlement check for premium features.
// ═══════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@agoraiq/db';
import { createLogger } from '@agoraiq/db';

const log = createLogger('auth');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-to-a-random-64-char-string';

export interface AuthPayload {
  userId: string;
  email: string;
  workspaceId: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

/** Verify JWT bearer token — rejects 401 if missing/invalid */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch (err) {
    log.warn({ err }, 'JWT verification failed');
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' });
  }
}

/** Check that the authenticated user has an active subscription */
export function requireSubscription(db: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }

    try {
      const sub = await db.subscription.findUnique({
        where: { userId: req.user.userId },
      });

      if (!sub || sub.status !== 'active') {
        res.status(403).json({
          error: 'SUBSCRIPTION_REQUIRED',
          message: 'Active subscription required to access this resource',
        });
        return;
      }

      // Attach tier info for downstream route handlers
      (req as any).subscriptionTier = sub.tier;
      next();
    } catch (err) {
      log.error({ err }, 'Subscription check failed');
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  };
}

/** Check for admin role */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
    return;
  }
  next();
}

/** Generate a JWT token */
export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: (process.env.JWT_EXPIRY || '7d') as any,
  });
}
