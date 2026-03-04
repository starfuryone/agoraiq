"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bot_1 = require("./bot");
const env_1 = require("./config/env");
async function main() {
    const app = (0, express_1.default)();
    const webhookPath = env_1.config.BOT_WEBHOOK_PATH;
    app.use(express_1.default.json());
    app.get("/health", (_req, res) => {
        res.json({ status: "ok", service: "agoraiq-telegram-bot" });
    });
    app.post(webhookPath, (req, res) => {
        const secret = req.headers["x-telegram-bot-api-secret-token"];
        if (secret !== env_1.config.TELEGRAM_WEBHOOK_SECRET) {
            console.warn("[Webhook] Invalid secret token");
            res.sendStatus(403);
            return;
        }
        bot_1.bot.handleUpdate(req.body, res).catch((err) => {
            console.error("[Webhook] Error handling update:", err);
            res.sendStatus(500);
        });
    });
    const webhookUrl = `${env_1.config.BOT_WEBHOOK_DOMAIN}${webhookPath}`;
    await bot_1.bot.telegram.setWebhook(webhookUrl, {
        secret_token: env_1.config.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query", "chat_member"],
        drop_pending_updates: env_1.config.NODE_ENV === "production",
    });
    console.log(`[Bot] Webhook set: ${webhookUrl}`);
    app.listen(env_1.config.PORT, () => {
        console.log(`[Bot] Server listening on port ${env_1.config.PORT}`);
    });
}
main().catch((err) => {
    console.error("[Bot] Fatal startup error:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map