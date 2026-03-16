-- ============================================================
-- AgoraIQ Market Intel — DB Migration
-- File: migrations/YYYYMMDDHHMMSS_add_market_intel_tables.sql
--
-- Run via: prisma migrate dev --name add_market_intel_tables
-- OR apply directly to your Postgres instance.
-- ============================================================

-- ── market_intel_scores ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_intel_scores (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          VARCHAR(20)  NOT NULL,
  side            VARCHAR(5)   NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  score           NUMERIC(6,4) NOT NULL,
  "probabilityPct" SMALLINT     NOT NULL,
  confidence      VARCHAR(4)   NOT NULL CHECK (confidence IN ('HIGH', 'MED', 'LOW')),
  "expectedR"     NUMERIC(5,2) NOT NULL,
  "rawInputs"     JSONB        NOT NULL DEFAULT '{}',
  "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mis_symbol
  ON market_intel_scores (symbol);

CREATE INDEX IF NOT EXISTS idx_mis_created_at
  ON market_intel_scores ("createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_mis_score
  ON market_intel_scores (score DESC);

CREATE INDEX IF NOT EXISTS idx_mis_symbol_created
  ON market_intel_scores (symbol, "createdAt" DESC);

-- ── market_intel_alerts ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_intel_alerts (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  type        VARCHAR(15)  NOT NULL CHECK (type IN ('volatility', 'arbitrage', 'regime')),
  severity    VARCHAR(10)  NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  symbol      VARCHAR(20)  NOT NULL,
  exchange    VARCHAR(60),
  message     TEXT         NOT NULL,
  metadata    JSONB        NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mia_type
  ON market_intel_alerts (type);

CREATE INDEX IF NOT EXISTS idx_mia_symbol
  ON market_intel_alerts (symbol);

CREATE INDEX IF NOT EXISTS idx_mia_created_at
  ON market_intel_alerts ("createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_mia_severity
  ON market_intel_alerts (severity);

CREATE INDEX IF NOT EXISTS idx_mia_type_created
  ON market_intel_alerts (type, "createdAt" DESC);

-- ── market_intel_snapshots ────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_intel_snapshots (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol           VARCHAR(20) NOT NULL,
  exchange         VARCHAR(20) NOT NULL,
  "rawData"        JSONB       NOT NULL DEFAULT '{}',
  "normalizedData" JSONB       NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_misnap_symbol_exchange_time
  ON market_intel_snapshots (symbol, exchange, "createdAt");

CREATE INDEX IF NOT EXISTS idx_misnap_symbol
  ON market_intel_snapshots (symbol);

CREATE INDEX IF NOT EXISTS idx_misnap_exchange
  ON market_intel_snapshots (exchange);

CREATE INDEX IF NOT EXISTS idx_misnap_created_at
  ON market_intel_snapshots ("createdAt" DESC);

-- ── Auto-cleanup: keep last 30 days only (optional cron or rule) ──
-- Consider adding a pg_cron job or application-level cleanup:
-- DELETE FROM market_intel_scores    WHERE "createdAt" < NOW() - INTERVAL '30 days';
-- DELETE FROM market_intel_alerts    WHERE "createdAt" < NOW() - INTERVAL '30 days';
-- DELETE FROM market_intel_snapshots WHERE "createdAt" < NOW() - INTERVAL '7 days';
