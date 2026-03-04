"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backToMain = exports.sourceListButtons = exports.signalCardButtons = exports.supportMenu = exports.accountMenu = exports.signalsMenu = exports.categoryMenu = exports.mainMenu = exports.unlinkedMenu = void 0;
const telegraf_1 = require("telegraf");
const unlinkedMenu = () => telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("\ud83d\udd17 Link Account", "link:start")],
    [telegraf_1.Markup.button.callback("\ud83c\udd93 Start Trial", "trial:start")],
    [telegraf_1.Markup.button.url("\ud83d\udc8e View Plans", "https://app.agoraiq.net/pricing")],
    [telegraf_1.Markup.button.callback("\ud83d\udcac Get Help", "support:main")],
]);
exports.unlinkedMenu = unlinkedMenu;
const mainMenu = () => telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("\ud83d\udce1 Join Sources", "sources:categories")],
    [telegraf_1.Markup.button.callback("\ud83d\udcca Signals & Proof", "signals:main")],
    [telegraf_1.Markup.button.callback("\ud83d\udc64 My Account", "account:main")],
    [telegraf_1.Markup.button.callback("\ud83d\udcac Support", "support:main")],
]);
exports.mainMenu = mainMenu;
const categoryMenu = () => telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("\ud83e\ude99 Crypto Signals", "sources:list:crypto_signals")],
    [telegraf_1.Markup.button.callback("\ud83d\udcb1 Forex", "sources:list:forex")],
    [telegraf_1.Markup.button.callback("\ud83d\udcf0 News & Intel", "sources:list:news_intel")],
    [telegraf_1.Markup.button.callback("\ud83c\udf93 Education", "sources:list:education")],
    [telegraf_1.Markup.button.callback("\u2b50 Premium Collections", "sources:list:collections")],
    [telegraf_1.Markup.button.callback("\u25c0 Back", "menu:main")],
]);
exports.categoryMenu = categoryMenu;
const signalsMenu = () => telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("\ud83d\udccb Latest Signals", "signals:latest")],
    [telegraf_1.Markup.button.callback("\ud83d\udd0d Search by ID", "signals:search")],
    [telegraf_1.Markup.button.callback("\u2b50 Followed Providers", "signals:followed")],
    [telegraf_1.Markup.button.callback("\u25c0 Back", "menu:main")],
]);
exports.signalsMenu = signalsMenu;
const accountMenu = () => telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("\u2139\ufe0f Account Info", "account:info")],
    [telegraf_1.Markup.button.callback("\ud83d\udc8e Subscription", "account:subscription")],
    [telegraf_1.Markup.button.callback("\ud83d\udd14 Notifications", "account:notifications")],
    [telegraf_1.Markup.button.callback("\ud83d\udd17 Referral Code", "account:referral")],
    [telegraf_1.Markup.button.callback("\ud83d\udeaa Unlink Telegram", "account:unlink")],
    [telegraf_1.Markup.button.callback("\u25c0 Back", "menu:main")],
]);
exports.accountMenu = accountMenu;
const supportMenu = () => telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.callback("\u2753 FAQ", "support:faq")],
    [telegraf_1.Markup.button.callback("\ud83d\udce9 Contact Support", "support:contact")],
    [telegraf_1.Markup.button.callback("\u26a0\ufe0f Report Provider", "support:report")],
    [telegraf_1.Markup.button.callback("\u25c0 Back", "menu:main")],
]);
exports.supportMenu = supportMenu;
const signalCardButtons = (signal) => telegraf_1.Markup.inlineKeyboard([
    [telegraf_1.Markup.button.url("\ud83d\udd0e View Proof", signal.proof_url)],
    [telegraf_1.Markup.button.callback("\ud83d\udcc8 Provider Stats", `provider:summary:${signal.provider_id}`)],
    [telegraf_1.Markup.button.callback("\ud83d\udcc5 Monthly Breakdown", `provider:monthly:${signal.provider_id}`)],
    [telegraf_1.Markup.button.callback("\u23f1 Duration Analytics", `signal:duration:${signal.signal_id}`)],
    [telegraf_1.Markup.button.callback("\u25c0 Back", "signals:main")],
]);
exports.signalCardButtons = signalCardButtons;
const sourceListButtons = (sources, category, page, total, perPage) => {
    const rows = sources.map((s) => {
        if (s.locked) {
            return [telegraf_1.Markup.button.callback(`\ud83d\udd12 ${s.name} (requires ${s.tier_min})`, `sources:locked:${s.id}`)];
        }
        return [telegraf_1.Markup.button.callback(`\u2705 Join - ${s.name}`, `sources:join:${s.id}`)];
    });
    const nav = [];
    if (page > 1)
        nav.push(telegraf_1.Markup.button.callback("\u25c0 Prev", `sources:list:${category}:${page - 1}`));
    if (page * perPage < total)
        nav.push(telegraf_1.Markup.button.callback("\u25b6 Next", `sources:list:${category}:${page + 1}`));
    if (nav.length)
        rows.push(nav);
    rows.push([telegraf_1.Markup.button.callback("\u25c0 Back to Categories", "sources:categories")]);
    return telegraf_1.Markup.inlineKeyboard(rows);
};
exports.sourceListButtons = sourceListButtons;
const backToMain = () => telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback("\u25c0 Back", "menu:main")]]);
exports.backToMain = backToMain;
//# sourceMappingURL=keyboard.js.map