import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16),
  AGORAIQ_API_URL: z.string().url(),
  AGORAIQ_INTERNAL_API_KEY: z.string().min(1),
  BOT_WEBHOOK_DOMAIN: z.string().url(),
  BOT_WEBHOOK_PATH: z.string().default("/webhook"),
  PORT: z.coerce.number().default(3100),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const config = envSchema.parse(process.env);
export type Config = z.infer<typeof envSchema>;
