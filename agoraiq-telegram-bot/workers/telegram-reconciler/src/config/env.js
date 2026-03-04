"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    REDIS_URL: zod_1.z.string(),
    AGORAIQ_API_URL: zod_1.z.string().url(),
    AGORAIQ_WORKER_API_KEY: zod_1.z.string().min(1),
    RECONCILE_CRON: zod_1.z.string().default("0 3 * * *"),
    INVITE_CLEANUP_CRON: zod_1.z.string().default("*/30 * * * *"),
    NODE_ENV: zod_1.z.enum(["development", "production", "test"]).default("development"),
});
exports.config = envSchema.parse(process.env);
//# sourceMappingURL=env.js.map