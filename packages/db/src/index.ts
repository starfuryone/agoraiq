import { PrismaClient } from '@prisma/client';

export { createLogger, rootLogger } from './logger';
export { PrismaClient } from '@prisma/client';
export type { Prisma } from '@prisma/client';

// Singleton PrismaClient (prevents connection exhaustion in dev)
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

export * from './alerts/index';
