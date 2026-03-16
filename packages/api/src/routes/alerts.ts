// ─────────────────────────────────────────────────────────────
// packages/api/src/routes/alerts.ts
// Smart Alerts v2 routes — DSL rules, multi-category, priority, scoring
// Mount: app.use('/api/v1/alerts', authenticate, requireSubscription, alertsRouter)
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { parseExpression, evaluateRule, legacyConditionsToAst } from '@agoraiq/db';
import { eventToContext } from '@agoraiq/db';
import type { AlertEvent as AlertEventType } from '@agoraiq/db';

const router: ReturnType<typeof Router> = Router();

// ── Helpers ───────────────────────────────────────────────────

function getPrisma(req: Request) { return (req.app.locals as any).prisma; }
function getUserId(req: Request): string { return (req as any).user.userId; }
function getWorkspaceId(req: Request): string { return (req as any).user.workspaceId; }

// ── Zod schemas ───────────────────────────────────────────────

const CherryPickRiskSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
const DirectionSchema      = z.enum(['LONG', 'SHORT']);
const SessionSchema        = z.enum(['asia', 'london', 'ny_open', 'ny_close']);
const PrioritySchema       = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const CategorySchema       = z.enum(['SIGNAL', 'MARKET', 'WHALE', 'LIQUIDATION', 'PUMP']);

// Legacy structured conditions (backward compat)
const LegacyConditionsSchema = z.object({
  minIQScore:        z.number().int().min(0).max(100).optional(),
  minTruthPassRate:  z.number().int().min(0).max(100).optional(),
  minConfidence:     z.number().int().min(0).max(100).optional(),
  maxCherryPickRisk: CherryPickRiskSchema.optional(),
  pairs:             z.array(z.string().max(20)).max(50).optional(),
  providers:         z.array(z.string().max(50)).max(50).optional(),
  directions:        z.array(DirectionSchema).max(2).optional(),
  sessions:          z.array(SessionSchema).max(4).optional(),
  minRR:             z.number().min(0).max(100).optional(),
  maxLeverage:       z.number().int().min(0).max(200).optional(),
}).strict();

const AlertChannelsSchema = z.object({
  web:      z.boolean().optional(),
  telegram: z.boolean().optional(),
  email:    z.boolean().optional(),
  discord:  z.boolean().optional(),
  webpush:  z.boolean().optional(),
}).strict();

// Create rule — supports both legacy JSON and DSL expression
const CreateRuleSchema = z.discriminatedUnion('ruleFormat', [
  // Legacy format (structured JSON conditions)
  z.object({
    ruleFormat:   z.literal('legacy').default('legacy'),
    name:         z.string().min(1).max(100),
    conditions:   LegacyConditionsSchema,
    categories:   z.array(CategorySchema).min(1).max(5).default(['SIGNAL']),
    channels:     AlertChannelsSchema,
    minPriority:  PrioritySchema.default('LOW'),
    throttleMin:  z.number().int().min(1).max(1440).default(60),
  }),
  // DSL format (expression string, parsed to AST)
  z.object({
    ruleFormat:   z.literal('expression'),
    name:         z.string().min(1).max(100),
    expression:   z.string().min(1).max(1000),    // human-readable expression
    categories:   z.array(CategorySchema).min(1).max(5),
    channels:     AlertChannelsSchema,
    minPriority:  PrioritySchema.default('LOW'),
    throttleMin:  z.number().int().min(1).max(1440).default(60),
  }),
]);

const UpdateRuleSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  conditions:  z.any().optional(),        // validated separately based on ruleFormat
  expression:  z.string().max(1000).optional(),
  categories:  z.array(CategorySchema).min(1).max(5).optional(),
  channels:    AlertChannelsSchema.optional(),
  minPriority: PrioritySchema.optional(),
  throttleMin: z.number().int().min(1).max(1440).optional(),
  active:      z.boolean().optional(),
});

// ── POST /rules — create (supports legacy + DSL) ─────────────

