import { Telegraf } from "telegraf";
import { config } from "./config/env";
import { loadUser, AgoraIQContext } from "./middleware/auth";
import { handleStart } from "./handlers/start";
import { handleCallback } from "./handlers/callback";
import { api } from "./utils/api";
import { formatSignalCard, MSG } from "./utils/format";
import { signalCardButtons, backToMain } from "./utils/keyboard";

export const bot = new Telegraf<AgoraIQContext>(config.TELEGRAM_BOT_TOKEN);

bot.use(loadUser);

bot.start(handleStart);
bot.command("menu", async (ctx) => { await handleStart(ctx as AgoraIQContext); });

bot.on("callback_query", handleCallback);

bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();

  if (text.match(/^sig_/i)) {
    if (!ctx.aqUser?.linked) {
      await ctx.reply(MSG.NOT_LINKED, { parse_mode: "HTML" });
      return;
    }
    const { data, error } = await api.getSignalCard(text);
    if (error || !data) {
      await ctx.reply(`Signal <code>${text}</code> not found.`, { parse_mode: "HTML", ...backToMain() });
      return;
    }
    await ctx.reply(formatSignalCard(data), {
      parse_mode: "HTML",
      ...signalCardButtons({ proof_url: data.proof_url, provider_id: data.provider_name, signal_id: data.signal_id }),
    });
    return;
  }
});

bot.catch((err, ctx) => {
  console.error("[Bot] Unhandled error:", err);
  ctx.reply(MSG.ERROR).catch(() => {});
});
