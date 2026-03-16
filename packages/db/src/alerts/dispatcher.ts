// ─────────────────────────────────────────────────────────────
// packages/db/src/alerts/dispatcher.ts
// Alert Engine — consumes events from bus, evaluates rules,
// applies priority/dedup/scoring, dispatches notifications
// ─────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';
import { Redis }        from 'ioredis';
import type { AlertEvent, AlertPriority }  from './event-types';
import { eventToContext }                   from './event-types';
import { evaluateRule, legacyConditionsToAst, type RuleNode } from './dsl-engine';
import { classifyPriority, getPriorityRouting } from './priority';
import { computeAlertScore, recordEventForScoring, type AlertScore } from './alert-scorer';
import { checkDedup, recordAlertSent, mergeRuleCooldown, type DedupConfig } from './dedup';
import { isThrottled, type AlertChannels }  from './rule-engine';

// ── Delivery adapter interfaces ───────────────────────────────

export interface AlertDeliveryAdapters {
  telegram?: (userId: string, message: string) => Promise<void>;
  email?:    (userId: string, subject: string, html: string) => Promise<void>;
  discord?:  (webhookUrl: string, embed: object) => Promise<void>;
  webpush?:  (userId: string, payload: object) => Promise<void>;
  web?:      (userId: string, payload: object) => Promise<void>;
}

// ── Dispatch result for logging ───────────────────────────────

export interface DispatchResult {
  ruleId:     string;
  userId:     string;
  status:     'FIRED' | 'BLOCKED' | 'THROTTLED' | 'DEDUPED';
  priority:   AlertPriority;
  score?:     AlertScore;
  channels:   Record<string, string>;
  checks:     string[];
  failures:   string[];
}

// ── Main dispatcher ───────────────────────────────────────────

export class AlertDispatcher {
  private dedupConfig: DedupConfig = {
    cooldownSeconds: 600,
    maxPerHour:      30,
    criticalBypass:  true,
  };

  constructor(
    private readonly prisma:   PrismaClient,
    private readonly redis:    Redis,
    private readonly adapters: AlertDeliveryAdapters = {},
  ) {}

  // ── Process an event from the bus ───────────────────────────

  async processEvent(event: AlertEvent, workspaceId?: string): Promise<DispatchResult[]> {
    // Record event for scoring context (always, even if no rules match)
    await recordEventForScoring(this.redis, event).catch(console.error);

    // Load all active rules (optionally scoped by workspace)
    const where: any = { active: true };
    if (workspaceId) where.workspaceId = workspaceId;

    const rules = await this.prisma.alertRule.findMany({
      where,
      include: { user: { select: { id: true, email: true } } },
    });

    if (rules.length === 0) return [];

    // Classify event priority
    const priority = classifyPriority(event);

    // Compute smart alert score
    const score = await computeAlertScore(this.redis, event).catch(() => null);

    // Build evaluation context
    const ctx = eventToContext(event);
    // Inject scoring-derived fields for DSL access
    if (score) {
      ctx.alertStrength = score.strength;
      ctx.alertPriority = priority;
    }
    // Add numeric cherry-pick risk for legacy rules
    const riskMap: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
    ctx.cherryPickRiskNum = riskMap[ctx.cherryPickRisk] ?? 2;

    // Evaluate all rules in parallel
    const results = await Promise.allSettled(
      rules.map((rule: any) => this.evaluateAndFire(rule, event, ctx, priority, score)),
    );

    return results
      .filter((r: any) => r.status === 'fulfilled' && r.value !== null)
      .map((r: any) => r.value);
  }

  // ── Evaluate a single rule against the event ────────────────