router.post('/rules', async (req: Request, res: Response) => {
  const prisma      = getPrisma(req);
  const userId      = getUserId(req);
  const workspaceId = getWorkspaceId(req);

  const parsed = CreateRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid rule data', details: parsed.error.flatten() });
  }

  // Cap at 10 rules per user (20 for Elite)
  const count = await prisma.alertRule.count({ where: { userId } });
  if (count >= 20) {
    return res.status(429).json({ error: 'Max 20 alert rules per account' });
  }

  const data = parsed.data;
  let conditions: any;
  let ruleFormat: string;

  if (data.ruleFormat === 'expression') {
    // Parse DSL expression to AST
    try {
      const ast = parseExpression(data.expression);
      conditions = ast;
      ruleFormat = 'expression';
    } catch (err: any) {
      return res.status(400).json({ error: `Invalid expression: ${err.message}` });
    }
  } else {
    conditions = data.conditions;
    ruleFormat = 'legacy';
  }

  const rule = await prisma.alertRule.create({
    data: {
      userId,
      workspaceId,
      name:        data.name,
      ruleFormat,
      conditions,
      categories:  data.categories,
      channels:    data.channels,
      minPriority: data.minPriority,
      throttleMin: data.throttleMin,
    },
  });

  // Return the expression string alongside the rule for DSL rules
  res.status(201).json({
    rule,
    ...(data.ruleFormat === 'expression' ? { expressionSource: data.expression } : {}),
  });
});

// ── GET /rules ────────────────────────────────────────────────

router.get('/rules', async (req: Request, res: Response) => {
  const prisma = getPrisma(req);
  const userId = getUserId(req);

  const rules = await prisma.alertRule.findMany({
    where:   { userId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { events: true } } },
  });
  res.json({ rules });
});

// ── PATCH /rules/:id ──────────────────────────────────────────

router.patch('/rules/:id', async (req: Request, res: Response) => {
  const prisma = getPrisma(req);
  const userId = getUserId(req);
  const { id } = req.params;

  const existing = await prisma.alertRule.findFirst({ where: { id, userId } });
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  const parsed = UpdateRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid update', details: parsed.error.flatten() });
  }

  const update: any = { ...parsed.data };

  // If updating expression, re-parse to AST
  if (update.expression) {
    try {
      update.conditions = parseExpression(update.expression);
      update.ruleFormat = 'expression';
    } catch (err: any) {
      return res.status(400).json({ error: `Invalid expression: ${err.message}` });
    }
    delete update.expression;
  }

  const rule = await prisma.alertRule.update({ where: { id }, data: update });
  res.json({ rule });
});

// ── DELETE /rules/:id ─────────────────────────────────────────

router.delete('/rules/:id', async (req: Request, res: Response) => {
  const prisma = getPrisma(req);
  const userId = getUserId(req);
  const { id } = req.params;

  const existing = await prisma.alertRule.findFirst({ where: { id, userId } });
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  await prisma.alertRule.delete({ where: { id } });
  res.json({ ok: true });
});

// ── GET /feed ─────────────────────────────────────────────────
// ?date=YYYY-MM-DD  &status=  &category=  &priority=  &limit=

router.get('/feed', async (req: Request, res: Response) => {
  const prisma = getPrisma(req);
  const userId = getUserId(req);
  const { date, status, category, priority, limit = '50' } = req.query;

  const whereDate = date
    ? { gte: new Date(`${date}T00:00:00Z`), lte: new Date(`${date}T23:59:59Z`) }
    : undefined;

  const events = await prisma.alertEvent.findMany({
    where: {
      userId,
      ...(whereDate && { firedAt: whereDate }),
      ...(status   && { status:   status   as string }),
      ...(category && { category: category as string }),
      ...(priority && { priority: priority as string }),
    },
    orderBy: { firedAt: 'desc' },
    take:    Math.min(Number(limit) || 50, 200),
    include: { rule: { select: { name: true, channels: true, categories: true } } },
  });
  res.json({ events });
});

// ── GET /stats ────────────────────────────────────────────────
// ?window=7d|30d|90d  &category=SIGNAL|MARKET|...

router.get('/stats', async (req: Request, res: Response) => {
  const prisma   = getPrisma(req);
  const userId   = getUserId(req);
  const days     = req.query.window === '7d' ? 7 : req.query.window === '90d' ? 90 : 30;
  const since    = new Date(Date.now() - days * 86_400_000);
  const category = req.query.category as string | undefined;

  const baseWhere: any = {
    userId,
    firedAt: { gte: since },
    ...(category && { category }),
  };

  const [fired, blocked, throttled, activeRules] = await Promise.all([
    prisma.alertEvent.count({ where: { ...baseWhere, status: 'FIRED' } }),
    prisma.alertEvent.count({ where: { ...baseWhere, status: 'BLOCKED' } }),
    prisma.alertEvent.count({ where: { ...baseWhere, status: 'THROTTLED' } }),
    prisma.alertRule.count({ where: { userId, active: true } }),
  ]);

  // Average alert score for fired events
  const avgScore = await prisma.alertEvent.aggregate({
    where: { ...baseWhere, status: 'FIRED', alertScore: { not: null } },
    _avg:  { alertScore: true },
  });

  // Category breakdown
  const categoryBreakdown = await prisma.alertEvent.groupBy({
    by:    ['category'],
    where: baseWhere,
    _count: true,
  });

  // Priority breakdown
  const priorityBreakdown = await prisma.alertEvent.groupBy({
    by:    ['priority'],
    where: { ...baseWhere, status: 'FIRED' },
    _count: true,
  });

  const total          = fired + blocked + throttled;
  const noiseReduction = total > 0 ? Math.round(((blocked + throttled) / total) * 100) : 0;

  res.json({
    fired, blocked, throttled, total, noiseReduction, activeRules,
    avgAlertScore: Math.round(avgScore._avg.alertScore ?? 0),
    categoryBreakdown: Object.fromEntries(categoryBreakdown.map(c => [c.category, c._count])),
    priorityBreakdown: Object.fromEntries(priorityBreakdown.map(p => [p.priority, p._count])),
    window: `${days}d`,
  });
});

