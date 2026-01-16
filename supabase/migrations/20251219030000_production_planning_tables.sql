-- Production Planning Tables
-- Supports monthly production targets and BOM constraint analysis

-- ============================================
-- Table 1: production_targets
-- Monthly production goals from ops manager CSV
-- ============================================
CREATE TABLE IF NOT EXISTS production_targets (
  id SERIAL PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  sku TEXT NOT NULL,
  target INTEGER NOT NULL CHECK (target >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(year, month, sku)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_prod_targets_sku ON production_targets(sku);
CREATE INDEX IF NOT EXISTS idx_prod_targets_period ON production_targets(year, month);
CREATE INDEX IF NOT EXISTS idx_prod_targets_year ON production_targets(year);

COMMENT ON TABLE production_targets IS 'Monthly production targets from ops manager. Compared against assembly_sku_daily for progress tracking.';
COMMENT ON COLUMN production_targets.target IS 'Number of units to produce this month';


-- ============================================
-- Table 2: bill_of_materials
-- Component relationships for finished goods
-- ============================================
CREATE TABLE IF NOT EXISTS bill_of_materials (
  id SERIAL PRIMARY KEY,
  finished_good_sku TEXT NOT NULL,
  component_sku TEXT NOT NULL,
  quantity_required DECIMAL(10,4) NOT NULL CHECK (quantity_required > 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(finished_good_sku, component_sku)
);

-- Indexes for BOM lookups
CREATE INDEX IF NOT EXISTS idx_bom_finished_good ON bill_of_materials(finished_good_sku);
CREATE INDEX IF NOT EXISTS idx_bom_component ON bill_of_materials(component_sku);

COMMENT ON TABLE bill_of_materials IS 'Bill of materials mapping finished goods to their required components. Used for production constraint analysis.';
COMMENT ON COLUMN bill_of_materials.finished_good_sku IS 'SKU of the finished product (e.g., Smith-CI-Chef10)';
COMMENT ON COLUMN bill_of_materials.component_sku IS 'SKU of the component/raw material (matches ShipHero inventory SKU)';
COMMENT ON COLUMN bill_of_materials.quantity_required IS 'Number of this component needed per finished good';


-- ============================================
-- Trigger: Update updated_at on modification
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to production_targets
DROP TRIGGER IF EXISTS update_production_targets_updated_at ON production_targets;
CREATE TRIGGER update_production_targets_updated_at
  BEFORE UPDATE ON production_targets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to bill_of_materials
DROP TRIGGER IF EXISTS update_bill_of_materials_updated_at ON bill_of_materials;
CREATE TRIGGER update_bill_of_materials_updated_at
  BEFORE UPDATE ON bill_of_materials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
