-- Historical Tracking Tables
-- Enables "hindsight capability" - looking back at what signals were missed
-- Created: 2025-12-23

-- ============================================
-- Table 1: daily_operations_snapshot
-- Daily aggregate of key operational metrics
-- ============================================
CREATE TABLE IF NOT EXISTS daily_operations_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL UNIQUE,

  -- Backlog metrics
  backlog_orders INTEGER DEFAULT 0,           -- Unfulfilled orders count
  backlog_units INTEGER DEFAULT 0,            -- Unfulfilled units count

  -- Fulfillment metrics
  orders_shipped INTEGER DEFAULT 0,           -- Orders shipped that day
  units_shipped INTEGER DEFAULT 0,            -- Units shipped that day
  avg_lead_time_hours NUMERIC(10,2),          -- Average order-to-ship time

  -- Assembly metrics
  assembly_completed INTEGER DEFAULT 0,       -- Units assembled that day

  -- Inventory totals
  inventory_total INTEGER DEFAULT 0,          -- Total inventory across all warehouses
  inventory_pipefitter INTEGER DEFAULT 0,
  inventory_hobson INTEGER DEFAULT 0,
  inventory_selery INTEGER DEFAULT 0,

  -- Stuck shipments
  stuck_shipments INTEGER DEFAULT 0,          -- Shipments with no scan in 48+ hours

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for date lookups
CREATE INDEX IF NOT EXISTS idx_ops_snapshot_date ON daily_operations_snapshot(snapshot_date);

COMMENT ON TABLE daily_operations_snapshot IS 'Daily snapshot of operational metrics for historical analysis. Enables "we should have known on X date" queries.';
COMMENT ON COLUMN daily_operations_snapshot.backlog_orders IS 'Count of orders not yet fully shipped at end of day';
COMMENT ON COLUMN daily_operations_snapshot.avg_lead_time_hours IS 'Average hours from order creation to first shipment';


-- ============================================
-- Table 2: component_inventory_history
-- Daily snapshots of component inventory levels
-- ============================================
CREATE TABLE IF NOT EXISTS component_inventory_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  component_sku TEXT NOT NULL,

  -- Inventory levels
  on_hand INTEGER DEFAULT 0,                  -- Current stock
  on_order INTEGER DEFAULT 0,                 -- Units ordered but not received

  -- Derived metrics (computed at snapshot time)
  days_of_supply NUMERIC(10,1),               -- Based on recent consumption

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(snapshot_date, component_sku)
);

-- Indexes for component history queries
CREATE INDEX IF NOT EXISTS idx_comp_hist_date ON component_inventory_history(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_comp_hist_sku ON component_inventory_history(component_sku);
CREATE INDEX IF NOT EXISTS idx_comp_hist_sku_date ON component_inventory_history(component_sku, snapshot_date);

COMMENT ON TABLE component_inventory_history IS 'Daily snapshots of component inventory. Used to analyze when component shortages became predictable.';
COMMENT ON COLUMN component_inventory_history.days_of_supply IS 'Estimated days of supply based on recent consumption rate';


-- ============================================
-- Table 3: budget_changelog
-- Audit log of budget parameter changes
-- ============================================
CREATE TABLE IF NOT EXISTS budget_changelog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_at TIMESTAMPTZ DEFAULT NOW(),

  -- What changed
  field_changed TEXT NOT NULL,                -- e.g., 'monthly_target', 'sku_allocation', 'holiday_dates'
  category TEXT,                              -- e.g., 'cast_iron', 'carbon_steel' (if applicable)
  sku TEXT,                                   -- If change is SKU-specific

  -- Change details
  old_value JSONB,                            -- Previous value
  new_value JSONB,                            -- New value

  -- Context
  reason TEXT,                                -- Optional note about why
  changed_by TEXT DEFAULT 'system',           -- 'system' or user identifier

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for changelog queries
CREATE INDEX IF NOT EXISTS idx_budget_changelog_date ON budget_changelog(changed_at);
CREATE INDEX IF NOT EXISTS idx_budget_changelog_field ON budget_changelog(field_changed);
CREATE INDEX IF NOT EXISTS idx_budget_changelog_category ON budget_changelog(category) WHERE category IS NOT NULL;

COMMENT ON TABLE budget_changelog IS 'Audit log of budget parameter changes. Tracks what changed, when, and why.';
COMMENT ON COLUMN budget_changelog.field_changed IS 'The parameter that was modified (e.g., monthly_target, sku_allocation, holiday_dates)';


-- ============================================
-- Table 4: lead_time_history
-- Daily average lead times by warehouse/channel
-- ============================================
CREATE TABLE IF NOT EXISTS lead_time_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,

  -- Segmentation
  warehouse TEXT,                             -- 'smithey', 'selery', or NULL for overall

  -- Lead time metrics (in hours)
  avg_lead_time_hours NUMERIC(10,2),
  p50_lead_time_hours NUMERIC(10,2),          -- Median
  p90_lead_time_hours NUMERIC(10,2),          -- 90th percentile

  -- Volume for context
  orders_measured INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique index with COALESCE (can't use UNIQUE constraint with functions)
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_time_unique ON lead_time_history(snapshot_date, COALESCE(warehouse, '__all__'));

-- Indexes for lead time queries
CREATE INDEX IF NOT EXISTS idx_lead_time_hist_date ON lead_time_history(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_lead_time_hist_warehouse ON lead_time_history(warehouse) WHERE warehouse IS NOT NULL;

COMMENT ON TABLE lead_time_history IS 'Daily lead time metrics. Tracks how fast orders are being fulfilled over time.';


-- ============================================
-- Grants for new tables (service role only via RLS)
-- ============================================
-- Note: RLS will be enabled separately to restrict to service_role only

GRANT SELECT ON daily_operations_snapshot TO anon;
GRANT SELECT ON component_inventory_history TO anon;
GRANT SELECT ON budget_changelog TO anon;
GRANT SELECT ON lead_time_history TO anon;

GRANT ALL ON daily_operations_snapshot TO service_role;
GRANT ALL ON component_inventory_history TO service_role;
GRANT ALL ON budget_changelog TO service_role;
GRANT ALL ON lead_time_history TO service_role;


-- ============================================
-- Enable RLS on all new tables
-- ============================================
ALTER TABLE daily_operations_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE component_inventory_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_time_history ENABLE ROW LEVEL SECURITY;

-- Create service-role-only policies
CREATE POLICY "Service role only" ON daily_operations_snapshot FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON component_inventory_history FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON budget_changelog FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role only" ON lead_time_history FOR ALL USING (auth.role() = 'service_role');
