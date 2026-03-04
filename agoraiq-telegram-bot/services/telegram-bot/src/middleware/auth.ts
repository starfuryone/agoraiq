import { Context, MiddlewareFn } from "telegraf";
import { api } from "../utils/api";
import { unlinkedMenu } from "../utils/keyboard";
import { MSG } from "../utils/format";

export interface AgoraIQContext extends Context {
  aqUser?: {
    linked: boolean;
    userId?: string;
    tier?: string;
    tierExpiresAt?: string;
  };
}

export const loadUser: MiddlewareFn<AgoraIQContext> = async (ctx, next) => {
  const tgId = ctx.from?.id;
  if (!tgId) return next();

  const { data } = await api.getMe(tgId);
  if (data) {
    ctx.aqUser = {
      linked: data.linked,
      userId: data.user_id,
      tier: data.tier,
      tierExpiresAt: data.tier_expires_at,
    };
  } else {
    ctx.aqUser = { linked: false };
  }

  return next();
};

export const requireLinked: MiddlewareFn<AgoraIQContext> = async (ctx, next) => {
  if (!ctx.aqUser?.linked) {
    await ctx.reply(MSG.NOT_LINKED, { parse_mode: "HTML", ...unlinkedMenu() });
    return;
  }
  return next();
};
