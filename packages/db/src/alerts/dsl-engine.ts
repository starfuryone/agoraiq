// ─────────────────────────────────────────────────────────────
// packages/db/src/alerts/dsl-engine.ts
// Expression-based rule DSL for programmable alerts
//
// Supports:
//   Simple:    "iqScore >= 75"
//   Compound:  "iqScore >= 75 AND confidence > 60"
//   Nested:    "(price > 70000 OR volumeChange > 200) AND asset == 'BTC'"
//   Literals:  numbers, strings ('BTC'), booleans (true/false)
//   Operators: >, >=, <, <=, ==, !=, AND, OR, NOT
//   Functions: IN('BTC','ETH','SOL'), BETWEEN(50, 100)
//
// Rules are stored as JSON AST in the database, parsed from
// user-facing expression strings via parseExpression().
// ─────────────────────────────────────────────────────────────

// ── AST Node Types ────────────────────────────────────────────

export type RuleNode =
  | ComparisonNode
  | LogicalNode
  | NotNode
  | InNode
  | BetweenNode
  | CategoryNode
  | AlwaysTrueNode;

export interface ComparisonNode {
  type:     'comparison';
  field:    string;
  op:       '>' | '>=' | '<' | '<=' | '==' | '!=';
  value:    number | string | boolean;
}

export interface LogicalNode {
  type:     'logical';
  op:       'AND' | 'OR';
  left:     RuleNode;
  right:    RuleNode;
}

export interface NotNode {
  type:     'not';
  child:    RuleNode;
}

export interface InNode {
  type:     'in';
  field:    string;
  values:   (string | number)[];
}

export interface BetweenNode {
  type:     'between';
  field:    string;
  min:      number;
  max:      number;
}

export interface CategoryNode {
  type:       'category';
  categories: string[];
}

export interface AlwaysTrueNode {
  type:       'always_true';
}

// ── Evaluation Result ─────────────────────────────────────────

export interface DslEvalResult {
  pass:       boolean;
  checks:     string[];     // human-readable: "iqScore 91 >= 75 ✓"
  failures:   string[];     // only failed checks
}

// ── Evaluate an AST node against an event context ─────────────

export function evaluateRule(
  node: RuleNode,
  ctx: Record<string, any>,
): DslEvalResult {
  const checks: string[]   = [];
  const failures: string[] = [];

  function walk(n: RuleNode): boolean {
    switch (n.type) {
      case 'always_true':
        return true;

      case 'category': {
        const cat = ctx.category ?? '';
        const pass = n.categories.includes(cat);
        const label = `category ${cat} IN [${n.categories.join(',')}]`;
        checks.push(`${label} ${pass ? '✓' : '✗'}`);
        if (!pass) failures.push(`${label} ✗`);
        return pass;
      }

      case 'comparison': {
        const actual = resolveField(n.field, ctx);
        const pass   = compare(actual, n.op, n.value);
        const label  = `${n.field} ${fmt(actual)} ${n.op} ${fmt(n.value)}`;
        checks.push(`${label} ${pass ? '✓' : '✗'}`);
        if (!pass) failures.push(`${label} ✗`);
        return pass;
      }

      case 'in': {
        const actual = resolveField(n.field, ctx);
        const pass   = n.values.includes(actual);
        const label  = `${n.field} ${fmt(actual)} IN [${n.values.map(fmt).join(',')}]`;
        checks.push(`${label} ${pass ? '✓' : '✗'}`);
        if (!pass) failures.push(`${label} ✗`);
        return pass;
      }

      case 'between': {
        const actual = Number(resolveField(n.field, ctx)) || 0;
        const pass   = actual >= n.min && actual <= n.max;
        const label  = `${n.field} ${actual} BETWEEN ${n.min}..${n.max}`;
        checks.push(`${label} ${pass ? '✓' : '✗'}`);
        if (!pass) failures.push(`${label} ✗`);
        return pass;
      }

      case 'logical': {
        const leftResult  = walk(n.left);
        const rightResult = walk(n.right);
        return n.op === 'AND' ? leftResult && rightResult : leftResult || rightResult;
      }

      case 'not':
        return !walk(n.child);
    }
  }

  const pass = walk(node);
  return { pass, checks, failures };
}

// ── Field resolver (supports dot notation) ────────────────────

function resolveField(field: string, ctx: Record<string, any>): any {
  const parts = field.split('.');
  let val: any = ctx;
  for (const p of parts) {
    if (val == null) return undefined;
    val = val[p];
  }
  return val;
}

function compare(actual: any, op: string, expected: any): boolean {
  // Coerce for numeric comparisons
  const a = typeof expected === 'number' ? Number(actual) : actual;
  const b = expected;

  switch (op) {
    case '>':  return a > b;
    case '>=': return a >= b;
    case '<':  return a < b;
    case '<=': return a <= b;
    case '==': return a == b;  // loose equality for string/number flexibility
    case '!=': return a != b;
    default:   return false;
  }
}

