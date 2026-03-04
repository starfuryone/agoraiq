import { PrismaClient } from '@agoraiq/db';
import { createLogger } from '@agoraiq/db';
import crypto from 'crypto';

const log = createLogger('telegram-linking');
const CODE_LENGTH = 8;
const CODE_EXPIRY_MINUTES = 10;
const MAX_CODES_PER_HOUR = 3;

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i++) code += chars[bytes[i] % chars.length];
  return code;
}

export async function createLinkCode(db: PrismaClient, telegramId: string) {
  const oneHourAgo = new Date(Date.now() - 3600000);
  const recentCount = await db.telegramLinkCode.count({ where: { telegramId, createdAt: { gte: oneHourAgo } } });
  if (recentCount >= MAX_CODES_PER_HOUR) return { error: 'RATE_LIMITED' };

  const existing = await db.telegramUser.findUnique({ where: { telegramId } });
  if (existing) return { error: 'ALREADY_LINKED' };

  let code = ''; let attempts = 0;
  do {
    code = generateCode();
    const exists = await db.telegramLinkCode.findUnique({ where: { code } });
    if (!exists) break;
    attempts++;
  } while (attempts < 5);
  if (attempts >= 5) return { error: 'INTERNAL_ERROR' };

  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60000);
  await db.telegramLinkCode.create({ data: { code, telegramId, expiresAt } });
  await db.telegramAuditLog.create({ data: { action: 'link_code_created', telegramId, metadata: { code } } });
  log.info({ telegramId, code }, 'Link code created');
  return { code, expiresAt };
}

export async function confirmLinkCode(db: PrismaClient, code: string, userId: string, chatId: string, username?: string) {
  const linkCode = await db.telegramLinkCode.findUnique({ where: { code } });
  if (!linkCode) return { error: 'CODE_NOT_FOUND' };
  if (linkCode.usedAt) return { error: 'CODE_ALREADY_USED' };
  if (linkCode.expiresAt < new Date()) return { error: 'CODE_EXPIRED' };

  const existingLink = await db.telegramUser.findUnique({ where: { userId } });
  if (existingLink) return { error: 'USER_ALREADY_LINKED' };
  const existingTg = await db.telegramUser.findUnique({ where: { telegramId: linkCode.telegramId } });
  if (existingTg) return { error: 'ALREADY_LINKED' };

  return db.$transaction(async (tx) => {
    await tx.telegramLinkCode.update({ where: { code }, data: { usedAt: new Date(), userId } });
    await tx.telegramUser.create({ data: { telegramId: linkCode.telegramId, userId, chatId, username, isActive: true } });
    const sub = await tx.subscription.findUnique({ where: { userId } });
    await tx.telegramAuditLog.create({ data: { action: 'link_confirmed', telegramId: linkCode.telegramId, userId, metadata: { code, username } } });
    return { linked: true, tier: sub?.tier || sub?.planTier || 'FREE', expiresAt: sub?.endsAt || sub?.currentPeriodEnd || undefined };
  });
}

export async function unlinkAccount(db: PrismaClient, telegramId: string) {
  const tgUser = await db.telegramUser.findUnique({ where: { telegramId } });
  if (!tgUser) return { error: 'NOT_LINKED' };
  await db.$transaction(async (tx) => {
    await tx.telegramUser.delete({ where: { telegramId } });
    await tx.telegramAuditLog.create({ data: { action: 'unlink', telegramId, userId: tgUser.userId } });
  });
  log.info({ telegramId, userId: tgUser.userId }, 'Account unlinked');
  return { unlinked: true };
}
