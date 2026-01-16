-- =============================================================================
-- PAID MEDIA DECISION ENGINE SCHEMA
-- =============================================================================
-- Enables MER (Marketing Efficiency Ratio), nCAC tracking, creative fatigue
-- detection, and agency accountability metrics from Meta & Google Ads.
--
-- Key Design Decisions:
-- 1. Platform-specific tables (not unified) - Meta and Google have genuinely
--    different metrics (reach/frequency vs search_impression_share)
-- 2. Store raw platform data during sync, compute MER/nCAC by joining with
--    existing daily_stats and orders tables
-- 3. Pre-aggregate daily/monthly for fast dashboard queries
-- 4. Historical depth: 37 months Meta, 3+ years Google
-- =============================================================================

-- =============================================================================
-- META ADS TABLES
-- =============================================================================

-- meta_campaigns: Daily campaign performance from Meta Marketing API
CREATE TABLE IF NOT EXISTS meta_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT,                          -- ACTIVE, PAUSED, DELETED
  objective TEXT,                       -- CONVERSIONS, TRAFFIC, AWARENESS, etc.
  date DATE NOT NULL,

  -- Core metrics (raw from API)
  spend NUMERIC(12,2) DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  reach BIGINT DEFAULT 0,
  frequency NUMERIC(6,2),
  clicks BIGINT DEFAULT 0,

  -- Calculated rates (from API)
  ctr NUMERIC(8,6),
  cpc NUMERIC(10,4),
  cpm NUMERIC(10,4),

  -- Conversions (Meta Pixel/CAPI attributed)
  purchases INTEGER DEFAULT 0,
  purchase_value NUMERIC(12,2) DEFAULT 0,
  add_to_carts INTEGER DEFAULT 0,
  initiated_checkouts INTEGER DEFAULT 0,

  -- Platform-reported ROAS (for comparison to MER)
  platform_roas NUMERIC(8,4),

  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(meta_campaign_id, date)
);

