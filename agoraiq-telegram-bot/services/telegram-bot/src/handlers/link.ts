import { AgoraIQContext } from "../middleware/auth";
import { api } from "../utils/api";
import { MSG } from "../utils/format";
import { mainMenu, backToMain } from "../utils/keyboard";
import { checkRateLimit } from "../middleware/rateLimit";

export async function handleLinkStart(ctx: AgoraIQContext) {
  const tgId = ctx.from?.id;
  if (!tgId) return;

  if (ctx.aqUser?.linked) {
    await ctx.reply("\u2705 Your account is already linked!", { parse_mode: "HTML", ...mainMenu() });
    return;
  }

  const rl = checkRateLimit(`link:${tgId}`, 3, 60 * 60 * 1000);
  if (!rl.allowed) {
    await ctx.reply(MSG.RATE_LIMITED, { parse_mode: "HTML" });
    return;
  }

  const { data, error } = await api.linkStart(tgId, ctx.from?.username);
  if (error) {
    await ctx.reply(MSG.ERROR, { parse_mode: "HTML" });
    return;
  }

  if (data) {
    const expiry = new Date(data.expires_at).toLocaleTimeString();
    await ctx.reply(MSG.LINK_CODE(data.link_url, expiry), { parse_mode: "HTML", ...backToMain() });
  }
}
