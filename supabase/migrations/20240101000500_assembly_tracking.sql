-- Assembly Tracking Tables
-- Synced from Cookware Assembly Tracking.xlsx

-- Daily production aggregates (from Daily_Aggregation sheet)
CREATE TABLE IF NOT EXISTS assembly_daily (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  daily_total INTEGER NOT NULL DEFAULT 0,
  day_of_week TEXT,
  week_num INTEGER,
  month INTEGER,
  year INTEGER,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Manufacturing targets by SKU (from Revised Manufacturing Targets sheet)
CREATE TABLE IF NOT EXISTS assembly_targets (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  current_inventory INTEGER DEFAULT 0,
  demand INTEGER DEFAULT 0,
  current_shortage INTEGER DEFAULT 0,
  original_plan INTEGER DEFAULT 0,
  revised_plan INTEGER DEFAULT 0,
  assembled_since_cutoff INTEGER DEFAULT 0,
  deficit INTEGER DEFAULT 0,
  category TEXT, -- 'cast_iron' or 'carbon_steel'
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Assembly config (cutoff date, etc.)
CREATE TABLE IF NOT EXISTS assembly_config (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default config
INSERT INTO assembly_config (key, value) VALUES
  ('manufacturing_cutoff', '2025-12-10'),
  ('cutoff_start_date', '2025-10-21')
ON CONFLICT (key) DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_assembly_daily_date ON assembly_daily(date DESC);
CREATE INDEX IF NOT EXISTS idx_assembly_targets_sku ON assembly_targets(sku);
CREATE INDEX IF NOT EXISTS idx_assembly_targets_category ON assembly_targets(category);