  private async evaluateAndFire(
    rule:     any,
    event:    AlertEvent,
    ctx:      Record<string, any>,
    priority: AlertPriority,
    score:    AlertScore | null,
  ): Promise<DispatchResult | null> {
    const channels = rule.channels as AlertChannels;
    const userId   = rule.userId as string;
    const now      = new Date();

    // Determine if rule uses DSL expression or legacy conditions
    const ast = this.resolveRuleAst(rule);

    // Evaluate
    const evalResult = evaluateRule(ast, ctx);

    if (!evalResult.pass) {
      // Record BLOCKED
      await this.recordEvent(rule.id, userId, event, 'BLOCKED', priority, evalResult.checks, {}, score);
      await this.prisma.alertRule.update({
        where: { id: rule.id },
        data:  { blockedCount: { increment: 1 } },
      });
      return {
        ruleId: rule.id, userId, status: 'BLOCKED', priority,
        score: score ?? undefined, channels: {}, checks: evalResult.checks, failures: evalResult.failures,
      };
    }

    // Priority-based throttle override
    const routing = getPriorityRouting(priority);

    // Throttle check (bypassed for CRITICAL if routing says so)
    if (!routing.throttleOverride && isThrottled(rule.lastFiredAt, rule.throttleMin, now)) {
      await this.recordEvent(rule.id, userId, event, 'THROTTLED', priority, evalResult.checks, {}, score);
      return {
        ruleId: rule.id, userId, status: 'THROTTLED', priority,
        score: score ?? undefined, channels: {}, checks: evalResult.checks, failures: [],
      };
    }

    // Dedup check
    const dedupCfg = mergeRuleCooldown(this.dedupConfig, rule.throttleMin);
    const dedupResult = await checkDedup(this.redis, userId, rule.id, event, priority, dedupCfg);
    if (dedupResult.suppressed) {
      await this.recordEvent(rule.id, userId, event, 'THROTTLED', priority, evalResult.checks,
        { dedup: dedupResult.detail ?? dedupResult.reason ?? 'suppressed' }, score);
      return {
        ruleId: rule.id, userId, status: 'THROTTLED', priority,
        score: score ?? undefined, channels: {}, checks: evalResult.checks, failures: [],
      };
    }

    // ── Fire — fan out delivery ───────────────────────────────

    // Merge user channels with priority-forced channels
    const effectiveChannels = { ...channels };
    for (const ch of routing.forceChannels) {
      (effectiveChannels as any)[ch] = true;
    }

    const deliveryResults = await this.deliver(rule, event, effectiveChannels, priority, score);

    // Record sent for dedup
    await recordAlertSent(this.redis, userId, rule.id, event, dedupCfg).catch(console.error);

    await this.recordEvent(rule.id, userId, event, 'FIRED', priority, evalResult.checks, deliveryResults, score);
    await this.prisma.alertRule.update({
      where: { id: rule.id },
      data:  { firedCount: { increment: 1 }, lastFiredAt: now },
    });

    return {
      ruleId: rule.id, userId, status: 'FIRED', priority,
      score: score ?? undefined, channels: deliveryResults, checks: evalResult.checks, failures: [],
    };
  }

  // ── Resolve rule AST (DSL or legacy) ────────────────────────

  private resolveRuleAst(rule: any): RuleNode {
    const conditions = rule.conditions;

    // If rule has an 'expression' field, it's a DSL rule stored as AST
    if (conditions?.expression) {
      return conditions.expression as RuleNode;
    }

    // If rule has 'ast' field directly (pre-compiled DSL)
    if (conditions?.type) {
      return conditions as RuleNode;
    }

    // Legacy structured conditions → convert to AST
    return legacyConditionsToAst(conditions);
  }

  // ── Delivery fan-out ────────────────────────────────────────

