import { z } from "zod";
declare const envSchema: z.ZodObject<{
    TELEGRAM_BOT_TOKEN: z.ZodString;
    TELEGRAM_WEBHOOK_SECRET: z.ZodString;
    AGORAIQ_API_URL: z.ZodString;
    AGORAIQ_INTERNAL_API_KEY: z.ZodString;
    BOT_WEBHOOK_DOMAIN: z.ZodString;
    BOT_WEBHOOK_PATH: z.ZodDefault<z.ZodString>;
    PORT: z.ZodDefault<z.ZodNumber>;
    NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "production", "test"]>>;
}, "strip", z.ZodTypeAny, {
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_WEBHOOK_SECRET: string;
    AGORAIQ_API_URL: string;
    AGORAIQ_INTERNAL_API_KEY: string;
    BOT_WEBHOOK_DOMAIN: string;
    BOT_WEBHOOK_PATH: string;
    PORT: number;
    NODE_ENV: "development" | "production" | "test";
}, {
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_WEBHOOK_SECRET: string;
    AGORAIQ_API_URL: string;
    AGORAIQ_INTERNAL_API_KEY: string;
    BOT_WEBHOOK_DOMAIN: string;
    BOT_WEBHOOK_PATH?: string | undefined;
    PORT?: number | undefined;
    NODE_ENV?: "development" | "production" | "test" | undefined;
}>;
export declare const config: {
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_WEBHOOK_SECRET: string;
    AGORAIQ_API_URL: string;
    AGORAIQ_INTERNAL_API_KEY: string;
    BOT_WEBHOOK_DOMAIN: string;
    BOT_WEBHOOK_PATH: string;
    PORT: number;
    NODE_ENV: "development" | "production" | "test";
};
export type Config = z.infer<typeof envSchema>;
export {};
//# sourceMappingURL=env.d.ts.map