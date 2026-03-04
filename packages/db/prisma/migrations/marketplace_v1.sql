-- ═══════════════════════════════════════════════════════════════
-- Marketplace Migration — Extends existing schema
-- Run with: psql -U agoraiq -d agoraiq -f marketplace_v1.sql
-- ═══════════════════════════════════════════════════════════════

-- ── Extend providers table ───────────────────────────────────
-- (slug, name, description, isActive already exist)

ALTER TABLE providers ADD COLUMN IF NOT EXISTS marketplace_visible BOOLEAN DEFAULT false;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS tracked_since TIMESTAMPTZ;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS market_type VARCHAR(30);      -- Spot | Futures
ALTER TABLE providers ADD COLUMN IF NOT EXISTS trading_style VARCHAR(30);    -- Scalp | Intraday | Swing
ALTER TABLE providers ADD COLUMN IF NOT EXISTS leverage_band VARCHAR(20);    -- 1-3x | 3-10x | 10x+
ALTER TABLE providers ADD COLUMN IF NOT EXISTS exchange_focus VARCHAR(30);   -- Binance | Bybit | etc
ALTER TABLE providers ADD COLUMN IF NOT EXISTS subscriber_count INT DEFAULT 0;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'EN';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS channel_type VARCHAR(20) DEFAULT 'telegram';

CREATE INDEX IF NOT EXISTS idx_providers_marketplace
  ON providers (marketplace_visible) WHERE marketplace_visible = true;


-- ── Extend signals table ─────────────────────────────────────

ALTER TABLE signals ADD COLUMN IF NOT EXISTS original_hash VARCHAR(64);
ALTER TABLE signals ADD COLUMN IF NOT EXISTS is_executable BOOLEAN DEFAULT true;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS was_edited BOOLEAN DEFAULT false;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS was_deleted BOOLEAN DEFAULT false;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS edit_count INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_signals_hash ON signals (original_hash)
  WHERE original_hash IS NOT NULL;


-- ── Signal audit events (edit/delete tracking) ───────────────

CREATE TABLE IF NOT EXISTS signal_audit_events (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider_id   TEXT NOT NULL REFERENCES providers(id),
  signal_id     TEXT REFERENCES signals(id),
  event_type    VARCHAR(20) NOT NULL,     -- EDIT | DELETE
  event_data    JSONB,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT valid_event_type CHECK (event_type IN ('EDIT', 'DELETE'))
);

CREATE INDEX IF NOT EXISTS idx_audit_provider_time
  ON signal_audit_events (provider_id, detected_at DESC);


-- ── Provider stats snapshot (pre-computed by cron) ───────────

CREATE TABLE IF NOT EXISTS provider_stats_snapshot (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider_id      TEXT NOT NULL REFERENCES providers(id),
  period           VARCHAR(10) NOT NULL,   -- 7d | 30d | 90d | all

  -- Performance (computed from trades table)
  win_rate         FLOAT,
  expectancy_r     FLOAT,
  vol_adj_expectancy FLOAT,               -- E(R) / σ(R), NULL if N<5
  r_stddev         FLOAT,                 -- population σ of all R-multiples
  max_drawdown_pct FLOAT,
  trade_count      INT DEFAULT 0,
  profit_factor    FLOAT,
  sample_confidence VARCHAR(15),           -- high | moderate | low | unreliable

  -- Data completeness (= lifecycle grade source)
  data_completeness FLOAT,                -- full_cycle_rate
  pct_with_entry   FLOAT,
  pct_with_sl      FLOAT,
  pct_with_tp      FLOAT,
  pct_with_outcome FLOAT,
  pct_full_cycle   FLOAT,                 -- = data_completeness (same value)

  -- Cherry-pick (Bayesian damped)
  cherry_pick_score FLOAT,
  cherry_delete_rate FLOAT,
  cherry_edit_rate  FLOAT,
  cherry_unresolved_rate FLOAT,
  cherry_announce_ratio FLOAT,
  cherry_confidence FLOAT,                -- damping factor

  computed_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE (provider_id, period)
);