function fmt(v: any): string {
  if (typeof v === 'string') return `'${v}'`;
  if (v === undefined || v === null) return 'null';
  return String(v);
}

// ─────────────────────────────────────────────────────────────
// Expression Parser
// Converts user-facing strings into AST nodes
// ─────────────────────────────────────────────────────────────

type Token = {
  type:  'field' | 'op' | 'value' | 'logical' | 'not' | 'lparen' | 'rparen' | 'comma' | 'fn';
  value: string;
};

const OP_PATTERN    = /^(>=|<=|!=|==|>|<)/;
const NUM_PATTERN   = /^-?[\d.]+[MmKk]?/;
const STR_PATTERN   = /^'([^']*)'/;
const BOOL_PATTERN  = /^(true|false)\b/i;
const FIELD_PATTERN = /^[a-zA-Z_][\w.]*/;
const LOGICAL       = /^(AND|OR)\b/i;
const NOT_PATTERN   = /^NOT\b/i;
const FN_PATTERN    = /^(IN|BETWEEN)\b/i;

export function parseExpression(expr: string): RuleNode {
  const tokens = tokenize(expr);
  let pos = 0;

  function peek(): Token | undefined { return tokens[pos]; }
  function consume(): Token { return tokens[pos++]; }
  function expect(type: string): Token {
    const t = consume();
    if (!t || t.type !== type) throw new Error(`Expected ${type} at position ${pos - 1}, got ${t?.type ?? 'EOF'}`);
    return t;
  }

  function parseOr(): RuleNode {
    let left = parseAnd();
    while (peek()?.type === 'logical' && peek()!.value.toUpperCase() === 'OR') {
      consume();
      const right = parseAnd();
      left = { type: 'logical', op: 'OR', left, right };
    }
    return left;
  }

  function parseAnd(): RuleNode {
    let left = parseUnary();
    while (peek()?.type === 'logical' && peek()!.value.toUpperCase() === 'AND') {
      consume();
      const right = parseUnary();
      left = { type: 'logical', op: 'AND', left, right };
    }
    return left;
  }

  function parseUnary(): RuleNode {
    if (peek()?.type === 'not') {
      consume();
      return { type: 'not', child: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): RuleNode {
    // Parenthesized expression
    if (peek()?.type === 'lparen') {
      consume();
      const node = parseOr();
      expect('rparen');
      return node;
    }

    // Function call: IN('BTC','ETH') or BETWEEN(50, 100)
    if (peek()?.type === 'fn') {
      const fn = consume().value.toUpperCase();
      // Need the preceding field — backtrack
      throw new Error(`Function ${fn} must follow a field name`);
    }

    // Field-based expression
    if (peek()?.type === 'field') {
      const field = consume().value;

      // Check for function: field IN(...) or field BETWEEN(...)
      if (peek()?.type === 'fn') {
        const fn = consume().value.toUpperCase();
        expect('lparen');

        if (fn === 'IN') {
          const values: (string | number)[] = [];
          while (peek()?.type === 'value') {
            values.push(parseValue(consume().value) as string | number);
            if (peek()?.type === 'comma') consume();
          }
          expect('rparen');
          return { type: 'in', field, values };
        }

        if (fn === 'BETWEEN') {
          const min = parseNumericValue(expect('value').value);
          expect('comma');
          const max = parseNumericValue(expect('value').value);
          expect('rparen');
          return { type: 'between', field, min, max };
        }
      }

      // Standard comparison: field op value
      const op = expect('op').value as ComparisonNode['op'];
      const val = parseValue(expect('value').value);
      return { type: 'comparison', field, op, value: val };
    }

    throw new Error(`Unexpected token at position ${pos}: ${peek()?.value ?? 'EOF'}`);
  }

  const ast = parseOr();
  if (pos < tokens.length) {
    throw new Error(`Unexpected token after expression: ${tokens[pos].value}`);
  }
  return ast;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let s = expr.trim();

  while (s.length > 0) {
    s = s.trimStart();
    if (s.length === 0) break;

    let match: RegExpMatchArray | null;

    if (s[0] === '(')      { tokens.push({ type: 'lparen', value: '(' });   s = s.slice(1); continue; }
    if (s[0] === ')')      { tokens.push({ type: 'rparen', value: ')' });   s = s.slice(1); continue; }
    if (s[0] === ',')      { tokens.push({ type: 'comma',  value: ',' });   s = s.slice(1); continue; }

    if ((match = s.match(NOT_PATTERN)))    { tokens.push({ type: 'not',     value: match[0] }); s = s.slice(match[0].length); continue; }
    if ((match = s.match(LOGICAL)))        { tokens.push({ type: 'logical', value: match[0] }); s = s.slice(match[0].length); continue; }
    if ((match = s.match(FN_PATTERN)))     { tokens.push({ type: 'fn',      value: match[0] }); s = s.slice(match[0].length); continue; }
    if ((match = s.match(OP_PATTERN)))     { tokens.push({ type: 'op',      value: match[0] }); s = s.slice(match[0].length); continue; }
    if ((match = s.match(STR_PATTERN)))    { tokens.push({ type: 'value',   value: `'${match[1]}'` }); s = s.slice(match[0].length); continue; }
    if ((match = s.match(BOOL_PATTERN)))   { tokens.push({ type: 'value',   value: match[0] }); s = s.slice(match[0].length); continue; }
    if ((match = s.match(NUM_PATTERN)))    { tokens.push({ type: 'value',   value: match[0] }); s = s.slice(match[0].length); continue; }
    if ((match = s.match(FIELD_PATTERN)))  { tokens.push({ type: 'field',   value: match[0] }); s = s.slice(match[0].length); continue; }

    throw new Error(`Unexpected character in expression: "${s[0]}" near "${s.slice(0, 20)}"`);
  }

  return tokens;
}

function parseValue(raw: string): string | number | boolean {
  // String literal: 'BTC'
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
  // Boolean
  if (raw.toLowerCase() === 'true')  return true;
  if (raw.toLowerCase() === 'false') return false;
  // Number with suffix: 50M, 200K
  return parseNumericValue(raw);
}

function parseNumericValue(raw: string): number {
  const suffix = raw.slice(-1).toUpperCase();
  if (suffix === 'M') return parseFloat(raw.slice(0, -1)) * 1_000_000;
  if (suffix === 'K') return parseFloat(raw.slice(0, -1)) * 1_000;
  return parseFloat(raw);
}

// ─────────────────────────────────────────────────────────────
// Convenience: build AST from structured conditions (backward compat)
// Converts the existing AlertConditions object into a DSL AST
// so both old and new rule formats use the same evaluator
// ─────────────────────────────────────────────────────────────

export interface LegacyConditions {
  minIQScore?:        number;
  minTruthPassRate?:  number;
  minConfidence?:     number;
  maxCherryPickRisk?: string;
  pairs?:             string[];
  providers?:         string[];
  directions?:        string[];
  sessions?:          string[];
  minRR?:             number;
  maxLeverage?:       number;
}

const RISK_ORDER: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export function legacyConditionsToAst(conditions: LegacyConditions): RuleNode {
  const nodes: RuleNode[] = [];

  // Category filter: only SIGNAL events for legacy rules
  nodes.push({ type: 'category', categories: ['SIGNAL'] });

  if (conditions.minIQScore != null && conditions.minIQScore > 0) {
    nodes.push({ type: 'comparison', field: 'iqScore', op: '>=', value: conditions.minIQScore });
  }
  if (conditions.minTruthPassRate != null && conditions.minTruthPassRate > 0) {
    nodes.push({ type: 'comparison', field: 'truthPassRate', op: '>=', value: conditions.minTruthPassRate });
  }
  if (conditions.minConfidence != null && conditions.minConfidence > 0) {
    nodes.push({ type: 'comparison', field: 'confidence', op: '>=', value: conditions.minConfidence });
  }
  if (conditions.maxCherryPickRisk && conditions.maxCherryPickRisk !== 'HIGH') {
    // Convert risk cap to numeric: "MEDIUM" → cherryPickRiskNum <= 1
    const maxRiskNum = RISK_ORDER[conditions.maxCherryPickRisk] ?? 2;
    nodes.push({ type: 'comparison', field: 'cherryPickRiskNum', op: '<=', value: maxRiskNum });
  }
  if (conditions.minRR != null && conditions.minRR > 0) {
    nodes.push({ type: 'comparison', field: 'rRatio', op: '>=', value: conditions.minRR });
  }
  if (conditions.maxLeverage != null && conditions.maxLeverage > 0) {
    nodes.push({ type: 'comparison', field: 'leverage', op: '<=', value: conditions.maxLeverage });
  }
  if (conditions.pairs && conditions.pairs.length > 0) {
    nodes.push({ type: 'in', field: 'pair', values: conditions.pairs });
  }
  if (conditions.providers && conditions.providers.length > 0) {
    nodes.push({ type: 'in', field: 'providerId', values: conditions.providers });
  }
  if (conditions.directions && conditions.directions.length > 0) {
    nodes.push({ type: 'in', field: 'direction', values: conditions.directions });
  }

  if (nodes.length === 0) return { type: 'always_true' };
  if (nodes.length === 1) return nodes[0];

  // AND all conditions together
  return nodes.reduce((acc, node) => ({
    type: 'logical',
    op:   'AND',
    left:  acc,
    right: node,
  } as LogicalNode));
}
