"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireLinked = exports.loadUser = void 0;
const api_1 = require("../utils/api");
const keyboard_1 = require("../utils/keyboard");
const format_1 = require("../utils/format");
const loadUser = async (ctx, next) => {
    const tgId = ctx.from?.id;
    if (!tgId)
        return next();
    const { data } = await api_1.api.getMe(tgId);
    if (data) {
        ctx.aqUser = {
            linked: data.linked,
            userId: data.user_id,
            tier: data.tier,
            tierExpiresAt: data.tier_expires_at,
        };
    }
    else {
        ctx.aqUser = { linked: false };
    }
    return next();
};
exports.loadUser = loadUser;
const requireLinked = async (ctx, next) => {
    if (!ctx.aqUser?.linked) {
        await ctx.reply(format_1.MSG.NOT_LINKED, { parse_mode: "HTML", ...(0, keyboard_1.unlinkedMenu)() });
        return;
    }
    return next();
};
exports.requireLinked = requireLinked;
//# sourceMappingURL=auth.js.map