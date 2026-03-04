"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bot = void 0;
const telegraf_1 = require("telegraf");
const env_1 = require("./config/env");
const auth_1 = require("./middleware/auth");
const start_1 = require("./handlers/start");
const callback_1 = require("./handlers/callback");
const api_1 = require("./utils/api");
const format_1 = require("./utils/format");
const keyboard_1 = require("./utils/keyboard");
exports.bot = new telegraf_1.Telegraf(env_1.config.TELEGRAM_BOT_TOKEN);
exports.bot.use(auth_1.loadUser);
exports.bot.start(start_1.handleStart);
exports.bot.command("menu", async (ctx) => { await (0, start_1.handleStart)(ctx); });
exports.bot.on("callback_query", callback_1.handleCallback);
exports.bot.on("text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.match(/^sig_/i)) {
        if (!ctx.aqUser?.linked) {
            await ctx.reply(format_1.MSG.NOT_LINKED, { parse_mode: "HTML" });
            return;
        }
        const { data, error } = await api_1.api.getSignalCard(text);
        if (error || !data) {
            await ctx.reply(`Signal <code>${text}</code> not found.`, { parse_mode: "HTML", ...(0, keyboard_1.backToMain)() });
            return;
        }
        await ctx.reply((0, format_1.formatSignalCard)(data), {
            parse_mode: "HTML",
            ...(0, keyboard_1.signalCardButtons)({ proof_url: data.proof_url, provider_id: data.provider_name, signal_id: data.signal_id }),
        });
        return;
    }
});
exports.bot.catch((err, ctx) => {
    console.error("[Bot] Unhandled error:", err);
    ctx.reply(format_1.MSG.ERROR).catch(() => { });
});
//# sourceMappingURL=bot.js.map