// ═══════════════════════════════════════════════════════════════
// @agoraiq/api — Auth Routes
//
//   POST /api/v1/auth/signup   — Create account
//   POST /api/v1/auth/login    — Login, get JWT
//   GET  /api/v1/auth/me       — Current user info
// ═══════════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@agoraiq/db';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { createLogger } from '@agoraiq/db';
import { requireAuth, signToken } from '../middleware/auth';

const log = createLogger('auth-routes');

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function createAuthRoutes(db: PrismaClient): Router {
  const router = Router();
  const proofWorkspaceId = process.env.PROOF_WORKSPACE_ID || 'proof-workspace-default';

  // POST /signup
  router.post('/signup', async (req: Request, res: Response) => {
    const parsed = SignupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_FAILED', issues: parsed.error.issues });
      return;
    }

    try {
      const existing = await db.user.findUnique({ where: { email: parsed.data.email } });
      if (existing) {
        res.status(409).json({ error: 'EMAIL_EXISTS', message: 'Email already registered' });
        return;
      }

      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      const user = await db.user.create({
        data: {
          email: parsed.data.email,
          passwordHash,
          name: parsed.data.name || null,
          workspaceId: proofWorkspaceId,
        },
      });

      // Create starter subscription (trialing)
      await db.subscription.create({
        data: { userId: user.id, tier: 'starter', status: 'trialing' },
      });

      const token = signToken({
        userId: user.id, email: user.email,
        workspaceId: user.workspaceId, role: user.role,
      });

      res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) {
      log.error({ err }, 'Signup failed');
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // POST /login
  router.post('/login', async (req: Request, res: Response) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'VALIDATION_FAILED', issues: parsed.error.issues });
      return;
    }

    try {
      const user = await db.user.findUnique({ where: { email: parsed.data.email } });
      if (!user || !user.isActive) {
        res.status(401).json({ error: 'INVALID_CREDENTIALS' });
        return;
      }

      const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: 'INVALID_CREDENTIALS' });
        return;
      }

      const token = signToken({
        userId: user.id, email: user.email,
        workspaceId: user.workspaceId, role: user.role,
      });

      res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) {
      log.error({ err }, 'Login failed');
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  // GET /me
  router.get('/me', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await db.user.findUnique({
        where: { id: req.user!.userId },
        select: { id: true, email: true, name: true, role: true, workspaceId: true, createdAt: true },
      });
      if (!user) { res.status(404).json({ error: 'USER_NOT_FOUND' }); return; }

      const sub = await db.subscription.findUnique({ where: { userId: user.id } });
      res.json({ user, subscription: sub ? { tier: sub.tier, status: sub.status } : null });
    } catch (err) {
      log.error({ err }, 'Get user failed');
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  return router;
}
