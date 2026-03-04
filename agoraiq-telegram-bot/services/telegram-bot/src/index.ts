import express from "express";
import { bot } from "./bot";
import { config } from "./config/env";

async function main() {
  const app = express();
  const webhookPath = config.BOT_WEBHOOK_PATH;
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "agoraiq-telegram-bot" });
  });

  app.post(webhookPath, (req, res) => {
    const secret = req.headers["x-telegram-bot-api-secret-token"];
    if (secret !== config.TELEGRAM_WEBHOOK_SECRET) {
      console.warn("[Webhook] Invalid secret token");
      res.sendStatus(403);
      return;
    }
    bot.handleUpdate(req.body, res).catch((err) => {
      console.error("[Webhook] Error handling update:", err);
      res.sendStatus(500);
    });
  });

  const webhookUrl = `${config.BOT_WEBHOOK_DOMAIN}${webhookPath}`;
  await bot.telegram.setWebhook(webhookUrl, {
    secret_token: config.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query", "chat_member"],
    drop_pending_updates: config.NODE_ENV === "production",
  });
  console.log(`[Bot] Webhook set: ${webhookUrl}`);

  app.listen(config.PORT, () => {
    console.log(`[Bot] Server listening on port ${config.PORT}`);
  });
}

main().catch((err) => {
  console.error("[Bot] Fatal startup error:", err);
  process.exit(1);
});