  private async deliver(
    rule:     any,
    event:    AlertEvent,
    channels: AlertChannels,
    priority: AlertPriority,
    score:    AlertScore | null,
  ): Promise<Record<string, string>> {
    const userId = rule.userId as string;
    const results: Record<string, string> = {};
    const deliveries: Promise<void>[] = [];

    const message = formatAlertMessage(event, rule.name, priority, score);

    // Web (SSE push)
    if (channels.web && this.adapters.web) {
      deliveries.push(
        this.adapters.web(userId, {
          type:      'ALERT',
          category:  event.category,
          pair:      event.pair ?? event.asset,
          asset:     event.asset,
          ruleName:  rule.name,
          priority,
          score:     score?.strength,
          eventId:   event.id,
        })
          .then(()  => { results.web = 'sent'; })
          .catch(() => { results.web = 'failed'; }),
      );
    }

    // Telegram
    if (channels.telegram && this.adapters.telegram) {
      deliveries.push(
        this.adapters.telegram(userId, message.telegram)
          .then(()  => { results.telegram = 'sent'; })
          .catch(e  => { results.telegram = 'failed'; console.error('[dispatch] TG:', e.message); }),
      );
    }

    // Email
    if (channels.email && this.adapters.email) {
      deliveries.push(
        this.adapters.email(userId, message.subject, message.emailHtml)
          .then(()  => { results.email = 'sent'; })
          .catch(e  => { results.email = 'failed'; console.error('[dispatch] Email:', e.message); }),
      );
    }

    // Discord
    if (channels.discord && this.adapters.discord) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId }, select: { discordWebhookUrl: true } as any,
      });
      if ((user as any)?.discordWebhookUrl) {
        deliveries.push(
          this.adapters.discord((user as any).discordWebhookUrl, message.discordEmbed)
            .then(()  => { results.discord = 'sent'; })
            .catch(e  => { results.discord = 'failed'; console.error('[dispatch] Discord:', e.message); }),
        );
      }
    }

    // WebPush
    if (channels.webpush && this.adapters.webpush) {
      deliveries.push(
        this.adapters.webpush(userId, {
          title:   message.pushTitle,
          body:    message.pushBody,
          icon:    '/favicon.png',
          url:     `/alerts`,
          urgency: priority === 'CRITICAL' ? 'very-low' : undefined,
        })
          .then(()  => { results.webpush = 'sent'; })
          .catch(() => { results.webpush = 'failed'; }),
      );
    }

    await Promise.allSettled(deliveries);
    return results;
  }

  // ── Record event to DB ──────────────────────────────────────

  private async recordEvent(
    ruleId:            string,
    userId:            string,
    event:             AlertEvent,
    status:            string,
    priority:          AlertPriority,
    matchedConditions: string[],
    deliveryResults:   Record<string, string>,
    score:             AlertScore | null,
  ): Promise<void> {
    await this.prisma.alertEvent.create({
      data: {
        ruleId,
        userId,
        signalId: event.category === 'SIGNAL' ? (event as any).signalId : null,
        status:   status as any,
        matchedConditions,
        deliveryResults,
        priority,
        alertScore: score?.strength ?? null,
        category:   event.category,
      },
    });
  }
}

// ── Message formatters ────────────────────────────────────────

interface FormattedMessage {
  telegram:     string;
  subject:      string;
  emailHtml:    string;
  discordEmbed: object;
  pushTitle:    string;
  pushBody:     string;
}

