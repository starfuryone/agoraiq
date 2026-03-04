"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    TELEGRAM_BOT_TOKEN: zod_1.z.string().min(1),
    TELEGRAM_WEBHOOK_SECRET: zod_1.z.string().min(16),
    AGORAIQ_API_URL: zod_1.z.string().url(),
    AGORAIQ_INTERNAL_API_KEY: zod_1.z.string().min(1),
    BOT_WEBHOOK_DOMAIN: zod_1.z.string().url(),
    BOT_WEBHOOK_PATH: zod_1.z.string().default("/webhook"),
    PORT: zod_1.z.coerce.number().default(3100),
    NODE_ENV: zod_1.z.enum(["development", "production", "test"]).default("development"),
});
exports.config = envSchema.parse(process.env);
//# sourceMappingURL=env.js.map