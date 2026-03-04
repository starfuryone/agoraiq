"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleLinkStart = handleLinkStart;
const api_1 = require("../utils/api");
const format_1 = require("../utils/format");
const keyboard_1 = require("../utils/keyboard");
const rateLimit_1 = require("../middleware/rateLimit");
async function handleLinkStart(ctx) {
    const tgId = ctx.from?.id;
    if (!tgId)
        return;
    if (ctx.aqUser?.linked) {
        await ctx.reply("\u2705 Your account is already linked!", { parse_mode: "HTML", ...(0, keyboard_1.mainMenu)() });
        return;
    }
    const rl = (0, rateLimit_1.checkRateLimit)(`link:${tgId}`, 3, 60 * 60 * 1000);
    if (!rl.allowed) {
        await ctx.reply(format_1.MSG.RATE_LIMITED, { parse_mode: "HTML" });
        return;
    }
    const { data, error } = await api_1.api.linkStart(tgId, ctx.from?.username);
    if (error) {
        await ctx.reply(format_1.MSG.ERROR, { parse_mode: "HTML" });
        return;
    }
    if (data) {
        const expiry = new Date(data.expires_at).toLocaleTimeString();
        await ctx.reply(format_1.MSG.LINK_CODE(data.link_url, expiry), { parse_mode: "HTML", ...(0, keyboard_1.backToMain)() });
    }
}
//# sourceMappingURL=link.js.map