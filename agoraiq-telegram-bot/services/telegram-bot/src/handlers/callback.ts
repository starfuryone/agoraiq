import { Markup } from "telegraf";
import { AgoraIQContext } from "../middleware/auth";
import { api } from "../utils/api";
import { MSG, formatSignalCard, formatProviderSummary, formatMonthlyBreakdown, formatAccountInfo } from "../utils/format";
import {
  mainMenu, unlinkedMenu, categoryMenu, signalsMenu,
  accountMenu, supportMenu, signalCardButtons, sourceListButtons, backToMain,
} from "../utils/keyboard";
import { checkRateLimit } from "../middleware/rateLimit";
import { handleLinkStart } from "./link";

export async function handleCallback(ctx: AgoraIQContext) {
  const cbData = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : null;
  if (!cbData) return;

  await ctx.answerCbQuery();

  const parts = cbData.split(":");
  const [action, sub, param, extra] = parts;
  const tgId = ctx.from!.id;

  // Navigation
  if (action === "menu" && sub === "main") {
    if (ctx.aqUser?.linked) {
      await ctx.editMessageText(MSG.WELCOME_BACK(ctx.aqUser.tier || "FREE"), { parse_mode: "HTML", ...mainMenu() });
    } else {
      await ctx.editMessageText(MSG.WELCOME, { parse_mode: "HTML", ...unlinkedMenu() });
    }
    return;
  }

  // Linking
  if (action === "link" && sub === "start") {
    await handleLinkStart(ctx);
    return;
  }

  if (action === "trial" && sub === "start") {
    await ctx.editMessageText(MSG.TRIAL_INFO, { parse_mode: "HTML", ...backToMain() });
    return;
  }

  // Guard: require linked
  if (!ctx.aqUser?.linked) {
    await ctx.editMessageText(MSG.NOT_LINKED, { parse_mode: "HTML", ...unlinkedMenu() });
    return;
  }

  // Sources
  if (action === "sources") {
    if (sub === "categories") {
      await ctx.editMessageText("\ud83d\udce1 <b>Browse Sources</b>\n\nSelect a category:", { parse_mode: "HTML", ...categoryMenu() });
      return;
    }
    if (sub === "list") {
      const category = param;
      const page = extra ? parseInt(extra) : 1;
      const { data: srcData, error } = await api.getSources(tgId, category, page);
      if (error || !srcData) {
        await ctx.editMessageText(MSG.ERROR, { parse_mode: "HTML", ...backToMain() });
        return;
      }
      const headers: Record<string, string> = {
        crypto_signals: "\ud83e\ude99 Crypto Signals",
        forex: "\ud83d\udcb1 Forex",
        news_intel: "\ud83d\udcf0 News & Intel",
        education: "\ud83c\udf93 Education",
        collections: "\u2b50 Premium Collections",
      };
      await ctx.editMessageText(`<b>${headers[category] || category}</b>  (${srcData.total} sources)`, {
        parse_mode: "HTML",
        ...sourceListButtons(srcData.sources, category, srcData.page, srcData.total, srcData.per_page),
      });
      return;
    }
    if (sub === "join") {
      const rl = checkRateLimit(`invite:${tgId}`, 5, 60 * 60 * 1000);
      if (!rl.allowed) {
        await ctx.editMessageText(MSG.RATE_LIMITED, { parse_mode: "HTML", ...backToMain() });
        return;
      }
      const { data: inv, error } = await api.requestInvite(tgId, param);
      if (error) {
        const msg = error.code === "RATE_LIMITED" ? MSG.RATE_LIMITED :
                    error.code === "SOURCE_LOCKED" ? MSG.SOURCE_LOCKED(error.message) :
                    `\u274c ${error.message}`;
        await ctx.editMessageText(msg, { parse_mode: "HTML", ...backToMain() });
        return;
      }
      if (inv) {
        const exp = new Date(inv.expires_at).toLocaleTimeString();
        await ctx.editMessageText(MSG.INVITE_SENT(inv.source_name, inv.invite_link, exp), { parse_mode: "HTML", ...backToMain() });
      }
      return;
    }
    if (sub === "locked") {
      await ctx.editMessageText(MSG.SOURCE_LOCKED("PRO"), { parse_mode: "HTML", ...backToMain() });
      return;
    }
  }

  // Signals
  if (action === "signals") {
    if (sub === "main") {
      await ctx.editMessageText("\ud83d\udcca <b>Signals & Proof</b>", { parse_mode: "HTML", ...signalsMenu() });
      return;
    }
    if (sub === "latest") {
      const { data: sigData } = await api.getLatestSignals(tgId);
      if (!sigData || !sigData.signals.length) {
        await ctx.editMessageText("No signals found.", { parse_mode: "HTML", ...signalsMenu() });
        return;
      }
      const first = sigData.signals[0];
      await ctx.editMessageText(formatSignalCard(first), {
        parse_mode: "HTML",
        ...signalCardButtons({ proof_url: first.proof_url, provider_id: first.provider_id, signal_id: first.signal_id }),
      });
      return;
    }
    if (sub === "search") {
      await ctx.editMessageText("\ud83d\udd0d Send a signal ID (e.g. <code>sig_20260303_001</code>) to look it up.", { parse_mode: "HTML", ...backToMain() });
      return;
    }
    if (sub === "followed") {
      await ctx.editMessageText("\u2b50 <b>Followed Providers</b>\n\nComing soon.", { parse_mode: "HTML", ...signalsMenu() });
      return;
    }
  }

  // Provider
  if (action === "provider") {
    if (sub === "summary" && param) {
      const { data: prov } = await api.getProviderSummary(param);
      if (!prov) { await ctx.editMessageText(MSG.ERROR, { parse_mode: "HTML", ...backToMain() }); return; }
      await ctx.editMessageText(formatProviderSummary(prov), { parse_mode: "HTML", ...backToMain() });
      return;
    }
    if (sub === "monthly" && param) {
      const { data: prov } = await api.getProviderSummary(param);
      if (!prov) { await ctx.editMessageText(MSG.ERROR, { parse_mode: "HTML", ...backToMain() }); return; }
      await ctx.editMessageText(formatMonthlyBreakdown(prov.name, prov.monthly_breakdown), { parse_mode: "HTML", ...backToMain() });
      return;
    }
  }

  // Account
  if (action === "account") {
    if (sub === "main") {
      await ctx.editMessageText("\ud83d\udc64 <b>My Account</b>", { parse_mode: "HTML", ...accountMenu() });
      return;
    }
    if (sub === "info") {
      const { data: me } = await api.getMe(tgId);
      if (!me || !me.linked) { await ctx.editMessageText(MSG.ERROR, { parse_mode: "HTML", ...backToMain() }); return; }
      await ctx.editMessageText(formatAccountInfo(me), { parse_mode: "HTML", ...accountMenu() });
      return;
    }
    if (sub === "subscription") {
      await ctx.editMessageText("\ud83d\udc8e Manage your subscription on the web:", {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.url("Manage Subscription", "https://app.agoraiq.net/billing")],
          [Markup.button.callback("\u25c0 Back", "account:main")],
        ]),
      });
      return;
    }
    if (sub === "notifications") {
      await ctx.editMessageText("\ud83d\udd14 Notification preferences coming soon.", { parse_mode: "HTML", ...accountMenu() });
      return;
    }
    if (sub === "referral") {
      const { data: me } = await api.getMe(tgId);
      const code = me?.referral_code || "N/A";
      const count = me?.referral_count || 0;
      await ctx.editMessageText(`\ud83d\udd17 <b>Your Referral Code</b>\n\n<code>${code}</code>\n\nReferrals: ${count}\nEach referral earns you 7 free days!`, { parse_mode: "HTML", ...accountMenu() });
      return;
    }
    if (sub === "unlink") {
      await ctx.editMessageText("\ud83d\udeaa To unlink your Telegram, visit Settings > Telegram on app.agoraiq.net", { parse_mode: "HTML", ...accountMenu() });
      return;
    }
  }

  // Support
  if (action === "support") {
    if (sub === "main") {
      await ctx.editMessageText("\ud83d\udcac <b>Support</b>", { parse_mode: "HTML", ...supportMenu() });
      return;
    }
    if (sub === "faq") {
      await ctx.editMessageText(
        "\u2753 <b>FAQ</b>\n\n\u2022 <b>How do I link?</b> Tap Link Account from the main menu.\n\u2022 <b>How do I join a source?</b> Go to Join Sources and pick a category.\n\u2022 <b>Billing?</b> Manage at app.agoraiq.net/billing\n\u2022 <b>Report a provider?</b> Use the Report option in Support.",
        { parse_mode: "HTML", ...supportMenu() }
      );
      return;
    }
    if (sub === "contact") {
      await ctx.editMessageText("\ud83d\udce9 Contact us at support@agoraiq.net or open a ticket at app.agoraiq.net/support", { parse_mode: "HTML", ...supportMenu() });
      return;
    }
    if (sub === "report") {
      await ctx.editMessageText("\u26a0\ufe0f To report a provider, visit app.agoraiq.net/report or email support@agoraiq.net with the provider name and details.", { parse_mode: "HTML", ...supportMenu() });
      return;
    }
  }
}