-- Indexes for meta_campaigns
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_date ON meta_campaigns(date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_id ON meta_campaigns(meta_campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_status ON meta_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_objective ON meta_campaigns(objective);

COMMENT ON TABLE meta_campaigns IS 'Daily campaign performance from Meta Marketing API. Key for spend tracking and platform ROAS comparison.';


-- meta_ads: Ad-level data for creative performance tracking
CREATE TABLE IF NOT EXISTS meta_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_ad_id TEXT NOT NULL,
  meta_adset_id TEXT,                   -- FK stored for future adset analysis
  meta_campaign_id TEXT NOT NULL,
  ad_name TEXT,
  adset_name TEXT,
  campaign_name TEXT,
  date DATE NOT NULL,

  -- Creative metadata
  creative_type TEXT,                   -- IMAGE, VIDEO, CAROUSEL
  thumbnail_url TEXT,

  -- Performance metrics
  spend NUMERIC(12,2) DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  ctr NUMERIC(8,6),
  purchases INTEGER DEFAULT 0,
  purchase_value NUMERIC(12,2) DEFAULT 0,

  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(meta_ad_id, date)
);

-- Indexes for meta_ads
CREATE INDEX IF NOT EXISTS idx_meta_ads_date ON meta_ads(date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_ads_id ON meta_ads(meta_ad_id);
CREATE INDEX IF NOT EXISTS idx_meta_ads_campaign ON meta_ads(meta_campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_ads_creative_type ON meta_ads(creative_type);

COMMENT ON TABLE meta_ads IS 'Ad-level performance from Meta. Enables creative fatigue detection and top performer identification.';


-- meta_ad_creative_stats: Computed creative health (updated by cron)
CREATE TABLE IF NOT EXISTS meta_ad_creative_stats (
  meta_ad_id TEXT PRIMARY KEY,
  ad_name TEXT,
  campaign_name TEXT,
  thumbnail_url TEXT,
  creative_type TEXT,

  -- Lifetime totals
  lifetime_spend NUMERIC(14,2) DEFAULT 0,
  lifetime_impressions BIGINT DEFAULT 0,
  lifetime_purchases INTEGER DEFAULT 0,

  -- Peak performance (for fatigue detection)
  peak_ctr NUMERIC(8,6),
  peak_ctr_date DATE,

  -- Current performance (rolling 7-day)
  current_ctr NUMERIC(8,6),
  ctr_vs_peak NUMERIC(6,4),             -- current/peak (< 0.7 = fatigued)

  -- Fatigue status
  is_active BOOLEAN DEFAULT TRUE,       -- Had spend in last 7 days
  is_fatigued BOOLEAN DEFAULT FALSE,
  fatigue_severity TEXT,                -- 'high', 'medium', 'low'

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for creative stats
CREATE INDEX IF NOT EXISTS idx_meta_ad_stats_active ON meta_ad_creative_stats(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_meta_ad_stats_fatigued ON meta_ad_creative_stats(is_fatigued) WHERE is_fatigued = TRUE;
CREATE INDEX IF NOT EXISTS idx_meta_ad_stats_severity ON meta_ad_creative_stats(fatigue_severity);

COMMENT ON TABLE meta_ad_creative_stats IS 'Pre-computed creative health metrics. Updated daily by fatigue detection cron.';


-- =============================================================================
-- GOOGLE ADS TABLES
-- =============================================================================

-- google_campaigns: Daily campaign performance from Google Ads API
CREATE TABLE IF NOT EXISTS google_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT,                          -- ENABLED, PAUSED, REMOVED
  campaign_type TEXT,                   -- SEARCH, SHOPPING, DISPLAY, PERFORMANCE_MAX, VIDEO
  date DATE NOT NULL,

  -- Core metrics (spend converted from cost_micros)
  spend NUMERIC(12,2) DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,

  -- Rates
  ctr NUMERIC(8,6),
  cpc NUMERIC(10,4),
  cpm NUMERIC(10,4),

  -- Conversions
  conversions NUMERIC(10,2) DEFAULT 0,
  conversion_value NUMERIC(12,2) DEFAULT 0,
  cost_per_conversion NUMERIC(10,4),

  -- Search competitive metrics (Google-specific)
  search_impression_share NUMERIC(6,4),
  search_rank_lost_impression_share NUMERIC(6,4),

  -- Platform-reported ROAS
  platform_roas NUMERIC(8,4),

  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(google_campaign_id, date)
);

-- Indexes for google_campaigns
CREATE INDEX IF NOT EXISTS idx_google_campaigns_date ON google_campaigns(date DESC);
CREATE INDEX IF NOT EXISTS idx_google_campaigns_id ON google_campaigns(google_campaign_id);
CREATE INDEX IF NOT EXISTS idx_google_campaigns_type ON google_campaigns(campaign_type);
CREATE INDEX IF NOT EXISTS idx_google_campaigns_status ON google_campaigns(status);

COMMENT ON TABLE google_campaigns IS 'Daily campaign performance from Google Ads API. Includes Search-specific competitive metrics.';


-- =============================================================================
-- AGGREGATION TABLES
-- =============================================================================

-- ad_daily_stats: Daily totals for trend charts and MER/nCAC calculation
CREATE TABLE IF NOT EXISTS ad_daily_stats (
  date DATE PRIMARY KEY,

  -- Meta totals
  meta_spend NUMERIC(12,2) DEFAULT 0,
  meta_impressions BIGINT DEFAULT 0,
  meta_clicks BIGINT DEFAULT 0,
  meta_purchases INTEGER DEFAULT 0,
  meta_revenue NUMERIC(12,2) DEFAULT 0,

  -- Google totals
  google_spend NUMERIC(12,2) DEFAULT 0,
  google_impressions BIGINT DEFAULT 0,
  google_clicks BIGINT DEFAULT 0,
  google_conversions NUMERIC(10,2) DEFAULT 0,
  google_revenue NUMERIC(12,2) DEFAULT 0,

  -- Combined spend
  total_spend NUMERIC(12,2) DEFAULT 0,

  -- Joined with Shopify (from daily_stats table)
  shopify_revenue NUMERIC(14,2),
  new_customer_count INTEGER,

  -- THE TRUTH: Calculated from real data, not platform attribution
  mer NUMERIC(8,4),                     -- shopify_revenue / total_spend
  ncac NUMERIC(10,2),                   -- total_spend / new_customer_count

  computed_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE ad_daily_stats IS 'Daily aggregated ad performance. MER and nCAC calculated by joining with Shopify data.';


-- ad_monthly_stats: Monthly rollups for period comparisons
CREATE TABLE IF NOT EXISTS ad_monthly_stats (
  month_start DATE PRIMARY KEY,

  -- Meta totals
  meta_spend NUMERIC(14,2) DEFAULT 0,
  meta_impressions BIGINT DEFAULT 0,
  meta_clicks BIGINT DEFAULT 0,
  meta_purchases INTEGER DEFAULT 0,
  meta_revenue NUMERIC(14,2) DEFAULT 0,

  -- Google totals
  google_spend NUMERIC(14,2) DEFAULT 0,
  google_impressions BIGINT DEFAULT 0,
  google_clicks BIGINT DEFAULT 0,
  google_conversions NUMERIC(10,2) DEFAULT 0,
  google_revenue NUMERIC(14,2) DEFAULT 0,

  -- Combined
  total_spend NUMERIC(14,2) DEFAULT 0,

  -- Shopify data
  shopify_revenue NUMERIC(16,2),
  new_customer_count INTEGER,

  -- THE TRUTH
  mer NUMERIC(8,4),
  ncac NUMERIC(10,2),
  blended_cpa NUMERIC(10,2),            -- total_spend / (meta_purchases + google_conversions)

  -- Period comparison
  mer_mom_change NUMERIC(6,4),          -- vs prior month
  ncac_mom_change NUMERIC(6,4),

  computed_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE ad_monthly_stats IS 'Monthly rollups for fast period comparison. Includes MoM change calculations.';


-- =============================================================================
-- BUDGET & ALERTS
-- =============================================================================

-- ad_budgets: Manual budget input (agency-managed budgets)
CREATE TABLE IF NOT EXISTS ad_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month DATE NOT NULL,
  channel TEXT NOT NULL,                -- 'meta', 'google'
  budget_amount NUMERIC(12,2) NOT NULL,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(month, channel)
);

CREATE INDEX IF NOT EXISTS idx_ad_budgets_month ON ad_budgets(month DESC);

COMMENT ON TABLE ad_budgets IS 'Monthly budgets by channel. Entered manually for pacing calculations.';


-- ad_alerts: Surfaced insights and anomalies
CREATE TABLE IF NOT EXISTS ad_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,             -- creative_fatigue, budget_pacing, cpm_spike, mer_decline, ncac_high
  severity TEXT NOT NULL,               -- critical, warning, info
  channel TEXT,                         -- meta, google, null for blended
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  metric_value TEXT,
  action_recommended TEXT,
  entity_id TEXT,                       -- campaign_id or ad_id if applicable
  entity_name TEXT,
  is_dismissed BOOLEAN DEFAULT FALSE,
  dismissed_by TEXT,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ                -- Auto-expire stale alerts
);

-- Indexes for alerts
CREATE INDEX IF NOT EXISTS idx_ad_alerts_active ON ad_alerts(created_at DESC) WHERE NOT is_dismissed;
CREATE INDEX IF NOT EXISTS idx_ad_alerts_type ON ad_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_ad_alerts_severity ON ad_alerts(severity);

COMMENT ON TABLE ad_alerts IS 'Decision engine alerts: MER decline, creative fatigue, budget pacing, etc.';


-- =============================================================================
-- SYNC TRACKING
-- =============================================================================

-- ad_sync_logs: Track sync job execution (follows existing sync_logs pattern)
CREATE TABLE IF NOT EXISTS ad_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type TEXT NOT NULL,              -- 'meta', 'google', 'compute_metrics'
  status TEXT NOT NULL,                 -- 'running', 'completed', 'failed'
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  records_synced INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB                        -- Additional context (date range, etc.)
);

CREATE INDEX IF NOT EXISTS idx_ad_sync_logs_type ON ad_sync_logs(sync_type, started_at DESC);

COMMENT ON TABLE ad_sync_logs IS 'Sync job execution tracking for debugging and monitoring.';


-- =============================================================================
-- HELPER VIEWS
-- =============================================================================

-- Channel comparison view for quick API access
CREATE OR REPLACE VIEW channel_comparison AS
SELECT
  'meta' as channel,
  SUM(spend) as total_spend,
  SUM(impressions) as total_impressions,
  SUM(clicks) as total_clicks,
  AVG(ctr) as avg_ctr,
  AVG(cpm) as avg_cpm,
  SUM(purchases) as total_conversions,
  SUM(purchase_value) as total_revenue,
  CASE WHEN SUM(spend) > 0 THEN SUM(purchase_value) / SUM(spend) ELSE NULL END as platform_roas,
  CASE WHEN SUM(purchases) > 0 THEN SUM(spend) / SUM(purchases) ELSE NULL END as cpa
FROM meta_campaigns
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
UNION ALL
SELECT
  'google' as channel,
  SUM(spend) as total_spend,
  SUM(impressions) as total_impressions,
  SUM(clicks) as total_clicks,
  AVG(ctr) as avg_ctr,
  AVG(cpm) as avg_cpm,
  SUM(conversions) as total_conversions,
  SUM(conversion_value) as total_revenue,
  CASE WHEN SUM(spend) > 0 THEN SUM(conversion_value) / SUM(spend) ELSE NULL END as platform_roas,
  CASE WHEN SUM(conversions) > 0 THEN SUM(spend) / SUM(conversions) ELSE NULL END as cpa
FROM google_campaigns
WHERE date >= CURRENT_DATE - INTERVAL '30 days';

COMMENT ON VIEW channel_comparison IS 'Quick comparison of last 30 days performance by channel.';


-- Fatigued creatives view
CREATE OR REPLACE VIEW fatigued_creatives AS
SELECT
  meta_ad_id,
  ad_name,
  campaign_name,
  thumbnail_url,
  creative_type,
  lifetime_spend,
  peak_ctr,
  current_ctr,
  ctr_vs_peak,
  fatigue_severity,
  updated_at
FROM meta_ad_creative_stats
WHERE is_active = TRUE
  AND is_fatigued = TRUE
ORDER BY
  CASE fatigue_severity
    WHEN 'high' THEN 1
    WHEN 'medium' THEN 2
    WHEN 'low' THEN 3
  END,
  lifetime_spend DESC;

COMMENT ON VIEW fatigued_creatives IS 'Active ads showing creative fatigue, ordered by severity and spend.';


-- =============================================================================
-- RPC FUNCTIONS
-- =============================================================================

-- Function to compute MER for a date range
CREATE OR REPLACE FUNCTION compute_mer(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS NUMERIC AS $$
DECLARE
  v_shopify_revenue NUMERIC;
  v_total_spend NUMERIC;
BEGIN
  -- Get Shopify revenue from daily_stats
  SELECT COALESCE(SUM(total_revenue), 0)
  INTO v_shopify_revenue
  FROM daily_stats
  WHERE date BETWEEN p_start_date AND p_end_date;

  -- Get total ad spend from ad_daily_stats
  SELECT COALESCE(SUM(total_spend), 0)
  INTO v_total_spend
  FROM ad_daily_stats
  WHERE date BETWEEN p_start_date AND p_end_date;

  -- Return MER (or NULL if no spend)
  IF v_total_spend > 0 THEN
    RETURN v_shopify_revenue / v_total_spend;
  ELSE
    RETURN NULL;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION compute_mer IS 'Calculate Marketing Efficiency Ratio for a date range.';


-- Function to compute nCAC for a date range
CREATE OR REPLACE FUNCTION compute_ncac(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS NUMERIC AS $$
DECLARE
  v_total_spend NUMERIC;
  v_new_customers INTEGER;
BEGIN
  -- Get total ad spend
  SELECT COALESCE(SUM(total_spend), 0)
  INTO v_total_spend
  FROM ad_daily_stats
  WHERE date BETWEEN p_start_date AND p_end_date;

  -- Count new customers (first orders in period)
  SELECT COUNT(DISTINCT shopify_customer_id)
  INTO v_new_customers
  FROM orders
  WHERE is_first_order = TRUE
    AND canceled = FALSE
    AND DATE(created_at) BETWEEN p_start_date AND p_end_date;

  -- Return nCAC (or NULL if no new customers)
  IF v_new_customers > 0 THEN
    RETURN v_total_spend / v_new_customers;
  ELSE
    RETURN NULL;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION compute_ncac IS 'Calculate New Customer Acquisition Cost for a date range.';


-- Function to update ad_daily_stats with Shopify data and compute MER/nCAC
CREATE OR REPLACE FUNCTION update_ad_daily_metrics(p_date DATE)
RETURNS void AS $$
DECLARE
  v_shopify_revenue NUMERIC;
  v_new_customers INTEGER;
  v_total_spend NUMERIC;
BEGIN
  -- Get Shopify revenue for this date
  SELECT COALESCE(total_revenue, 0)
  INTO v_shopify_revenue
  FROM daily_stats
  WHERE date = p_date;

  -- Count new customers for this date
  SELECT COUNT(DISTINCT shopify_customer_id)
  INTO v_new_customers
  FROM orders
  WHERE is_first_order = TRUE
    AND canceled = FALSE
    AND DATE(created_at) = p_date;

  -- Get total ad spend for this date
  SELECT COALESCE(total_spend, 0)
  INTO v_total_spend
  FROM ad_daily_stats
  WHERE date = p_date;

  -- Update ad_daily_stats with Shopify data and computed metrics
  UPDATE ad_daily_stats
  SET
    shopify_revenue = v_shopify_revenue,
    new_customer_count = v_new_customers,
    mer = CASE WHEN total_spend > 0 THEN v_shopify_revenue / total_spend ELSE NULL END,
    ncac = CASE WHEN v_new_customers > 0 THEN total_spend / v_new_customers ELSE NULL END,
    computed_at = NOW()
  WHERE date = p_date;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_ad_daily_metrics IS 'Update daily stats with Shopify data and compute MER/nCAC.';


-- Function to detect creative fatigue
CREATE OR REPLACE FUNCTION detect_creative_fatigue(
  p_fatigue_threshold NUMERIC DEFAULT 0.65  -- CTR dropped to 65% of peak = fatigued
)
RETURNS INTEGER AS $$
DECLARE
  v_updated_count INTEGER := 0;
BEGIN
  -- Update creative stats with current performance
  WITH recent_performance AS (
    SELECT
      meta_ad_id,
      SUM(spend) as recent_spend,
      AVG(ctr) as recent_ctr
    FROM meta_ads
    WHERE date >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY meta_ad_id
    HAVING SUM(spend) >= 50  -- Minimum $50 spend in last 7 days
  )
  UPDATE meta_ad_creative_stats s
  SET
    is_active = rp.meta_ad_id IS NOT NULL,
    current_ctr = COALESCE(rp.recent_ctr, s.current_ctr),
    ctr_vs_peak = CASE
      WHEN s.peak_ctr > 0 AND rp.recent_ctr IS NOT NULL
      THEN rp.recent_ctr / s.peak_ctr
      ELSE NULL
    END,
    is_fatigued = CASE
      WHEN s.peak_ctr > 0 AND rp.recent_ctr IS NOT NULL
      THEN rp.recent_ctr / s.peak_ctr < p_fatigue_threshold
      ELSE FALSE
    END,
    fatigue_severity = CASE
      WHEN s.peak_ctr > 0 AND rp.recent_ctr IS NOT NULL THEN
        CASE
          WHEN rp.recent_ctr / s.peak_ctr < 0.50 THEN 'high'
          WHEN rp.recent_ctr / s.peak_ctr < 0.65 THEN 'medium'
          WHEN rp.recent_ctr / s.peak_ctr < 0.75 THEN 'low'
          ELSE NULL
        END
      ELSE NULL
    END,
    updated_at = NOW()
  FROM recent_performance rp
  WHERE s.meta_ad_id = rp.meta_ad_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION detect_creative_fatigue IS 'Detect and flag creatives showing fatigue based on CTR decline from peak.';


-- =============================================================================
-- PERMISSIONS
-- =============================================================================

-- Grant permissions to service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON meta_campaigns TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON meta_ads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON meta_ad_creative_stats TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON google_campaigns TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ad_daily_stats TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ad_monthly_stats TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ad_budgets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ad_alerts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ad_sync_logs TO service_role;

GRANT SELECT ON channel_comparison TO service_role;
GRANT SELECT ON fatigued_creatives TO service_role;

GRANT EXECUTE ON FUNCTION compute_mer TO service_role;
GRANT EXECUTE ON FUNCTION compute_ncac TO service_role;
GRANT EXECUTE ON FUNCTION update_ad_daily_metrics TO service_role;
GRANT EXECUTE ON FUNCTION detect_creative_fatigue TO service_role;

-- Grant sequence permissions for auto-increment UUIDs
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