CREATE INDEX IF NOT EXISTS idx_stats_vol_adj
  ON provider_stats_snapshot (period, vol_adj_expectancy DESC NULLS LAST);


-- ── Monthly stats (for public proof pages) ───────────────────

CREATE TABLE IF NOT EXISTS provider_monthly_stats (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider_id      TEXT NOT NULL REFERENCES providers(id),
  month            VARCHAR(7) NOT NULL,    -- YYYY-MM

  win_rate         FLOAT,
  expectancy_r     FLOAT,
  vol_adj_expectancy FLOAT,
  r_stddev         FLOAT,
  max_drawdown_pct FLOAT,
  trade_count      INT DEFAULT 0,
  data_completeness FLOAT,
  cherry_pick_score FLOAT,
  sample_confidence VARCHAR(15),

  computed_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE (provider_id, month)
);


-- ── Workspace provider imports (user → provider tracking) ────

CREATE TABLE IF NOT EXISTS workspace_provider_imports (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id  TEXT NOT NULL,
  provider_id   TEXT NOT NULL REFERENCES providers(id),
  user_id       TEXT,
  is_active     BOOLEAN DEFAULT true,
  imported_at   TIMESTAMPTZ DEFAULT now(),

  UNIQUE (workspace_id, provider_id)
);


-- ═══════════════════════════════════════════════════════════════
-- Canonical stats function — v3
--
-- VaE = E(R) / σ(R)
--   σ = population stddev, full distribution, period-specific
--   NULL when N < 5
--
-- Cherry = Bayesian-damped, volume-normalized
-- Completeness = full_cycle_rate = lifecycle grade
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION compute_provider_stats_v3(
  p_provider_id TEXT,
  p_period TEXT,
  p_days INTEGER
) RETURNS VOID AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_r_multiples FLOAT[];
  v_n INT; v_n_wins INT;
  v_r_mean FLOAT; v_r_stddev FLOAT;
  v_win_rate FLOAT; v_avg_win_r FLOAT; v_avg_loss_r FLOAT;
  v_expectancy FLOAT; v_vol_adj FLOAT;
  v_max_dd FLOAT; v_profit_factor FLOAT;
  v_gross_profit FLOAT; v_gross_loss FLOAT;
  v_total_exec INT; v_with_entry INT; v_with_sl INT;
  v_with_tp INT; v_with_outcome INT; v_full_cycle INT;
  v_full_cycle_rate FLOAT;
  v_deletes INT; v_edits INT; v_unresolved INT;
  v_non_exec INT; v_total_msgs INT;
  v_adj_delete FLOAT; v_adj_edit FLOAT;
  v_adj_unresolved FLOAT; v_adj_announce FLOAT;
  v_cherry_score FLOAT; v_confidence_factor FLOAT;
  v_raw_cherry FLOAT; v_confidence TEXT;
