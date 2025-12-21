-- Component Planning Tables
-- Supports forward-looking production planning with on-order visibility and lead times

-- ============================================
-- Table 1: component_orders
-- Track components on order from suppliers
-- ============================================
CREATE TABLE IF NOT EXISTS component_orders (
  id SERIAL PRIMARY KEY,
  component_sku TEXT NOT NULL,
  quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0),
  quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  po_number TEXT,                          -- Purchase order reference
  supplier TEXT,                           -- Supplier name
  order_date DATE NOT NULL,                -- When the order was placed
  expected_arrival DATE,                   -- Expected delivery date
  actual_arrival DATE,                     -- Actual delivery date (NULL until received)
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'in_transit', 'partial', 'received', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for component order lookups
CREATE INDEX IF NOT EXISTS idx_comp_orders_sku ON component_orders(component_sku);
CREATE INDEX IF NOT EXISTS idx_comp_orders_status ON component_orders(status);
CREATE INDEX IF NOT EXISTS idx_comp_orders_expected ON component_orders(expected_arrival) WHERE status NOT IN ('received', 'cancelled');

COMMENT ON TABLE component_orders IS 'Tracks component orders in the pipeline. Used for forward-looking production planning.';
COMMENT ON COLUMN component_orders.status IS 'Order status: ordered, in_transit, partial (partially received), received, cancelled';


-- ============================================
-- Table 2: component_lead_times
-- Default lead times per component/supplier
-- ============================================
CREATE TABLE IF NOT EXISTS component_lead_times (
  id SERIAL PRIMARY KEY,
  component_sku TEXT NOT NULL,
  supplier TEXT,                           -- NULL means default for all suppliers
  lead_time_days INTEGER NOT NULL CHECK (lead_time_days >= 0),
  min_order_quantity INTEGER DEFAULT 1,    -- Minimum order quantity
  cost_per_unit DECIMAL(10,2),             -- Unit cost for planning
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(component_sku, COALESCE(supplier, ''))
);

-- Indexes for lead time lookups
CREATE INDEX IF NOT EXISTS idx_comp_lead_times_sku ON component_lead_times(component_sku);

COMMENT ON TABLE component_lead_times IS 'Default lead times for components. Used to calculate order recommendations.';
COMMENT ON COLUMN component_lead_times.lead_time_days IS 'Number of days from order placement to delivery';


-- ============================================
-- View: component_pipeline
-- Aggregated view of on-order components
-- ============================================
CREATE OR REPLACE VIEW component_pipeline AS
SELECT
  component_sku,
  SUM(CASE WHEN status = 'ordered' THEN quantity_ordered - quantity_received ELSE 0 END) AS qty_ordered,
  SUM(CASE WHEN status = 'in_transit' THEN quantity_ordered - quantity_received ELSE 0 END) AS qty_in_transit,
  MIN(CASE WHEN status IN ('ordered', 'in_transit') THEN expected_arrival END) AS next_arrival_date
FROM component_orders
WHERE status NOT IN ('received', 'cancelled')
GROUP BY component_sku;

COMMENT ON VIEW component_pipeline IS 'Aggregated view of components in the order pipeline';


-- ============================================
-- Trigger: Update updated_at on modification
-- ============================================
-- Apply trigger to component_orders
DROP TRIGGER IF EXISTS update_component_orders_updated_at ON component_orders;
CREATE TRIGGER update_component_orders_updated_at
  BEFORE UPDATE ON component_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to component_lead_times
DROP TRIGGER IF EXISTS update_component_lead_times_updated_at ON component_lead_times;
CREATE TRIGGER update_component_lead_times_updated_at
  BEFORE UPDATE ON component_lead_times
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
