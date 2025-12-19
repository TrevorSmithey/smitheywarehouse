-- Product Analytics Tables for Cross-Sell Analysis
-- Solves: Client-side analysis of 958K line items times out
-- Solution: Pre-computed aggregation tables updated nightly

-- ============================================================================
-- TABLE 1: product_repeat_rates
-- Stores: First purchase → repeat buyer probability
-- ============================================================================
CREATE TABLE IF NOT EXISTS product_repeat_rates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_title TEXT NOT NULL,
  product_sku TEXT,
  category TEXT,                    -- skillet, dutch_oven, carbon_steel, accessory, set, other
  first_buyers INT NOT NULL,        -- customers whose first order included this
  repeat_buyers INT NOT NULL,       -- of those, how many ordered again
  repeat_rate DECIMAL(5,2),         -- repeat_buyers / first_buyers * 100
  avg_days_to_second DECIMAL(8,1),  -- average days to second purchase
  computed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_repeat_rate ON product_repeat_rates(repeat_rate DESC);
CREATE INDEX IF NOT EXISTS idx_product_category ON product_repeat_rates(category);
CREATE INDEX IF NOT EXISTS idx_product_first_buyers ON product_repeat_rates(first_buyers DESC);

-- ============================================================================
-- TABLE 2: cross_sell_sequences
-- Stores: After buying X, customers bought Y
-- ============================================================================
CREATE TABLE IF NOT EXISTS cross_sell_sequences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  first_product TEXT NOT NULL,      -- "No. 12 Skillet"
  second_product TEXT NOT NULL,     -- "Chainmail Scrubber"
  sequence_count INT NOT NULL,      -- how many times this sequence occurred
  avg_days_between INT,             -- average days between purchases
  computed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cross_sell_first ON cross_sell_sequences(first_product);
CREATE INDEX IF NOT EXISTS idx_cross_sell_count ON cross_sell_sequences(sequence_count DESC);
CREATE INDEX IF NOT EXISTS idx_cross_sell_second ON cross_sell_sequences(second_product);

-- ============================================================================
-- TABLE 3: basket_affinity
-- Stores: Products frequently bought in the same order
-- ============================================================================
CREATE TABLE IF NOT EXISTS basket_affinity (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_a TEXT NOT NULL,
  product_b TEXT NOT NULL,
  co_occurrence INT NOT NULL,       -- orders containing both
  support DECIMAL(5,4),             -- co_occurrence / total_orders
  confidence_a_to_b DECIMAL(5,4),   -- P(B|A) = co_occurrence / orders_with_A
  confidence_b_to_a DECIMAL(5,4),   -- P(A|B) = co_occurrence / orders_with_B
  computed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_basket_product_a ON basket_affinity(product_a);
CREATE INDEX IF NOT EXISTS idx_basket_product_b ON basket_affinity(product_b);
CREATE INDEX IF NOT EXISTS idx_basket_cooccurrence ON basket_affinity(co_occurrence DESC);

-- ============================================================================
-- COMMENT: Purpose and refresh schedule
-- ============================================================================
COMMENT ON TABLE product_repeat_rates IS 'Pre-computed first purchase → repeat rate analysis. Refresh nightly.';
COMMENT ON TABLE cross_sell_sequences IS 'Pre-computed cross-sell sequences (order 1 → order 2). Refresh nightly.';
COMMENT ON TABLE basket_affinity IS 'Pre-computed basket co-occurrence pairs. Refresh nightly.';
