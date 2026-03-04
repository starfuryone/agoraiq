interface SignalData {
  signal_id: string;
  provider_name: string;
  pair: string;
  direction: string;
  entry: string;
  stop_loss: string;
  targets: string[];
  trust_score: number;
  status: string;
  pnl_percent?: string;
  duration?: string;
}

export function formatSignalCard(s: SignalData): string {
  const dir = s.direction === "LONG" ? "\ud83d\udfe2 LONG" : "\ud83d\udd34 SHORT";
  const targets = s.targets.map((t, i) => `  TP${i + 1}: ${t}`).join("\n");
  const trustBar = "\u2588".repeat(Math.round(s.trust_score / 10)) +
    "\u2591".repeat(10 - Math.round(s.trust_score / 10));

  const card = [
    `\ud83d\udce1 <b>${s.pair}</b> ${dir}`,
    `Provider: ${s.provider_name}`,
    `ID: <code>${s.signal_id}</code>`,
    ``,
    `Entry: ${s.entry}`,
    `Stop: ${s.stop_loss}`,
    `Targets:`,
    targets,
    ``,
    `Trust: [${trustBar}] ${s.trust_score}/100`,
    `Status: ${s.status.toUpperCase()}`,
  ];

  if (s.pnl_percent) card.push(`P&L: ${s.pnl_percent}`);
  if (s.duration) card.push(`Duration: ${s.duration}`);

  return card.join("\n");
}

export function formatProviderSummary(p: {
  name: string; trust_score: number; total_signals: number;
  win_rate: number; avg_pnl_percent: number; avg_duration: string;
}): string {
  return [
    `\ud83d\udcca <b>${p.name}</b>`,
    ``,
    `Trust Score: ${p.trust_score}/100`,
    `Total Signals: ${p.total_signals}`,
    `Win Rate: ${p.win_rate}%`,
    `Avg P&L: ${p.avg_pnl_percent > 0 ? "+" : ""}${p.avg_pnl_percent}%`,
    `Avg Duration: ${p.avg_duration}`,
  ].join("\n");
}

export function formatMonthlyBreakdown(
  name: string,
  months: Array<{ month: string; signals: number; win_rate: number; avg_pnl: number }>
): string {
  const header = `\ud83d\udcc5 <b>${name} - Monthly Breakdown</b>\n`;
  const rows = months.map((m) => {
    const pnl = m.avg_pnl > 0 ? `+${m.avg_pnl}%` : `${m.avg_pnl}%`;
    return `${m.month}: ${m.signals} signals | ${m.win_rate}% win | ${pnl} avg`;
  });
  return header + rows.join("\n");
}

export function formatAccountInfo(me: {
  tier?: string; tier_expires_at?: string; telegram_username?: string;
  linked_at?: string; referral_code?: string; referral_count?: number;
}): string {
  return [
    `\ud83d\udc64 <b>Account Info</b>`,
    ``,
    `Username: @${me.telegram_username || "N/A"}`,
    `Tier: ${me.tier || "FREE"}`,
    `Expires: ${me.tier_expires_at ? new Date(me.tier_expires_at).toLocaleDateString() : "N/A"}`,
    `Linked: ${me.linked_at ? new Date(me.linked_at).toLocaleDateString() : "N/A"}`,
    me.referral_code ? `Referral Code: <code>${me.referral_code}</code>` : "",
    me.referral_count !== undefined ? `Referrals: ${me.referral_count}` : "",
  ].filter(Boolean).join("\n");
}

export const MSG = {
  WELCOME: "Welcome to <b>AgoraIQ</b> \ud83d\ude80\n\nYour gateway to verified trading signals, proof tracking, and provider analytics.\n\nLink your account to get started.",
  WELCOME_BACK: (tier: string) => `Welcome back! You are on the <b>${tier}</b> plan.`,
  LINK_PROMPT: "Tap below to link your AgoraIQ account:",
  LINK_CODE: (url: string, exp: string) => `\ud83d\udd17 Open this link to connect your account:\n\n${url}\n\nThis link expires at ${exp}.`,
  NOT_LINKED: "\u26a0\ufe0f You need to link your AgoraIQ account first.",
  INVITE_SENT: (name: string, link: string, exp: string) => `\u2705 <b>${name}</b>\n\nJoin here: ${link}\n\nThis invite expires at ${exp}. Do not share it.`,
  SOURCE_LOCKED: (tier: string) => `\ud83d\udd12 This source requires the <b>${tier}</b> plan.\n\nUpgrade at app.agoraiq.net/pricing`,
  RATE_LIMITED: "\u23f3 Slow down! You have hit the rate limit. Try again in a few minutes.",
  ERROR: "\u274c Something went wrong. Please try again or contact support.",
  TRIAL_INFO: "\ud83c\udd93 Start a 7-day trial to explore all sources.\n\nSign up at app.agoraiq.net/pricing",
};
