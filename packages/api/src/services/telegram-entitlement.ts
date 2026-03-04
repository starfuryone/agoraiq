import { PrismaClient } from '@agoraiq/db';

const TIER_HIERARCHY: Record<string, number> = {
  FREE: 0, starter: 1, pro: 2, elite: 3,
};

function normalizeTier(tier: string): string {
  return tier.toUpperCase() === 'FREE' ? 'FREE' : tier.toLowerCase();
}

export function tierSatisfies(userTier: string, requiredTier: string): boolean {
  const userLevel = TIER_HIERARCHY[normalizeTier(userTier)] ?? 0;
  const requiredLevel = TIER_HIERARCHY[normalizeTier(requiredTier)] ?? 0;
  return userLevel >= requiredLevel;
}

export async function getUserTier(db: PrismaClient, userId: string): Promise<string> {
  const sub = await db.subscription.findUnique({ where: { userId } });
  if (!sub || (sub.status !== 'active' && sub.subscriptionStatus !== 'active')) return 'FREE';
  return sub.tier || sub.planTier || 'FREE';
}