BEGIN
  v_cutoff := CASE WHEN p_days >= 9999 THEN '1970-01-01'::timestamptz
              ELSE now() - (p_days || ' days')::interval END;

  -- Collect R-multiples
  SELECT
    array_agg(t."rMultiple"), COUNT(*)::int,
    COUNT(*) FILTER (WHERE t."rMultiple" > 0)::int,
    COALESCE(AVG(t."rMultiple"), 0),
    COALESCE(AVG(t."rMultiple") FILTER (WHERE t."rMultiple" > 0), 0),
    COALESCE(AVG(ABS(t."rMultiple")) FILTER (WHERE t."rMultiple" <= 0), 1),
    COALESCE(MIN(t."pnlPct"), 0),
    COALESCE(SUM(t."rMultiple") FILTER (WHERE t."rMultiple" > 0), 0),
    COALESCE(SUM(ABS(t."rMultiple")) FILTER (WHERE t."rMultiple" <= 0), 0.001)
  INTO v_r_multiples, v_n, v_n_wins, v_r_mean,
       v_avg_win_r, v_avg_loss_r, v_max_dd,
       v_gross_profit, v_gross_loss
  FROM trades t
  WHERE t."providerId" = p_provider_id
    AND t."createdAt" >= v_cutoff
    AND t.status IN ('HIT_TP', 'HIT_SL');

  IF v_n IS NULL OR v_n = 0 THEN
    v_n := 0; v_r_multiples := ARRAY[]::FLOAT[];
    v_r_mean := 0; v_n_wins := 0;
    v_avg_win_r := 0; v_avg_loss_r := 0;
    v_max_dd := 0; v_gross_profit := 0; v_gross_loss := 0.001;
  END IF;

  -- Expectancy
  IF v_n > 0 THEN
    v_win_rate := v_n_wins::FLOAT / v_n;
    v_expectancy := (v_win_rate * v_avg_win_r) - ((1 - v_win_rate) * v_avg_loss_r);
  ELSE
    v_win_rate := 0; v_expectancy := 0;
  END IF;

  -- Population σ(R) — full distribution
  IF v_n >= 2 THEN
    SELECT COALESCE(sqrt(avg(power(val - v_r_mean, 2))), 0)
    INTO v_r_stddev FROM unnest(v_r_multiples) AS val;
  ELSE v_r_stddev := 0; END IF;

  -- Vol-Adj E(R), NULL when N<5
  IF v_n >= 5 THEN
    IF v_r_stddev >= 0.05 THEN v_vol_adj := v_expectancy / v_r_stddev;
    ELSE v_vol_adj := LEAST(v_expectancy * 10, 5.0); END IF;
  ELSE v_vol_adj := NULL; END IF;

  v_profit_factor := v_gross_profit / GREATEST(v_gross_loss, 0.001);

  IF v_n >= 100 THEN v_confidence := 'high';
  ELSIF v_n >= 50 THEN v_confidence := 'moderate';
  ELSIF v_n >= 20 THEN v_confidence := 'low';
  ELSE v_confidence := 'unreliable'; END IF;

  -- Lifecycle — data completeness
  SELECT COUNT(*)::int,
    COUNT(*) FILTER (WHERE s.price IS NOT NULL)::int,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM trades t2 WHERE t2."signalId" = s.id AND t2."slPrice" IS NOT NULL
    ))::int,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM trades t2 WHERE t2."signalId" = s.id AND t2."tpPrice" IS NOT NULL
    ))::int
  INTO v_total_exec, v_with_entry, v_with_sl, v_with_tp
  FROM signals s
  WHERE s."providerId" = p_provider_id
    AND s."createdAt" >= v_cutoff
    AND s.is_executable = true;

  IF v_total_exec IS NULL THEN v_total_exec := 0; END IF;

  SELECT COUNT(*)::int INTO v_with_outcome
  FROM trades WHERE "providerId" = p_provider_id
    AND "createdAt" >= v_cutoff AND status IN ('HIT_TP', 'HIT_SL');

  SELECT COUNT(*)::int INTO v_full_cycle
  FROM signals s INNER JOIN trades t ON t."signalId" = s.id
  WHERE s."providerId" = p_provider_id AND s."createdAt" >= v_cutoff
    AND s.is_executable = true AND s.price IS NOT NULL
    AND t."slPrice" IS NOT NULL AND t."tpPrice" IS NOT NULL
    AND t.status IN ('HIT_TP', 'HIT_SL');

  v_full_cycle_rate := CASE WHEN v_total_exec > 0
    THEN v_full_cycle::FLOAT / v_total_exec ELSE 0 END;

  -- Cherry score — Bayesian damped
  SELECT COALESCE(COUNT(*) FILTER (WHERE event_type = 'DELETE'), 0)::int,
         COALESCE(COUNT(*) FILTER (WHERE event_type = 'EDIT'), 0)::int
  INTO v_deletes, v_edits
  FROM signal_audit_events
  WHERE provider_id = p_provider_id AND detected_at >= v_cutoff;

  SELECT COUNT(*)::int INTO v_unresolved FROM trades
  WHERE "providerId" = p_provider_id AND status = 'ACTIVE'
    AND "createdAt" < now() - interval '72 hours' AND "createdAt" >= v_cutoff;

  SELECT COUNT(*) FILTER (WHERE NOT is_executable)::int, COUNT(*)::int
  INTO v_non_exec, v_total_msgs FROM signals
  WHERE "providerId" = p_provider_id AND "createdAt" >= v_cutoff;

  v_adj_delete := (v_deletes + 1)::FLOAT / (GREATEST(v_total_exec, 1) + 50);
  v_adj_edit := (v_edits + 2)::FLOAT / (GREATEST(v_total_exec, 1) + 50);
  v_adj_unresolved := (v_unresolved + 5)::FLOAT / (GREATEST(v_n, 1) + 50);
  v_adj_announce := (v_non_exec + 7)::FLOAT / (GREATEST(v_total_msgs, 1) + 50);

  v_raw_cherry := (
    LEAST(1.0, GREATEST(0, v_adj_delete - 0.02) / 0.98) * 2.5 +
    LEAST(1.0, GREATEST(0, v_adj_edit - 0.05) / 0.95) * 1.5 +
    LEAST(1.0, GREATEST(0, v_adj_unresolved - 0.10) / 0.90) * 1.5 +
    LEAST(1.0, GREATEST(0, v_adj_announce - 0.15) / 0.85) * 0.8
  ) / 6.3;
  v_confidence_factor := LEAST(1.0, GREATEST(v_total_exec, 1)::FLOAT / 30);
  v_cherry_score := LEAST(1.0, v_raw_cherry) * v_confidence_factor;

  -- Upsert
  INSERT INTO provider_stats_snapshot (
    provider_id, period, win_rate, expectancy_r, vol_adj_expectancy,
    r_stddev, max_drawdown_pct, trade_count, profit_factor,
    sample_confidence, data_completeness,
    pct_with_entry, pct_with_sl, pct_with_tp, pct_with_outcome, pct_full_cycle,
    cherry_pick_score, cherry_delete_rate, cherry_edit_rate,
    cherry_unresolved_rate, cherry_announce_ratio, cherry_confidence,
    computed_at
  ) VALUES (
    p_provider_id, p_period, v_win_rate, v_expectancy, v_vol_adj,
    v_r_stddev, v_max_dd, v_n, v_profit_factor,
    v_confidence, v_full_cycle_rate,
    CASE WHEN v_total_exec > 0 THEN v_with_entry::FLOAT / v_total_exec ELSE 0 END,
    CASE WHEN v_total_exec > 0 THEN v_with_sl::FLOAT / v_total_exec ELSE 0 END,
    CASE WHEN v_total_exec > 0 THEN v_with_tp::FLOAT / v_total_exec ELSE 0 END,
    CASE WHEN v_total_exec > 0 THEN v_with_outcome::FLOAT / v_total_exec ELSE 0 END,
    v_full_cycle_rate,
    v_cherry_score, v_adj_delete, v_adj_edit,
    v_adj_unresolved, v_adj_announce, v_confidence_factor,
    now()
  )
  ON CONFLICT (provider_id, period) DO UPDATE SET
    win_rate = EXCLUDED.win_rate, expectancy_r = EXCLUDED.expectancy_r,
    vol_adj_expectancy = EXCLUDED.vol_adj_expectancy, r_stddev = EXCLUDED.r_stddev,
    max_drawdown_pct = EXCLUDED.max_drawdown_pct, trade_count = EXCLUDED.trade_count,
    profit_factor = EXCLUDED.profit_factor, sample_confidence = EXCLUDED.sample_confidence,
    data_completeness = EXCLUDED.data_completeness,
    pct_with_entry = EXCLUDED.pct_with_entry, pct_with_sl = EXCLUDED.pct_with_sl,
    pct_with_tp = EXCLUDED.pct_with_tp, pct_with_outcome = EXCLUDED.pct_with_outcome,
    pct_full_cycle = EXCLUDED.pct_full_cycle,
    cherry_pick_score = EXCLUDED.cherry_pick_score,
    cherry_delete_rate = EXCLUDED.cherry_delete_rate, cherry_edit_rate = EXCLUDED.cherry_edit_rate,
    cherry_unresolved_rate = EXCLUDED.cherry_unresolved_rate,
    cherry_announce_ratio = EXCLUDED.cherry_announce_ratio,
    cherry_confidence = EXCLUDED.cherry_confidence,
    computed_at = EXCLUDED.computed_at;