function formatAlertMessage(
  event:    AlertEvent,
  ruleName: string,
  priority: AlertPriority,
  score:    AlertScore | null,
): FormattedMessage {
  const baseUrl  = process.env.APP_BASE_URL ?? 'https://app.agoraiq.net';
  const prioIcon = priority === 'CRITICAL' ? '🚨' : priority === 'HIGH' ? '🔴' : priority === 'MEDIUM' ? '🟡' : '🔵';
  const asset    = event.pair ?? event.asset;

  // Build detail line based on category
  let detail = '';
  switch (event.category) {
    case 'SIGNAL':
      detail = `${event.direction} · ${event.providerName} · IQ ${event.iqScore ?? '–'}`;
      break;
    case 'MARKET':
      detail = `${event.type} · ${event.priceChange > 0 ? '+' : ''}${event.priceChange.toFixed(1)}% · Vol ${event.volumeChange > 0 ? '+' : ''}${event.volumeChange.toFixed(0)}%`;
      break;
    case 'WHALE':
      detail = `${event.type} · $${(event.amountUsd / 1e6).toFixed(1)}M`;
      break;
    case 'LIQUIDATION':
      detail = `${event.type} · ${event.side} · $${(event.amountUsd / 1e6).toFixed(1)}M`;
      break;
    case 'PUMP':
      detail = `Vol ${event.volumeSpike.toFixed(1)}x · ${event.priceChange > 0 ? '+' : ''}${event.priceChange.toFixed(1)}%`;
      break;
  }

  const scoreStr = score ? `\nAlert Strength: ${score.strength}%` : '';

  // Telegram (HTML)
  const telegram = [
    `${prioIcon} <b>${priority} — ${asset}</b>  [${event.category}]`,
    ``,
    `Rule: <b>${ruleName}</b>`,
    detail,
    score ? `\n📊 <b>Alert Strength: ${score.strength}%</b>` : '',
    score ? score.factors.filter(f => f.score >= 0.6).map(f => `  ${f.name}: ${Math.round(f.score * 100)}%`).join('\n') : '',
    ``,
    `<a href="${baseUrl}/alerts">→ View in AgoraIQ</a>`,
  ].filter(Boolean).join('\n');

  // Email subject
  const subject = `${prioIcon} ${priority}: ${asset} ${event.category} — AgoraIQ`;

  // Discord embed
  const color = priority === 'CRITICAL' ? 0xef4444 : priority === 'HIGH' ? 0xf59e0b : priority === 'MEDIUM' ? 0x00d4ff : 0x4a5270;
  const discordEmbed = {
    embeds: [{
      title:       `${prioIcon} ${asset} — ${event.category}`,
      description: `**${ruleName}**\n${detail}`,
      color,
      fields: [
        { name: 'Priority', value: priority, inline: true },
        ...(score ? [{ name: 'Alert Strength', value: `${score.strength}%`, inline: true }] : []),
      ],
      timestamp: event.timestamp.toISOString(),
      footer:    { text: 'AgoraIQ Smart Alerts' },
    }],
  };

  // Push notification
  const pushTitle = `${prioIcon} ${priority}: ${asset}`;
  const pushBody  = `${detail}${score ? ` · Strength ${score.strength}%` : ''}`;

  // Email HTML
  const emailHtml = buildEmailHtml(event, ruleName, priority, score, detail, baseUrl);

  return { telegram, subject, emailHtml, discordEmbed, pushTitle, pushBody };
}

function buildEmailHtml(
  event:    AlertEvent,
  ruleName: string,
  priority: AlertPriority,
  score:    AlertScore | null,
  detail:   string,
  baseUrl:  string,
): string {
  const prioColor = priority === 'CRITICAL' ? '#ef4444' : priority === 'HIGH' ? '#f59e0b' : '#00d4ff';
  const asset     = event.pair ?? event.asset;

  const scoreHtml = score ? `
    <div style="margin-top:16px;background:#12151f;border-radius:6px;padding:14px;border:1px solid #1e2235">
      <div style="font-size:11px;color:#4a5270;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Alert Strength</div>
      <div style="font-size:28px;font-weight:800;color:#00d4ff">${score.strength}%</div>
      <div style="margin-top:8px;font-size:11px;color:#4a5270">
        ${score.factors.filter(f => f.score >= 0.5).map(f =>
          `${f.name}: <span style="color:#c8d0e8">${Math.round(f.score * 100)}%</span>`
        ).join(' · ')}
      </div>
    </div>
  ` : '';

  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#08090d;color:#c8d0e8;padding:32px;border-radius:12px">
      <div style="font-size:10px;color:${prioColor};font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">${priority} PRIORITY</div>
      <div style="font-size:22px;font-weight:800;color:#00d4ff">${asset}</div>
      <div style="font-size:13px;color:#4a5270;margin-top:4px">${ruleName} · ${event.category}</div>
      <div style="background:#0d0f16;border-radius:8px;padding:16px;border-left:3px solid ${prioColor};margin-top:20px">
        <div style="font-size:14px;color:#c8d0e8">${detail}</div>
      </div>
      ${scoreHtml}
      <a href="${baseUrl}/alerts" style="display:inline-block;margin-top:20px;background:#00d4ff;color:#08090d;font-weight:700;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:13px">View Alert →</a>
    </div>
  `;
}
