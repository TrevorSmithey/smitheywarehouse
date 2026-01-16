-- Wholesale Forecast Tables
-- Stores annual revenue budgets, door-level drivers, and SKU mix assumptions
-- Supports immutable revision tracking (edit creates new version, old preserved)

-- ============================================================================
-- WHOLESALE FORECASTS TABLE
-- ============================================================================
-- Core table storing annual forecast budgets and driver assumptions.
-- Each fiscal_year can have multiple versions; only one is 'active' at a time.

CREATE TABLE IF NOT EXISTS wholesale_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,                                    -- User who created this version

  -- Status workflow: draft → active → archived
  -- Only one 'active' forecast per fiscal_year at any time
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),

  -- B2B Revenue Targets (quarterly breakdown)
  b2b_q1_target NUMERIC NOT NULL DEFAULT 0,
  b2b_q2_target NUMERIC NOT NULL DEFAULT 0,
  b2b_q3_target NUMERIC NOT NULL DEFAULT 0,
  b2b_q4_target NUMERIC NOT NULL DEFAULT 0,

  -- Corporate Revenue Targets (quarterly breakdown)
  corp_q1_target NUMERIC NOT NULL DEFAULT 0,
  corp_q2_target NUMERIC NOT NULL DEFAULT 0,
  corp_q3_target NUMERIC NOT NULL DEFAULT 0,
  corp_q4_target NUMERIC NOT NULL DEFAULT 0,

  -- Door-level driver assumptions (B2B specific)
  existing_doors_start INTEGER,                       -- Doors at start of year
  new_doors_target INTEGER,                           -- Target new doors to acquire
  expected_churn_doors INTEGER,                       -- Expected doors to churn
  organic_growth_pct NUMERIC,                         -- Same-store growth % (e.g., 0.11 = 11%)
  new_door_first_year_yield NUMERIC,                  -- Avg first-year revenue per new door

  -- Revision tracking (immutable history)
  revision_note TEXT,                                 -- Why this version was created
  parent_forecast_id UUID REFERENCES wholesale_forecasts(id),  -- Previous version this derived from

  UNIQUE(fiscal_year, version)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_forecasts_fiscal_year_status
  ON wholesale_forecasts(fiscal_year, status);
CREATE INDEX IF NOT EXISTS idx_forecasts_created_at
  ON wholesale_forecasts(created_at DESC);

-- ============================================================================
-- WHOLESALE FORECAST SKU MIX TABLE
-- ============================================================================
-- Stores the SKU mix assumptions for a forecast.
-- Allows computing unit forecasts from revenue: units = revenue × share% / AUP

CREATE TABLE IF NOT EXISTS wholesale_forecast_sku_mix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id UUID NOT NULL REFERENCES wholesale_forecasts(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  sku_name TEXT,                                      -- Human-readable name (e.g., "12 Tradtional Skillet")
  revenue_share_pct NUMERIC NOT NULL,                 -- Portion of revenue (e.g., 0.197 = 19.7%)
  avg_unit_price NUMERIC NOT NULL,                    -- Average unit price (AUP) for this SKU

  UNIQUE(forecast_id, sku)
);

-- Index for looking up SKU mix by forecast
CREATE INDEX IF NOT EXISTS idx_sku_mix_forecast
  ON wholesale_forecast_sku_mix(forecast_id);

-- ============================================================================
-- HELPER VIEWS
-- ============================================================================

-- View: Active forecast per fiscal year (most common query)
CREATE OR REPLACE VIEW wholesale_forecast_active AS
SELECT
  f.*,
  (f.b2b_q1_target + f.b2b_q2_target + f.b2b_q3_target + f.b2b_q4_target) as b2b_annual_target,
  (f.corp_q1_target + f.corp_q2_target + f.corp_q3_target + f.corp_q4_target) as corp_annual_target,
  (f.existing_doors_start - COALESCE(f.expected_churn_doors, 0) + COALESCE(f.new_doors_target, 0)) as projected_ending_doors
FROM wholesale_forecasts f
WHERE f.status = 'active';

-- View: Forecast revision history (for audit trail)
CREATE OR REPLACE VIEW wholesale_forecast_history AS
SELECT
  f.id,
  f.fiscal_year,
  f.version,
  f.status,
  f.created_at,
  f.created_by,
  f.revision_note,
  f.parent_forecast_id,
  (f.b2b_q1_target + f.b2b_q2_target + f.b2b_q3_target + f.b2b_q4_target) as b2b_total,
  (f.corp_q1_target + f.corp_q2_target + f.corp_q3_target + f.corp_q4_target) as corp_total
FROM wholesale_forecasts f
ORDER BY f.fiscal_year DESC, f.version DESC;

-- ============================================================================
-- GRANTS (match existing patterns)
-- ============================================================================
-- Read access for anon (dashboard viewing)
-- Full access for service_role (API writes)

GRANT SELECT ON wholesale_forecasts TO anon;
GRANT SELECT ON wholesale_forecast_sku_mix TO anon;
GRANT SELECT ON wholesale_forecast_active TO anon;
GRANT SELECT ON wholesale_forecast_history TO anon;

GRANT ALL ON wholesale_forecasts TO service_role;
GRANT ALL ON wholesale_forecast_sku_mix TO service_role;

-- ============================================================================
-- DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE wholesale_forecasts IS 'Annual revenue forecasts with door-level driver assumptions. Immutable versioning: edits create new rows.';
COMMENT ON TABLE wholesale_forecast_sku_mix IS 'SKU mix assumptions per forecast. Used to convert revenue forecasts to unit forecasts.';
COMMENT ON VIEW wholesale_forecast_active IS 'Current active forecast per fiscal year. Use this for dashboard display.';
COMMENT ON VIEW wholesale_forecast_history IS 'All forecast versions for audit trail and comparison.';

COMMENT ON COLUMN wholesale_forecasts.status IS 'draft = work in progress, active = current budget, archived = superseded version';
COMMENT ON COLUMN wholesale_forecasts.organic_growth_pct IS 'Expected same-store revenue growth from retained doors (e.g., 0.11 = 11%)';
COMMENT ON COLUMN wholesale_forecasts.new_door_first_year_yield IS 'Expected average first-year revenue per newly acquired door';
COMMENT ON COLUMN wholesale_forecast_sku_mix.revenue_share_pct IS 'Portion of total revenue expected from this SKU (0-1 range, should sum to 1)';
