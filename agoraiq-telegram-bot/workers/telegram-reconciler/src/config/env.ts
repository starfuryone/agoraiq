import { z } from "zod";

const envSchema = z.object({
  REDIS_URL: z.string(),
  AGORAIQ_API_URL: z.string().url(),
  AGORAIQ_WORKER_API_KEY: z.string().min(1),
  RECONCILE_CRON: z.string().default("0 3 * * *"),
  INVITE_CLEANUP_CRON: z.string().default("*/30 * * * *"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const config = envSchema.parse(process.env);
