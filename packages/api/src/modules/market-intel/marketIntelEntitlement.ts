// ============================================================
// AgoraIQ Market Intel — Entitlements Middleware
// /middleware/marketIntelEntitlement.ts
//
// Protects Market Intel endpoints (requires paid plan).
// INTEGRATION: If you already have auth/entitlement middleware,
// replace the plan-check logic below with your existing check.
// ============================================================

import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';

// Plans that include Market Intel access
const MARKET_INTEL_PLANS = new Set(['pro', 'elite', 'market_intel', 'admin']);

// ── User shape from your JWT/session ─────────────────────────
// INTEGRATION: Adjust to match your actual user type.





// ── Market Intel plan guard ───────────────────────────────────
export function requireMarketIntel(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = req.user;

  if (!user) {
    res.status(401).json({
      error:   'Unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  if (!MARKET_INTEL_PLANS.has((user as any).plan?.toLowerCase()) && user.role !== 'admin') {
    res.status(403).json({
      error:   'Forbidden',
      message: 'Market Intel requires a paid subscription ($79/mo)',
      upgradeUrl: `${process.env.APP_BASE_URL}/upgrade?feature=market_intel`,
    });
    return;
  }

  next();
}

// ── Admin guard ───────────────────────────────────────────────
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = req.user;

  if (!user || user.role !== 'admin') {
    res.status(403).json({
      error:   'Forbidden',
      message: 'Admin access required',
    });
    return;
  }

  next();
}

// ── Combined guards ───────────────────────────────────────────
export const marketIntelGuard = [requireAuth, requireMarketIntel];
export const adminGuard        = [requireAuth, requireAdmin];