END;
$$ LANGUAGE plpgsql;


-- Batch recompute helper
CREATE OR REPLACE FUNCTION recompute_all_provider_stats_v3()
RETURNS VOID AS $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN SELECT id FROM providers WHERE marketplace_visible = true AND "isActive" = true
  LOOP
    PERFORM compute_provider_stats_v3(rec.id, '7d', 7);
    PERFORM compute_provider_stats_v3(rec.id, '30d', 30);
    PERFORM compute_provider_stats_v3(rec.id, '90d', 90);
    PERFORM compute_provider_stats_v3(rec.id, 'all', 9999);
  END LOOP;
END;
$$ LANGUAGE plpgsql;


-- Monthly stats function
CREATE OR REPLACE FUNCTION compute_monthly_stats(
  p_provider_id TEXT, p_month TEXT  -- 'YYYY-MM'
) RETURNS VOID AS $$
DECLARE
  v_start DATE; v_end DATE;
  v_trades RECORD;
BEGIN
  v_start := (p_month || '-01')::date;
  v_end := (v_start + interval '1 month')::date;

  SELECT
    COUNT(*)::int AS n,
    COUNT(*) FILTER (WHERE "rMultiple" > 0)::int AS wins,
    COALESCE(AVG("rMultiple"), 0) AS r_mean,
    COALESCE(stddev_pop("rMultiple"), 0) AS r_std
  INTO v_trades
  FROM trades
  WHERE "providerId" = p_provider_id
    AND status IN ('HIT_TP', 'HIT_SL')
    AND "exitedAt" >= v_start AND "exitedAt" < v_end;

  IF v_trades.n = 0 THEN RETURN; END IF;

  INSERT INTO provider_monthly_stats (
    provider_id, month, trade_count, win_rate,
    expectancy_r, vol_adj_expectancy, r_stddev,
    sample_confidence, computed_at
  ) VALUES (
    p_provider_id, p_month, v_trades.n,
    v_trades.wins::float / v_trades.n,
    v_trades.r_mean,
    CASE WHEN v_trades.n >= 5 AND v_trades.r_std >= 0.05
      THEN v_trades.r_mean / v_trades.r_std ELSE NULL END,
    v_trades.r_std,
    CASE WHEN v_trades.n >= 100 THEN 'high'
      WHEN v_trades.n >= 50 THEN 'moderate'
      WHEN v_trades.n >= 20 THEN 'low' ELSE 'unreliable' END,
    now()
  )
  ON CONFLICT (provider_id, month) DO UPDATE SET
    trade_count = EXCLUDED.trade_count, win_rate = EXCLUDED.win_rate,
    expectancy_r = EXCLUDED.expectancy_r,
    vol_adj_expectancy = EXCLUDED.vol_adj_expectancy,
    r_stddev = EXCLUDED.r_stddev,
    sample_confidence = EXCLUDED.sample_confidence,
    computed_at = EXCLUDED.computed_at;
END;
$$ LANGUAGE plpgsql;
