-- Ecommerce Analytics Schema
-- Enables VP of Growth-level customer analytics from Shopify data
-- Phase 1: Foundation tables and order enhancements

-- ============================================================================
-- 1. SHOPIFY CUSTOMERS TABLE
-- ============================================================================
-- Customer master data from Shopify - foundation for all customer analytics

CREATE TABLE IF NOT EXISTS shopify_customers (
  id BIGSERIAL PRIMARY KEY,
  shopify_customer_id BIGINT UNIQUE NOT NULL,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,

  -- Marketing consent
  email_marketing_consent BOOLEAN DEFAULT FALSE,
  sms_marketing_consent BOOLEAN DEFAULT FALSE,

  -- Lifetime metrics (from Shopify Customer API)
  orders_count INTEGER DEFAULT 0,
  total_spent DECIMAL(12,2) DEFAULT 0,

  -- Key dates
  first_order_date TIMESTAMPTZ,
  last_order_date TIMESTAMPTZ,
  shopify_created_at TIMESTAMPTZ,  -- When customer record was created in Shopify

  -- Geographic (from default address)
  city TEXT,
  province TEXT,
  province_code TEXT,
  country TEXT,
  country_code TEXT,
  zip TEXT,

  -- Shopify tags for segmentation
  tags TEXT,

  -- Computed fields (updated by sync/cron)
  customer_type TEXT DEFAULT 'new',  -- 'new', 'active', 'at_risk', 'churned', 'vip'
  acquisition_cohort TEXT,  -- YYYY-MM for cohort analysis
  days_since_last_order INTEGER,

  -- Sync metadata
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_shopify_customers_email ON shopify_customers(email);
CREATE INDEX IF NOT EXISTS idx_shopify_customers_shopify_created ON shopify_customers(shopify_created_at);
CREATE INDEX IF NOT EXISTS idx_shopify_customers_last_order ON shopify_customers(last_order_date);
CREATE INDEX IF NOT EXISTS idx_shopify_customers_cohort ON shopify_customers(acquisition_cohort);
CREATE INDEX IF NOT EXISTS idx_shopify_customers_type ON shopify_customers(customer_type);
CREATE INDEX IF NOT EXISTS idx_shopify_customers_province ON shopify_customers(province_code);
CREATE INDEX IF NOT EXISTS idx_shopify_customers_total_spent ON shopify_customers(total_spent DESC);

COMMENT ON TABLE shopify_customers IS 'D2C customer data synced from Shopify. Foundation for LTV, retention, and cohort analytics.';

-- ============================================================================
-- 2. ABANDONED CHECKOUTS TABLE
-- ============================================================================
-- Tracks abandoned carts for recovery analysis

CREATE TABLE IF NOT EXISTS abandoned_checkouts (
  id BIGSERIAL PRIMARY KEY,
  shopify_checkout_id BIGINT UNIQUE NOT NULL,
  checkout_token TEXT UNIQUE,

  -- Customer info (may or may not have account)
  email TEXT,
  shopify_customer_id BIGINT,

  -- Cart info
  cart_total DECIMAL(12,2),
  subtotal_price DECIMAL(12,2),
  total_tax DECIMAL(10,2),
  total_discounts DECIMAL(10,2),
  line_items_count INTEGER,
  line_items JSONB,  -- [{sku, title, quantity, price, variant_id}]
  discount_codes JSONB,  -- [{code, amount, type}]

  -- Attribution
  referring_site TEXT,
  landing_site TEXT,
  source_name TEXT,

  -- Timing
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,  -- Set when checkout converts to order
  abandoned_checkout_url TEXT,

  -- Recovery tracking
  recovery_status TEXT DEFAULT 'abandoned',  -- 'abandoned', 'recovered', 'expired'
  recovered_order_id BIGINT,  -- FK to orders.id if recovered
  recovery_source TEXT,  -- 'email', 'sms', 'retargeting', 'organic'

  -- Sync metadata
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_abandoned_checkouts_email ON abandoned_checkouts(email);
CREATE INDEX IF NOT EXISTS idx_abandoned_checkouts_customer ON abandoned_checkouts(shopify_customer_id);
CREATE INDEX IF NOT EXISTS idx_abandoned_checkouts_created ON abandoned_checkouts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_abandoned_checkouts_status ON abandoned_checkouts(recovery_status);
CREATE INDEX IF NOT EXISTS idx_abandoned_checkouts_total ON abandoned_checkouts(cart_total DESC);

COMMENT ON TABLE abandoned_checkouts IS 'Abandoned checkout tracking from Shopify. Enables cart recovery analysis.';

-- ============================================================================
-- 3. CUSTOMER COHORTS TABLE (Pre-aggregated)
-- ============================================================================
-- Pre-computed cohort metrics for fast dashboard loading

CREATE TABLE IF NOT EXISTS customer_cohorts (
  id BIGSERIAL PRIMARY KEY,
  cohort_month TEXT NOT NULL,  -- YYYY-MM (acquisition month)
  months_since_acquisition INTEGER NOT NULL,  -- 0, 1, 2, 3... (0 = acquisition month)

  -- Cohort size
  cohort_size INTEGER NOT NULL,  -- Customers acquired in this month

  -- Retention metrics
  active_customers INTEGER DEFAULT 0,  -- Customers who ordered in this period
  retention_rate DECIMAL(5,2),  -- active / cohort_size * 100

  -- Revenue metrics
  total_revenue DECIMAL(14,2) DEFAULT 0,
  revenue_per_customer DECIMAL(10,2),  -- Cumulative LTV at this point
  orders_count INTEGER DEFAULT 0,
  orders_per_customer DECIMAL(6,2),
  avg_order_value DECIMAL(10,2),

  -- Computed at
  computed_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(cohort_month, months_since_acquisition)
);

CREATE INDEX IF NOT EXISTS idx_cohorts_month ON customer_cohorts(cohort_month);
CREATE INDEX IF NOT EXISTS idx_cohorts_period ON customer_cohorts(months_since_acquisition);

COMMENT ON TABLE customer_cohorts IS 'Pre-aggregated cohort retention and LTV data. Rebuilt weekly by compute-cohorts cron.';

-- ============================================================================
-- 4. DAILY ECOMMERCE STATS TABLE (Pre-aggregated)
-- ============================================================================
-- Pre-computed daily stats for trend charts

CREATE TABLE IF NOT EXISTS daily_ecommerce_stats (
  date DATE PRIMARY KEY,

  -- Order metrics
  total_orders INTEGER DEFAULT 0,
  total_revenue DECIMAL(14,2) DEFAULT 0,
  avg_order_value DECIMAL(10,2) DEFAULT 0,

  -- Customer metrics
  new_customers INTEGER DEFAULT 0,  -- First-time buyers
  returning_customers INTEGER DEFAULT 0,
  new_customer_revenue DECIMAL(12,2) DEFAULT 0,
  returning_customer_revenue DECIMAL(12,2) DEFAULT 0,

  -- Discount metrics
  orders_with_discount INTEGER DEFAULT 0,
  total_discount_amount DECIMAL(10,2) DEFAULT 0,
  discount_rate DECIMAL(5,2),  -- % of orders with discount
  avg_discount_per_order DECIMAL(8,2),

  -- Abandoned checkouts
  abandoned_checkouts INTEGER DEFAULT 0,
  abandoned_value DECIMAL(12,2) DEFAULT 0,
  recovered_checkouts INTEGER DEFAULT 0,
  recovery_rate DECIMAL(5,2),

  -- Refunds
  refunds_count INTEGER DEFAULT 0,
  refunds_amount DECIMAL(10,2) DEFAULT 0,
  refund_rate DECIMAL(5,2),  -- % of orders refunded

  -- Updated
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE daily_ecommerce_stats IS 'Pre-aggregated daily ecommerce metrics for trend charts.';

-- ============================================================================
-- 5. ORDERS TABLE ENHANCEMENTS
-- ============================================================================
-- Add columns to existing orders table for enhanced analytics

-- Customer linkage
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shopify_customer_id BIGINT;

-- Price fields
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_price DECIMAL(12,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_price DECIMAL(12,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_discounts DECIMAL(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_tax DECIMAL(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_shipping DECIMAL(10,2);

-- Discount tracking
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_codes JSONB;  -- [{code, amount, type}]

-- Attribution
ALTER TABLE orders ADD COLUMN IF NOT EXISTS referring_site TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_name TEXT;  -- 'web', 'pos', 'draft_order', etc.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS landing_site TEXT;

-- Payment
ALTER TABLE orders ADD COLUMN IF NOT EXISTS financial_status TEXT;  -- 'paid', 'pending', 'refunded', etc.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_gateway TEXT;

-- Shipping address (for geographic analytics)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_city TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_province TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_province_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_country TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_country_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_zip TEXT;

-- Customer journey fields
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_first_order BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_sequence INTEGER;  -- 1st, 2nd, 3rd order for this customer

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(shopify_customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_total_price ON orders(total_price);
CREATE INDEX IF NOT EXISTS idx_orders_discount ON orders(total_discounts) WHERE total_discounts > 0;
CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source_name);
CREATE INDEX IF NOT EXISTS idx_orders_shipping_province ON orders(shipping_province_code);
CREATE INDEX IF NOT EXISTS idx_orders_first_order ON orders(is_first_order) WHERE is_first_order = TRUE;
CREATE INDEX IF NOT EXISTS idx_orders_financial_status ON orders(financial_status);

-- ============================================================================
-- 6. HELPER VIEWS
-- ============================================================================

-- Customer segments aggregation
CREATE OR REPLACE VIEW customer_segments_summary AS
SELECT
  customer_type,
  COUNT(*) as customer_count,
  SUM(total_spent) as total_revenue,
  AVG(total_spent) as avg_ltv,
  AVG(orders_count) as avg_orders,
  COUNT(*) FILTER (WHERE email_marketing_consent) as marketing_consent_count
FROM shopify_customers
GROUP BY customer_type;

-- Geographic revenue aggregation
CREATE OR REPLACE VIEW geographic_revenue_summary AS
SELECT
  shipping_province_code as province_code,
  shipping_province as province_name,
  shipping_country_code as country_code,
  COUNT(*) as order_count,
  SUM(total_price) as total_revenue,
  COUNT(DISTINCT shopify_customer_id) as unique_customers,
  AVG(total_price) as avg_order_value
FROM orders
WHERE canceled = FALSE
  AND total_price > 0
  AND shipping_province_code IS NOT NULL
GROUP BY shipping_province_code, shipping_province, shipping_country_code;

-- New vs Returning by month
CREATE OR REPLACE VIEW new_vs_returning_monthly AS
SELECT
  DATE_TRUNC('month', created_at)::DATE as month,
  COUNT(*) FILTER (WHERE is_first_order = TRUE) as new_customer_orders,
  COUNT(*) FILTER (WHERE is_first_order = FALSE OR is_first_order IS NULL) as returning_customer_orders,
  SUM(total_price) FILTER (WHERE is_first_order = TRUE) as new_customer_revenue,
  SUM(total_price) FILTER (WHERE is_first_order = FALSE OR is_first_order IS NULL) as returning_customer_revenue,
  COUNT(DISTINCT shopify_customer_id) FILTER (WHERE is_first_order = TRUE) as new_customers,
  COUNT(DISTINCT shopify_customer_id) FILTER (WHERE is_first_order = FALSE OR is_first_order IS NULL) as returning_customers
FROM orders
WHERE canceled = FALSE
  AND total_price > 0
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;

-- ============================================================================
-- 7. RPC FUNCTIONS
-- ============================================================================

-- Function to compute customer type based on order history
CREATE OR REPLACE FUNCTION compute_customer_type(
  p_days_since_last_order INTEGER,
  p_total_spent DECIMAL,
  p_orders_count INTEGER,
  p_vip_threshold DECIMAL DEFAULT 1000
)
RETURNS TEXT AS $$
BEGIN
  -- VIP: top spenders regardless of recency
  IF p_total_spent >= p_vip_threshold AND p_orders_count >= 3 THEN
    RETURN 'vip';
  END IF;

  -- New: first order within last 90 days
  IF p_orders_count <= 1 AND (p_days_since_last_order IS NULL OR p_days_since_last_order <= 90) THEN
    RETURN 'new';
  END IF;

  -- Active: ordered within last 180 days
  IF p_days_since_last_order IS NOT NULL AND p_days_since_last_order <= 180 THEN
    RETURN 'active';
  END IF;

  -- At Risk: 180-365 days since last order
  IF p_days_since_last_order IS NOT NULL AND p_days_since_last_order <= 365 THEN
    RETURN 'at_risk';
  END IF;

  -- Churned: 365+ days since last order
  RETURN 'churned';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to update customer metrics after sync
CREATE OR REPLACE FUNCTION update_customer_computed_fields()
RETURNS void AS $$
BEGIN
  UPDATE shopify_customers
  SET
    days_since_last_order = CASE
      WHEN last_order_date IS NOT NULL
      THEN EXTRACT(DAY FROM NOW() - last_order_date)::INTEGER
      ELSE NULL
    END,
    acquisition_cohort = CASE
      WHEN first_order_date IS NOT NULL
      THEN TO_CHAR(first_order_date, 'YYYY-MM')
      ELSE TO_CHAR(shopify_created_at, 'YYYY-MM')
    END,
    customer_type = compute_customer_type(
      EXTRACT(DAY FROM NOW() - last_order_date)::INTEGER,
      total_spent,
      orders_count
    ),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON shopify_customers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON abandoned_checkouts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON customer_cohorts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON daily_ecommerce_stats TO service_role;
GRANT SELECT ON customer_segments_summary TO service_role;
GRANT SELECT ON geographic_revenue_summary TO service_role;
GRANT SELECT ON new_vs_returning_monthly TO service_role;
GRANT EXECUTE ON FUNCTION compute_customer_type TO service_role;
GRANT EXECUTE ON FUNCTION update_customer_computed_fields TO service_role;

-- Grant sequence permissions for auto-increment
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
