import { AgoraIQContext } from "../middleware/auth";
import { mainMenu, unlinkedMenu } from "../utils/keyboard";
import { MSG } from "../utils/format";

export async function handleStart(ctx: AgoraIQContext) {
  if (ctx.aqUser?.linked) {
    const tier = ctx.aqUser.tier || "FREE";
    await ctx.reply(MSG.WELCOME_BACK(tier), { parse_mode: "HTML", ...mainMenu() });
  } else {
    await ctx.reply(MSG.WELCOME, { parse_mode: "HTML", ...unlinkedMenu() });
  }
}
