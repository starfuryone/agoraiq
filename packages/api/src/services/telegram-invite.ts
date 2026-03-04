import { PrismaClient } from '@agoraiq/db';
import { createLogger } from '@agoraiq/db';
import { getUserTier, tierSatisfies } from './telegram-entitlement';

const log = createLogger('telegram-invite');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const MAX_INVITES_PER_HOUR = 5;
const INVITE_EXPIRY_MINUTES = 30;

async function createTelegramInviteLink(chatId: string, name: string, expireDate: number, memberLimit = 1): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createChatInviteLink`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, name, expire_date: expireDate, member_limit: memberLimit }),
    });
    const data: any = await res.json();
    if (!data.ok) { log.error({ chatId, error: data.description }, 'Failed to create invite'); return null; }
    return data.result.invite_link;
  } catch (err) { log.error({ err, chatId }, 'Telegram API error'); return null; }
}

export async function revokeTelegramInviteLink(chatId: string, inviteLink: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/revokeChatInviteLink`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, invite_link: inviteLink }),
    });
    return ((await res.json()) as any).ok === true;
  } catch { return false; }
}

export async function generateInvite(db: PrismaClient, userId: string, telegramId: string, sourceId: string) {
  const source = await db.telegramSource.findUnique({ where: { id: sourceId } });
  if (!source) return { error: 'SOURCE_NOT_FOUND' };
  if (source.status !== 'active') return { error: 'SOURCE_PAUSED', message: 'Source currently unavailable' };

  const userTier = await getUserTier(db, userId);
  if (!tierSatisfies(userTier, source.tierMin)) return { error: 'SOURCE_LOCKED', message: `Requires ${source.tierMin} tier` };

  const existing = await db.telegramMembership.findUnique({ where: { userId_sourceId: { userId, sourceId } } });
  if (existing?.status === 'active') return { error: 'ALREADY_MEMBER' };

  const oneHourAgo = new Date(Date.now() - 3600000);
  const recent = await db.telegramInvite.count({ where: { userId, createdAt: { gte: oneHourAgo } } });
  if (recent >= MAX_INVITES_PER_HOUR) return { error: 'RATE_LIMITED' };

  const active = await db.telegramInvite.findFirst({ where: { userId, sourceId, expiresAt: { gt: new Date() }, usedAt: null, revokedAt: null } });
  if (active) return { inviteLink: active.inviteLink, expiresAt: active.expiresAt, sourceName: source.name };

  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MINUTES * 60000);
  const inviteLink = await createTelegramInviteLink(source.telegramChatId, `agoraiq-${userId.slice(-6)}-${Date.now()}`, Math.floor(expiresAt.getTime() / 1000), 1);
  if (!inviteLink) return { error: 'INVITE_CREATION_FAILED' };

  await db.telegramInvite.create({ data: { userId, sourceId, telegramId, inviteLink, expiresAt } });
  await db.telegramAuditLog.create({ data: { action: 'invite_created', telegramId, userId, sourceId, metadata: { inviteLink, sourceName: source.name } } });
  log.info({ userId, sourceId }, 'Invite generated');
  return { inviteLink, expiresAt, sourceName: source.name };
}
