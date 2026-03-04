import { Markup } from "telegraf";

export const unlinkedMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("\ud83d\udd17 Link Account", "link:start")],
    [Markup.button.callback("\ud83c\udd93 Start Trial", "trial:start")],
    [Markup.button.url("\ud83d\udc8e View Plans", "https://app.agoraiq.net/pricing")],
    [Markup.button.callback("\ud83d\udcac Get Help", "support:main")],
  ]);

export const mainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("\ud83d\udce1 Join Sources", "sources:categories")],
    [Markup.button.callback("\ud83d\udcca Signals & Proof", "signals:main")],
    [Markup.button.callback("\ud83d\udc64 My Account", "account:main")],
    [Markup.button.callback("\ud83d\udcac Support", "support:main")],
  ]);

export const categoryMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("\ud83e\ude99 Crypto Signals", "sources:list:crypto_signals")],
    [Markup.button.callback("\ud83d\udcb1 Forex", "sources:list:forex")],
    [Markup.button.callback("\ud83d\udcf0 News & Intel", "sources:list:news_intel")],
    [Markup.button.callback("\ud83c\udf93 Education", "sources:list:education")],
    [Markup.button.callback("\u2b50 Premium Collections", "sources:list:collections")],
    [Markup.button.callback("\u25c0 Back", "menu:main")],
  ]);

export const signalsMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("\ud83d\udccb Latest Signals", "signals:latest")],
    [Markup.button.callback("\ud83d\udd0d Search by ID", "signals:search")],
    [Markup.button.callback("\u2b50 Followed Providers", "signals:followed")],
    [Markup.button.callback("\u25c0 Back", "menu:main")],
  ]);

export const accountMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("\u2139\ufe0f Account Info", "account:info")],
    [Markup.button.callback("\ud83d\udc8e Subscription", "account:subscription")],
    [Markup.button.callback("\ud83d\udd14 Notifications", "account:notifications")],
    [Markup.button.callback("\ud83d\udd17 Referral Code", "account:referral")],
    [Markup.button.callback("\ud83d\udeaa Unlink Telegram", "account:unlink")],
    [Markup.button.callback("\u25c0 Back", "menu:main")],
  ]);

export const supportMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("\u2753 FAQ", "support:faq")],
    [Markup.button.callback("\ud83d\udce9 Contact Support", "support:contact")],
    [Markup.button.callback("\u26a0\ufe0f Report Provider", "support:report")],
    [Markup.button.callback("\u25c0 Back", "menu:main")],
  ]);

export const signalCardButtons = (signal: {
  proof_url: string;
  provider_id: string;
  signal_id: string;
}) =>
  Markup.inlineKeyboard([
    [Markup.button.url("\ud83d\udd0e View Proof", signal.proof_url)],
    [Markup.button.callback("\ud83d\udcc8 Provider Stats", `provider:summary:${signal.provider_id}`)],
    [Markup.button.callback("\ud83d\udcc5 Monthly Breakdown", `provider:monthly:${signal.provider_id}`)],
    [Markup.button.callback("\u23f1 Duration Analytics", `signal:duration:${signal.signal_id}`)],
    [Markup.button.callback("\u25c0 Back", "signals:main")],
  ]);

export const sourceListButtons = (
  sources: Array<{ id: string; name: string; locked: boolean; tier_min: string }>,
  category: string,
  page: number,
  total: number,
  perPage: number
) => {
  const rows = sources.map((s) => {
    if (s.locked) {
      return [Markup.button.callback(`\ud83d\udd12 ${s.name} (requires ${s.tier_min})`, `sources:locked:${s.id}`)];
    }
    return [Markup.button.callback(`\u2705 Join - ${s.name}`, `sources:join:${s.id}`)];
  });

  const nav: ReturnType<typeof Markup.button.callback>[] = [];
  if (page > 1) nav.push(Markup.button.callback("\u25c0 Prev", `sources:list:${category}:${page - 1}`));
  if (page * perPage < total) nav.push(Markup.button.callback("\u25b6 Next", `sources:list:${category}:${page + 1}`));
  if (nav.length) rows.push(nav);

  rows.push([Markup.button.callback("\u25c0 Back to Categories", "sources:categories")]);
  return Markup.inlineKeyboard(rows);
};

export const backToMain = () =>
  Markup.inlineKeyboard([[Markup.button.callback("\u25c0 Back", "menu:main")]]);