// ── POST /preview ─────────────────────────────────────────────
// Simulate rule against recent events

router.post('/preview', async (req: Request, res: Response) => {
  const { conditions, expression, ruleFormat = 'legacy', lookbackHours = 24 } = req.body;

  let ast: any;
  try {
    if (ruleFormat === 'expression' && expression) {
      ast = parseExpression(expression);
    } else if (conditions) {
      ast = legacyConditionsToAst(conditions);
    } else {
      return res.status(400).json({ error: 'conditions or expression required' });
    }
  } catch (err: any) {
    return res.status(400).json({ error: `Invalid rule: ${err.message}` });
  }

  const prisma = getPrisma(req);
  const since  = new Date(Date.now() - Number(lookbackHours) * 3_600_000);

  const signals = await prisma.signal.findMany({
    where:   { createdAt: { gte: since } },
    take:    200,
    orderBy: { createdAt: 'desc' },
    include: { provider: { select: { name: true } } },
  });

  // Fetch grades
  const signalIds = signals.map((s: any) => s.id);
  const grades = signalIds.length > 0
    ? await prisma.$queryRawUnsafe(
        `SELECT signal_id, iq_score, truth_pass_rate, cherry_pick_risk, min_r
         FROM signal_grades WHERE signal_id = ANY($1::text[])`,
        signalIds,
      ).catch(() => [])
    : [];
  const gradeMap = new Map((grades as any[]).map((g: any) => [g.signal_id, g]));

  let wouldFire = 0;
  const examples: object[] = [];

  for (const s of signals) {
    const g: any = gradeMap.get(s.id) ?? {};
    const ctx: Record<string, any> = {
      category:         'SIGNAL',
      asset:            s.pair?.split('/')[0] ?? '',
      pair:             s.pair,
      direction:        s.direction,
      providerId:       s.providerId,
      providerName:     s.provider?.name,
      iqScore:          g.iq_score        ?? 0,
      truthPassRate:    g.truth_pass_rate ?? 0,
      confidence:       s.confidence      ?? 0,
      cherryPickRisk:   g.cherry_pick_risk ?? 'HIGH',
      cherryPickRiskNum: ({ LOW: 0, MEDIUM: 1, HIGH: 2 } as any)[g.cherry_pick_risk ?? 'HIGH'] ?? 2,
      rRatio:           g.min_r           ?? s.rRatio ?? 0,
      leverage:         s.leverage        ?? 1,
      timestamp:        s.createdAt,
    };

    const result = evaluateRule(ast, ctx);
    if (result.pass) {
      wouldFire++;
      if (examples.length < 5) {
        examples.push({ pair: s.pair, direction: s.direction, checks: result.checks });
      }
    }
  }

  res.json({
    wouldFire,
    wouldBlock:    signals.length - wouldFire,
    totalSignals:  signals.length,
    fireRate:      signals.length ? Math.round((wouldFire / signals.length) * 100) : 0,
    lookbackHours,
    examples,
  });
});

// ── POST /validate-expression ─────────────────────────────────
// Validate a DSL expression string without creating a rule

router.post('/validate-expression', (req: Request, res: Response) => {
  const { expression } = req.body;
  if (!expression) return res.status(400).json({ error: 'expression required' });

  try {
    const ast = parseExpression(expression);
    res.json({ valid: true, ast });
  } catch (err: any) {
    res.json({ valid: false, error: err.message });
  }
});

// ── PATCH /:eventId/acknowledge ───────────────────────────────

router.patch('/:eventId/acknowledge', async (req: Request, res: Response) => {
  const prisma    = getPrisma(req);
  const userId    = getUserId(req);
  const { eventId } = req.params;

  await prisma.alertEvent.updateMany({
    where: { id: eventId, userId },
    data:  { acknowledgedAt: new Date() },
  });
  res.json({ acknowledged: true });
});

export default router;
