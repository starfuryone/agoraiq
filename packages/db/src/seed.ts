// ═══════════════════════════════════════════════════════════════
// @agoraiq/db — Seed Script
//
// Creates:
//   1. ITB provider record
//   2. Admin user for proof workspace
//   3. Starter subscription for admin
// ═══════════════════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const db = new PrismaClient();

async function main() {
  const proofWorkspaceId = process.env.PROOF_WORKSPACE_ID || 'proof-workspace-default';
  const itbToken = process.env.ITB_PROVIDER_TOKEN || 'change-this-itb-secret-token';

  console.log('🌱 Seeding AgoraIQ database...\n');

  // ── 1. ITB Provider ──────────────────────────────────────────
  const itbProvider = await db.provider.upsert({
    where: { slug: 'itb' },
    update: {},
    create: {
      slug: 'itb',
      name: 'Intelligent Trading Bot',
      description: 'In-house ML signal provider',
      proofCategory: 'all',
      isActive: true,
      config: {
        webhookSecret: itbToken,
        rateLimits: { maxPerMinute: 120 },
        ipAllowlist: [],  // empty = allow all
        defaultExchange: 'BINANCE_FUTURES',
        defaultTpPct: 3.0,
        defaultSlPct: 1.5,
        defaultTimeoutHours: 72,
      },
    },
  });
  console.log(`  ✅ Provider: ${itbProvider.name} (slug: ${itbProvider.slug})`);

  // ── 2. Admin User ────────────────────────────────────────────
  const adminUser = await db.user.upsert({
    where: { email: 'admin@agoraiq.net' },
    update: {},
    create: {
      email: 'admin@agoraiq.net',
      // Default password: "changeme" — MUST be changed in production
      passwordHash: crypto.createHash('sha256').update('changeme').digest('hex'),
      name: 'AgoraIQ Admin',
      workspaceId: proofWorkspaceId,
      role: 'admin',
    },
  });
  console.log(`  ✅ Admin user: ${adminUser.email}`);

  // ── 3. Admin Subscription ────────────────────────────────────
  await db.subscription.upsert({
    where: { userId: adminUser.id },
    update: {},
    create: {
      userId: adminUser.id,
      tier: 'elite',
      status: 'active',
    },
  });
  console.log(`  ✅ Subscription: elite (admin)`);

  console.log('\n🎉 Seed complete!\n');
  console.log(`   Proof workspace ID: ${proofWorkspaceId}`);
  console.log(`   ITB provider slug:  itb`);
  console.log(`   Admin email:        admin@agoraiq.net`);
  console.log(`   Admin password:     changeme (CHANGE THIS)\n`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
