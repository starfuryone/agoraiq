"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleCallback = handleCallback;
const telegraf_1 = require("telegraf");
const api_1 = require("../utils/api");
const format_1 = require("../utils/format");
const keyboard_1 = require("../utils/keyboard");
const rateLimit_1 = require("../middleware/rateLimit");
const link_1 = require("./link");
async function handleCallback(ctx) {
    const cbData = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : null;
    if (!cbData)
        return;
    await ctx.answerCbQuery();
    const parts = cbData.split(":");
    const [action, sub, param, extra] = parts;
    const tgId = ctx.from.id;
    // Navigation
    if (action === "menu" && sub === "main") {
        if (ctx.aqUser?.linked) {
            await ctx.editMessageText(format_1.MSG.WELCOME_BACK(ctx.aqUser.tier || "FREE"), { parse_mode: "HTML", ...(0, keyboard_1.mainMenu)() });
        }
        else {
            await ctx.editMessageText(format_1.MSG.WELCOME, { parse_mode: "HTML", ...(0, keyboard_1.unlinkedMenu)() });
        }
        return;
    }
    // Linking
    if (action === "link" && sub === "start") {
        await (0, link_1.handleLinkStart)(ctx);
        return;
    }
    if (action === "trial" && sub === "start") {
        await ctx.editMessageText(format_1.MSG.TRIAL_INFO, { parse_mode: "HTML", ...(0, keyboard_1.backToMain)() });
        return;
    }
    // Guard: require linked
    if (!ctx.aqUser?.linked) {
        await ctx.editMessageText(format_1.MSG.NOT_LINKED, { parse_mode: "HTML", ...(0, keyboard_1.unlinkedMenu)() });
        return;
    }
    // Sources
    if (action === "sources") {
        if (sub === "categories") {
            await ctx.editMessageText("\ud83d\udce1 <b>Browse Sources</b>\n\nSelect a category:", { parse_mode: "HTML", ...(0, keyboard_1.categoryMenu)() });
            return;
        }
        if (sub === "list") {
            const category = param;
            const page = extra ? parseInt(extra) : 1;
            const { data: srcData, error } = await api_1.api.getSources(tgId, category, page);
            if (error || !srcData) {
                await ctx.editMessageText(format_1.MSG.ERROR, { parse_mode: "HTML", ...(0, keyboard_1.backToMain)() });
                return;
            }
            const headers = {
                crypto_signals: "\ud83e\ude99 Crypto Signals",
                forex: "\ud83d\udcb1 Forex",
                news_intel: "\ud83d\udcf0 News & Intel",
                education: "\ud83c\udf93 Education",
                collections: "\u2b50 Premium Collections",
            };
            await ctx.editMessageText(`<b>${headers[category] || category}</b>  (${srcData.total} sources)`, {
                parse_mode: "HTML",
                ...(0, keyboard_1.sourceListButtons)(srcData.sources, category, srcData.page, srcData.total, srcData.per_page),
            });
            return;
        }
        if (sub === "join") {
            const rl = (0, rateLimit_1.checkRateLimit)(`invite:${tgId}`, 5, 60 * 60 * 1000);
            if (!rl.allowed) {
                await ctx.editMessageText(format_1.MSG.RATE_LIMITED, { parse_mode: "HTML", ...(0, keyboard_1.backToMain)() });
                return;
            }
            const { data: inv, error } = await api_1.api.requestInvite(tgId, param);
            if (error) {
                const msg = error.code === "RATE_LIMITED" ? format_1.MSG.RATE_LIMITED :
                    error.code === "SOURCE_LOCKED" ? format_1.MSG.SOURCE_LOCKED(error.message) :
                        `\u274c ${error.message}`;
                await ctx.editMessageText(msg, { parse_mode: "HTML", ...(0, keyboard_1.backToMain)() });
                return;
            }
            if (inv) {
                const exp = new Date(inv.expires_at).toLocaleTimeString();
                await ctx.editMessageText(format_1.MSG.INVITE_SENT(inv.source_name, inv.invite_link, exp), { parse_mode: "HTML", ...(0, keyboard_1.backToMain)() });
            }
            return;
        }
        if (sub === "locked") {
            await ctx.editMessageText(format_1.MSG.SOURCE_LOCKED("PRO"), { parse_mode: "HTML", ...(0, keyboard_1.backToMain)() });
            return;
        }
    }
    // Signals
    if (action === "signals") {
        if (sub === "main") {
            await ctx.editMessageText("\ud83d\udcca <b>Signals & Proof</b>", { parse_mode: "HTML", ...(0, keyboard_1.signalsMenu)() });
            return;
        }
        if (sub === "latest") {
            const { data: sigData } = await api_1.api.getLatestSignals(tgId);
            if (!sigData || !sigData.signals.length) {
                await ctx.editMessageText("No signals found.", { parse_mode: "HTML", ...(0, keyboard_1.signalsMenu)() });
                return;
            }
            const first = sigData.signals[0];
            await ctx.editMessageText((0, format_1.formatSignalCard)(first), {
                parse_mode: "HTML",
                ...(0, keyboard_1.signalCardButtons)({ proof_url: first.proof_url, provider_id: first.provider_id, signal_id: first.signal_id }),
            });
            return;
        }
        if (sub === "search") {
            await ctx.editMessageText("\ud83d\udd0d Send a signal ID (e.g. <code>sig_20260303_001</code>) to look it up.", { parse_mode: "HTML", ...(0, keyboard_1.backToMain)() });
            return;
        }
        if (sub === "followed") {
            await ctx.editMessageText("\u2b50 <b>Followed Providers</b>\n\nComing soon.", { parse_mode: "HTML", ...(0, keyboard_1.signalsMenu)() });
            return;
        }
    }
    // Provider
    if (action === "provider") {
        if (sub === "summary" && param) {
            const { data: prov } = await api_1.api.getProviderSummary(param);
            if (!prov) {
                await ctx.editMessageText(format_1.MSG.ERROR, { parse_mode: "HTML", ...(0, keyboard_1.backToMain)() });
                return;
            }
            await ctx.editMessageText((0, format_1.formatProviderSummary)(prov), { parse_mode: "HTML", ...(0, keyboard_1.backToMain)() });
            return;
        }
        if (sub === "monthly" && param) {
            const { data: prov } = await api_1.api.getProviderSummary(param);
            if (!prov) {
                await ctx.editMessageText(format_1.MSG.ERROR, { parse_mode: "HTML", ...(0, keyboard_1.backToMain)() });
                return;
            }
            await ctx.editMessageText((0, format_1.formatMonthlyBreakdown)(prov.name, prov.monthly_breakdown), { parse_mode: "HTML", ...(0, keyboard_1.backToMain)() });
            return;
        }
    }
    // Account
    if (action === "account") {
        if (sub === "main") {
            await ctx.editMessageText("\ud83d\udc64 <b>My Account</b>", { parse_mode: "HTML", ...(0, keyboard_1.accountMenu)() });
            return;
        }
        if (sub === "info") {
            const { data: me } = await api_1.api.getMe(tgId);
            if (!me || !me.linked) {
                await ctx.editMessageText(format_1.MSG.ERROR, { parse_mode: "HTML", ...(0, keyboard_1.backToMain)() });
                return;
            }
            await ctx.editMessageText((0, format_1.formatAccountInfo)(me), { parse_mode: "HTML", ...(0, keyboard_1.accountMenu)() });
            return;
        }
        if (sub === "subscription") {
            await ctx.editMessageText("\ud83d\udc8e Manage your subscription on the web:", {
                parse_mode: "HTML",
                ...telegraf_1.Markup.inlineKeyboard([
                    [telegraf_1.Markup.button.url("Manage Subscription", "https://app.agoraiq.net/billing")],
                    [telegraf_1.Markup.button.callback("\u25c0 Back", "account:main")],
                ]),
            });
            return;
        }
        if (sub === "notifications") {
            await ctx.editMessageText("\ud83d\udd14 Notification preferences coming soon.", { parse_mode: "HTML", ...(0, keyboard_1.accountMenu)() });
            return;
        }
        if (sub === "referral") {
            const { data: me } = await api_1.api.getMe(tgId);
            const code = me?.referral_code || "N/A";
            const count = me?.referral_count || 0;
            await ctx.editMessageText(`\ud83d\udd17 <b>Your Referral Code</b>\n\n<code>${code}</code>\n\nReferrals: ${count}\nEach referral earns you 7 free days!`, { parse_mode: "HTML", ...(0, keyboard_1.accountMenu)() });
            return;
        }
        if (sub === "unlink") {
            await ctx.editMessageText("\ud83d\udeaa To unlink your Telegram, visit Settings > Telegram on app.agoraiq.net", { parse_mode: "HTML", ...(0, keyboard_1.accountMenu)() });
            return;
        }
    }
    // Support
    if (action === "support") {
        if (sub === "main") {
            await ctx.editMessageText("\ud83d\udcac <b>Support</b>", { parse_mode: "HTML", ...(0, keyboard_1.supportMenu)() });
            return;
        }
        if (sub === "faq") {
            await ctx.editMessageText("\u2753 <b>FAQ</b>\n\n\u2022 <b>How do I link?</b> Tap Link Account from the main menu.\n\u2022 <b>How do I join a source?</b> Go to Join Sources and pick a category.\n\u2022 <b>Billing?</b> Manage at app.agoraiq.net/billing\n\u2022 <b>Report a provider?</b> Use the Report option in Support.", { parse_mode: "HTML", ...(0, keyboard_1.supportMenu)() });
            return;
        }
        if (sub === "contact") {
            await ctx.editMessageText("\ud83d\udce9 Contact us at support@agoraiq.net or open a ticket at app.agoraiq.net/support", { parse_mode: "HTML", ...(0, keyboard_1.supportMenu)() });
            return;
        }
        if (sub === "report") {
            await ctx.editMessageText("\u26a0\ufe0f To report a provider, visit app.agoraiq.net/report or email support@agoraiq.net with the provider name and details.", { parse_mode: "HTML", ...(0, keyboard_1.supportMenu)() });
            return;
        }
    }
}
//# sourceMappingURL=callback.js.map