-- ═══════════════════════════════════════════════════════════════════════
-- AgoraIQ Market Intelligence — MarketStat Table Migration
-- Run this against your public schema
-- ═══════════════════════════════════════════════════════════════════════

-- ── MarketStat ────────────────────────────────────────────────────────────────
-- Time-bucketed market snapshots (bid/ask/spread/volume/scores)
-- One row per (exchange, pairId, bucket). Latest row = live snapshot.
CREATE TABLE IF NOT EXISTS market_stats (
  id              TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  exchange        TEXT        NOT NULL,
  "pairId"        TEXT        NOT NULL,
  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Price data
  bid             NUMERIC(30, 10),
  ask             NUMERIC(30, 10),
  last            NUMERIC(30, 10),

  -- Spread
  "spreadAbs"     NUMERIC(30, 10),
  "spreadBps"     NUMERIC(10, 4),   -- basis points

  -- Volume
  "volume24h"     NUMERIC(30, 4),
  "volume24hUsd"  NUMERIC(30, 2),

  -- Funding (perps only)
  "fundingRate"   NUMERIC(14, 8),

  -- Derived scores (0–100)
  "liquidityScore"   SMALLINT,
  "volatilityScore"  SMALLINT,

  -- Open interest (optional)
  "openInterest"  NUMERIC(30, 4),

  -- Latency of data fetch (ms)
  "fetchLatencyMs" INTEGER,

  CONSTRAINT market_stats_pkey PRIMARY KEY (id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
-- Primary access pattern: latest stat per (exchange, pairId)
CREATE INDEX IF NOT EXISTS idx_market_stats_exchange_pair_ts
  ON market_stats (exchange, "pairId", ts DESC);

-- For exchange-level queries (sync health panel)
CREATE INDEX IF NOT EXISTS idx_market_stats_exchange_ts
  ON market_stats (exchange, ts DESC);

-- For cross-exchange compare (base/quote lookup via join with market_pairs)
CREATE INDEX IF NOT EXISTS idx_market_stats_pairid
  ON market_stats ("pairId");

-- Partial index: only recent stats (last 48h) for fast snapshot queries
CREATE INDEX IF NOT EXISTS idx_market_stats_recent
  ON market_stats (exchange, "pairId", ts DESC)
  WHERE ts > NOW() - INTERVAL '48 hours';

-- ── Materialized view: latest snapshot per pair ───────────────────────────────
-- Refresh periodically (pg_cron or after each sync) for fast grid queries
CREATE MATERIALIZED VIEW IF NOT EXISTS market_stats_latest AS
  SELECT DISTINCT ON (exchange, "pairId")
    id, exchange, "pairId", ts,
    bid, ask, last,
    "spreadAbs", "spreadBps",
    "volume24h", "volume24hUsd",
    "fundingRate",
    "liquidityScore", "volatilityScore",
    "openInterest", "fetchLatencyMs"
  FROM market_stats
  ORDER BY exchange, "pairId", ts DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_stats_latest_pk
  ON market_stats_latest (exchange, "pairId");

CREATE INDEX IF NOT EXISTS idx_market_stats_latest_liq
  ON market_stats_latest ("liquidityScore" DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_market_stats_latest_vol
  ON market_stats_latest ("volume24h" DESC NULLS LAST);

-- ── Retention policy ──────────────────────────────────────────────────────────
-- Keep raw ticks for 7 days; run this daily via cron or pg_cron:
--
--   DELETE FROM market_stats WHERE ts < NOW() - INTERVAL '7 days';
--   REFRESH MATERIALIZED VIEW CONCURRENTLY market_stats_latest;
--
-- Or create a retention function:
CREATE OR REPLACE FUNCTION prune_market_stats(retention_days INT DEFAULT 7)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  deleted BIGINT;
BEGIN
  DELETE FROM market_stats
  WHERE ts < NOW() - (retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  REFRESH MATERIALIZED VIEW CONCURRENTLY market_stats_latest;
  RETURN deleted;
END;
$$;

-- ── Exchange metadata table ───────────────────────────────────────────────────
-- Scores and health for the Exchanges module
CREATE TABLE IF NOT EXISTS exchange_meta (
  exchange        TEXT        NOT NULL PRIMARY KEY,
  "displayName"   TEXT        NOT NULL,
  tier            SMALLINT    NOT NULL DEFAULT 2,  -- 1=top, 2=mid, 3=emerging
  region          TEXT,                             -- 'US', 'EU', 'GLOBAL', etc.
  "uptimeScore"   SMALLINT,                        -- 0–100
  "latencyScore"  SMALLINT,                        -- 0–100 (lower latency = higher score)
  "reliabilityScore" SMALLINT,                     -- 0–100
  "avgSpreadBps"  NUMERIC(8, 2),
  "spotCount"     INTEGER     DEFAULT 0,
  "futuresCount"  INTEGER     DEFAULT 0,
  "apiUptime24h"  NUMERIC(5, 2),                   -- % uptime last 24h
  "lastSyncLatencyMs" INTEGER,
  "websiteUrl"    TEXT,
  "logoUrl"       TEXT,
  "updatedAt"     TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT exchange_meta_tier_check CHECK (tier BETWEEN 1 AND 3)
);

-- Seed exchange metadata
INSERT INTO exchange_meta (exchange, "displayName", tier, region) VALUES
  ('BINANCE',   'Binance',       1, 'GLOBAL'),
  ('BYBIT',     'Bybit',         1, 'GLOBAL'),
  ('OKX',       'OKX',           1, 'GLOBAL'),
  ('KUCOIN',    'KuCoin',        1, 'GLOBAL'),
  ('KRAKEN',    'Kraken',        1, 'US/EU'),
  ('COINBASE',  'Coinbase',      1, 'US'),
  ('HTX',       'HTX',           1, 'GLOBAL'),
  ('BITFINEX',  'Bitfinex',      2, 'GLOBAL'),
  ('BINANCEUS', 'Binance.US',    2, 'US'),
  ('CRYPTOCOM', 'Crypto.com',    2, 'GLOBAL'),
  ('BINGX',     'BingX',         2, 'GLOBAL'),
  ('HITBTC',    'HitBTC',        2, 'GLOBAL'),
  ('BITMART',   'BitMart',       2, 'GLOBAL'),
  ('BITVAVO',   'Bitvavo',       2, 'EU'),
  ('EXMO',      'EXMO',          3, 'EU'),
  ('POLONIEX',  'Poloniex',      3, 'US')
ON CONFLICT (exchange) DO NOTHING;
