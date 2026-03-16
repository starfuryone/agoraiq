/**
 * @agoraiq/signal-engine — Persistence Layer (SQLite)
 *
 * Local analytics database using better-sqlite3.
 * Stores SignalAnalysis, StrategyExpectancy, and BacktestResults
 * independently of the main AgoraIQ Postgres DB.
 *
 * The engine still POSTs to the ingestion endpoint for the primary
 * pipeline. This DB is for the engine's own self-validation, learning
 * loop, and backtest history.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { config } from "../config";
import type {
  FinalSignal,
  SignalOutcome,
  StrategyExpectancy,
  SignalAnalysisRow,
  BacktestResultRow,
} from "../types";
import { logger } from "../services/logger";

// ─── Singleton ─────────────────────────────────────────────────────────────────

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = config.dbPath;
  mkdirSync(dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  initSchema(_db);
  logger.info(`SQLite database opened: ${dbPath}`);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ─── Schema ────────────────────────────────────────────────────────────────────

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS signal_analysis (
      id                    TEXT PRIMARY KEY,
      signal_id             TEXT UNIQUE NOT NULL,
      strategy_type         TEXT NOT NULL,
      regime                TEXT NOT NULL,
      symbol                TEXT NOT NULL,
      timeframe             TEXT NOT NULL,
      direction             TEXT NOT NULL,
      entry_low             REAL NOT NULL,
      entry_high            REAL NOT NULL,
      expected_r            REAL NOT NULL,
      technical_score       REAL NOT NULL,
      market_structure_score REAL NOT NULL,
      news_score            REAL NOT NULL,
      provider_score        REAL NOT NULL,
      risk_penalty          REAL NOT NULL,
      final_score           REAL NOT NULL,
      confidence            TEXT NOT NULL,
      reason_codes          TEXT NOT NULL,      -- JSON array
      risk_flags            TEXT NOT NULL,      -- JSON array
      ai_narrative          TEXT,
      ai_score_adjustment   REAL,
      ai_enabled            INTEGER NOT NULL DEFAULT 0,
      ai_model_version      TEXT,
      base_final_score      REAL NOT NULL,
      post_ai_final_score   REAL NOT NULL,
      ai_confidence         REAL,
      ai_reasoning_latency_ms INTEGER,
      outcome_label         TEXT,
      realized_r            REAL,
      mfe_pct               REAL,
      mae_pct               REAL,
      expires_at            TEXT NOT NULL,
      published_at          TEXT NOT NULL,
      resolved_at           TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sa_strategy ON signal_analysis(strategy_type);
    CREATE INDEX IF NOT EXISTS idx_sa_regime ON signal_analysis(regime);
    CREATE INDEX IF NOT EXISTS idx_sa_symbol ON signal_analysis(symbol);
    CREATE INDEX IF NOT EXISTS idx_sa_score ON signal_analysis(final_score);
    CREATE INDEX IF NOT EXISTS idx_sa_published ON signal_analysis(published_at);
    CREATE INDEX IF NOT EXISTS idx_sa_outcome ON signal_analysis(outcome_label);

    CREATE TABLE IF NOT EXISTS strategy_expectancy (
      id              TEXT PRIMARY KEY,
      strategy_type   TEXT NOT NULL,
      symbol          TEXT NOT NULL,
      timeframe       TEXT NOT NULL,
      regime          TEXT NOT NULL,
      win_rate        REAL NOT NULL,
      avg_r           REAL NOT NULL,
      sample_size     INTEGER NOT NULL,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(strategy_type, symbol, timeframe, regime)
    );

    CREATE INDEX IF NOT EXISTS idx_se_lookup ON strategy_expectancy(strategy_type, symbol, timeframe, regime);

    CREATE TABLE IF NOT EXISTS backtest_results (
      id                TEXT PRIMARY KEY,
      run_id            TEXT NOT NULL,
      symbol            TEXT NOT NULL,
      timeframe         TEXT NOT NULL,
      strategy_type     TEXT NOT NULL,
      direction         TEXT NOT NULL,
      regime            TEXT NOT NULL,
      confidence        TEXT NOT NULL,
      entry_price       REAL NOT NULL,
      exit_price        REAL NOT NULL,
      exit_reason       TEXT NOT NULL,
      realized_r        REAL NOT NULL,
      max_drawdown_pct  REAL NOT NULL,
      max_profit_pct    REAL NOT NULL,
      duration_bars     INTEGER NOT NULL,
      final_score       REAL NOT NULL,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_bt_run ON backtest_results(run_id);
    CREATE INDEX IF NOT EXISTS idx_bt_strategy ON backtest_results(strategy_type, symbol, timeframe);

    CREATE TABLE IF NOT EXISTS backtest_runs (
      run_id        TEXT PRIMARY KEY,
      symbol        TEXT NOT NULL,
      timeframe     TEXT NOT NULL,
      days          INTEGER NOT NULL,
      total_bars    INTEGER NOT NULL,
      signals_published INTEGER NOT NULL,
      wins          INTEGER NOT NULL,
      losses        INTEGER NOT NULL,
      partials      INTEGER NOT NULL,
      expired       INTEGER NOT NULL,
      win_rate      REAL NOT NULL,
      avg_r         REAL NOT NULL,
      profit_factor REAL NOT NULL,
      max_drawdown_pct REAL NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ─── Signal Analysis CRUD ──────────────────────────────────────────────────────

export interface AIAuditData {
  aiEnabled: boolean;
  aiModelVersion: string;
  baseFinalScore: number;
  postAiFinalScore: number;
  aiConfidence: number | null;
  aiReasoningLatencyMs: number | null;
}

export function insertSignalAnalysis(signal: FinalSignal, audit: AIAuditData): void {
  const db = getDb();
  const id = `sa_${signal.signalId}`;

  db.prepare(`
    INSERT OR REPLACE INTO signal_analysis (
      id, signal_id, strategy_type, regime, symbol, timeframe, direction,
      entry_low, entry_high, expected_r,
      technical_score, market_structure_score, news_score, provider_score,
      risk_penalty, final_score, confidence,
      reason_codes, risk_flags,
      ai_narrative, ai_score_adjustment,
      ai_enabled, ai_model_version,
      base_final_score, post_ai_final_score,
      ai_confidence, ai_reasoning_latency_ms,
      expires_at, published_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?,
      ?, ?
    )
  `).run(
    id, signal.signalId, signal.strategyType, signal.regime,
    signal.symbol, signal.timeframe, signal.direction,
    signal.entryLow, signal.entryHigh, signal.expectedR,
    signal.technicalScore, signal.marketStructureScore,
    signal.newsScore, signal.providerScore,
    signal.riskPenalty, signal.finalScore, signal.confidence,
    JSON.stringify(signal.reasonCodes), JSON.stringify(signal.riskFlags),
    signal.aiReasoning?.narrative ?? null,
    signal.aiReasoning?.scoreAdjustment ?? null,
    audit.aiEnabled ? 1 : 0,
    audit.aiModelVersion,
    audit.baseFinalScore,
    audit.postAiFinalScore,
    audit.aiConfidence,
    audit.aiReasoningLatencyMs,
    signal.expiresAt.toISOString(), signal.publishedAt.toISOString()
  );
}

export function updateSignalOutcome(outcome: SignalOutcome): void {
  const db = getDb();

  db.prepare(`
    UPDATE signal_analysis SET
      outcome_label = ?,
      realized_r = ?,
      mfe_pct = ?,
      mae_pct = ?,
      resolved_at = ?
    WHERE signal_id = ?
  `).run(
    outcome.outcomeLabel,
    outcome.realizedR,
    outcome.mfePct,
    outcome.maePct,
    new Date().toISOString(),
    outcome.signalId
  );
}

// ─── Strategy Expectancy ───────────────────────────────────────────────────────

export function getExpectancy(
  strategyType: string,
  symbol: string,
  timeframe: string,
  regime: string
): StrategyExpectancy | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT strategy_type, symbol, timeframe, regime, win_rate, avg_r, sample_size
    FROM strategy_expectancy
    WHERE strategy_type = ? AND symbol = ? AND timeframe = ? AND regime = ?
  `).get(strategyType, symbol, timeframe, regime) as any;

  if (!row) return null;

  return {
    strategyType: row.strategy_type,
    symbol: row.symbol,
    timeframe: row.timeframe,
    regime: row.regime,
    winRate: row.win_rate,
    avgR: row.avg_r,
    sampleSize: row.sample_size,
  };
}

export function upsertExpectancy(exp: StrategyExpectancy): void {
  const db = getDb();
  const id = `se_${exp.strategyType}_${exp.symbol}_${exp.timeframe}_${exp.regime}`;

  db.prepare(`
    INSERT INTO strategy_expectancy (id, strategy_type, symbol, timeframe, regime, win_rate, avg_r, sample_size, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(strategy_type, symbol, timeframe, regime)
    DO UPDATE SET
      win_rate = excluded.win_rate,
      avg_r = excluded.avg_r,
      sample_size = excluded.sample_size,
      updated_at = datetime('now')
  `).run(id, exp.strategyType, exp.symbol, exp.timeframe, exp.regime, exp.winRate, exp.avgR, exp.sampleSize);
}

// ─── Resolved signals for learning loop ────────────────────────────────────────

export function getResolvedSignals(lastDays = 30): SignalAnalysisRow[] {
  const db = getDb();
  const cutoff = new Date(Date.now() - lastDays * 24 * 60 * 60 * 1000).toISOString();

  return db.prepare(`
    SELECT * FROM signal_analysis
    WHERE outcome_label IS NOT NULL
      AND published_at > ?
    ORDER BY published_at DESC
  `).all(cutoff) as SignalAnalysisRow[];
}

// ─── Backtest Persistence ──────────────────────────────────────────────────────

export function insertBacktestRun(
  runId: string,
  meta: {
    symbol: string; timeframe: string; days: number;
    totalBars: number; signalsPublished: number;
    wins: number; losses: number; partials: number; expired: number;
    winRate: number; avgR: number; profitFactor: number; maxDrawdownPct: number;
  }
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO backtest_runs (
      run_id, symbol, timeframe, days, total_bars, signals_published,
      wins, losses, partials, expired,
      win_rate, avg_r, profit_factor, max_drawdown_pct
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId, meta.symbol, meta.timeframe, meta.days, meta.totalBars,
    meta.signalsPublished, meta.wins, meta.losses, meta.partials,
    meta.expired, meta.winRate, meta.avgR, meta.profitFactor, meta.maxDrawdownPct
  );
}

export function insertBacktestResult(row: BacktestResultRow): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO backtest_results (
      id, run_id, symbol, timeframe, strategy_type, direction, regime, confidence,
      entry_price, exit_price, exit_reason, realized_r,
      max_drawdown_pct, max_profit_pct, duration_bars, final_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.run_id, row.symbol, row.timeframe,
    row.strategy_type, row.direction, row.regime, row.confidence,
    row.entry_price, row.exit_price, row.exit_reason, row.realized_r,
    row.max_drawdown_pct, row.max_profit_pct, row.duration_bars, row.final_score
  );
}

export function getBacktestRuns(limit = 20): any[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM backtest_runs ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}
