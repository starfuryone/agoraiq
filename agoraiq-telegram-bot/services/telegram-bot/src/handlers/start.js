"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStart = handleStart;
const keyboard_1 = require("../utils/keyboard");
const format_1 = require("../utils/format");
async function handleStart(ctx) {
    if (ctx.aqUser?.linked) {
        const tier = ctx.aqUser.tier || "FREE";
        await ctx.reply(format_1.MSG.WELCOME_BACK(tier), { parse_mode: "HTML", ...(0, keyboard_1.mainMenu)() });
    }
    else {
        await ctx.reply(format_1.MSG.WELCOME, { parse_mode: "HTML", ...(0, keyboard_1.unlinkedMenu)() });
    }
}
//# sourceMappingURL=start.js.map