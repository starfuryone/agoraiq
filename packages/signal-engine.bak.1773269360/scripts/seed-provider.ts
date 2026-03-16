#!/usr/bin/env npx tsx
/**
 * @agoraiq/signal-engine — Provider Bootstrap
 *
 * Creates the `agoraiq-engine` provider record. Supports two modes:
 *
 *   MODE 1 — HTTP (default): POST to the AgoraIQ admin API to create the provider.
 *   MODE 2 — Prisma (if available): Direct DB insert.
 *
 * Usage:
 *   npx tsx scripts/seed-provider.ts                    # uses HTTP
 *   npx tsx scripts/seed-provider.ts --mode=prisma       # uses Prisma
 *   npx tsx scripts/seed-provider.ts --dry-run            # print payload only
 *
 * Environment:
 *   AGORAIQ_API_BASE_URL  — API base (default: http://localhost:3000/api/v1)
 *   AGORAIQ_ADMIN_TOKEN   — Admin token for creating providers
 */

import { getProxiedAxios } from "../src/services/http-client";

const API_BASE = process.env.AGORAIQ_API_BASE_URL ?? "http://localhost:3000/api/v1";
const ADMIN_TOKEN = process.env.AGORAIQ_ADMIN_TOKEN ?? "";
const DRY_RUN = process.argv.includes("--dry-run");
const USE_PRISMA = process.argv.includes("--mode=prisma");

const PROVIDER_RECORD = {
  slug: "agoraiq-engine",
  name: "AgoraIQ Engine",
  description:
    "First-party signal generation engine. Scans BTC, ETH, SOL, XRP across " +
    "multiple timeframes using trend continuation, breakout confirmation, and " +
    "mean reversion strategies. Scores each setup on technicals, market structure, " +
    "news context, and historical expectancy. Breakout detection uses swing-point " +
    "clustered support/resistance levels with touch counting and recency weighting.",
  providerType: "SIGNAL",
  isVerified: true,
  analyticsEligible: true,
};

// ─── HTTP mode ─────────────────────────────────────────────────────────────────

async function seedViaHTTP(): Promise<void> {
  const url = `${API_BASE}/admin/providers`;

  console.log(`POST ${url}`);
  console.log(JSON.stringify(PROVIDER_RECORD, null, 2));

  if (DRY_RUN) {
    console.log("\n[DRY RUN] — would POST the above. Exiting.");
    return;
  }

  try {
    const res = await getProxiedAxios().post(url, PROVIDER_RECORD, {
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 10_000,
      validateStatus: () => true,
    });

    if (res.status >= 200 && res.status < 300) {
      console.log("\n✓ Provider created successfully:");
      console.log(JSON.stringify(res.data, null, 2));
      console.log(
        "\nIf a token was returned, set it in your .env as AGORAIQ_ENGINE_TOKEN."
      );
    } else if (res.status === 409) {
      console.log("\n⚠ Provider already exists (409). No action needed.");
    } else {
      console.error(`\n✗ Failed: HTTP ${res.status}`);
      console.error(res.data);
    }
  } catch (err: any) {
    console.error("\n✗ Request failed:", err.message);
    console.error(
      "\nIs AgoraIQ running? Check AGORAIQ_API_BASE_URL and AGORAIQ_ADMIN_TOKEN."
    );
    process.exit(1);
  }
}

// ─── Prisma mode ───────────────────────────────────────────────────────────────

async function seedViaPrisma(): Promise<void> {
  console.log("Attempting Prisma-based seed...\n");

  if (DRY_RUN) {
    console.log("Would upsert:");
    console.log(JSON.stringify(PROVIDER_RECORD, null, 2));
    console.log("\n[DRY RUN] — exiting.");
    return;
  }

  try {
    // Dynamic import so this doesn't fail at parse time if Prisma isn't installed
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    const provider = await prisma.provider.upsert({
      where: { slug: PROVIDER_RECORD.slug },
      update: {},
      create: PROVIDER_RECORD as any,
    });

    console.log("✓ Provider upserted:");
    console.log(JSON.stringify(provider, null, 2));

    await prisma.$disconnect();
  } catch (err: any) {
    if (err.code === "MODULE_NOT_FOUND") {
      console.error(
        "✗ @prisma/client not found. Run with HTTP mode instead, or install Prisma."
      );
    } else {
      console.error("✗ Prisma seed failed:", err.message);
    }
    process.exit(1);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("═══════════════════════════════════════════");
  console.log("  AgoraIQ Engine — Provider Bootstrap");
  console.log("═══════════════════════════════════════════\n");

  if (USE_PRISMA) {
    await seedViaPrisma();
  } else {
    await seedViaHTTP();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
