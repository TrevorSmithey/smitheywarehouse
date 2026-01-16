-- ============================================================================
-- Atomic Upsert Functions for ad_daily_stats
--
-- Solves race condition: When sync-meta and sync-google-ads run concurrently,
-- they previously read-modify-write the entire row, causing the last writer
-- to overwrite the other platform's data.
--
-- These functions atomically update only their platform's columns while
-- preserving the other platform's data using COALESCE.
-- ============================================================================

-- Function for Meta sync to update only Meta columns
CREATE OR REPLACE FUNCTION upsert_ad_daily_stats_meta(
  p_date DATE,
  p_meta_spend NUMERIC,
  p_meta_impressions BIGINT,
  p_meta_clicks BIGINT,
  p_meta_purchases INTEGER,
  p_meta_revenue NUMERIC
) RETURNS void AS $$
BEGIN
  INSERT INTO ad_daily_stats (
    date,
    meta_spend,
    meta_impressions,
    meta_clicks,
    meta_purchases,
    meta_revenue,
    google_spend,
    google_impressions,
    google_clicks,
    google_conversions,
    google_revenue,
    total_spend,
    computed_at
  ) VALUES (
    p_date,
    p_meta_spend,
    p_meta_impressions,
    p_meta_clicks,
    p_meta_purchases,
    p_meta_revenue,
    0, -- google defaults
    0,
    0,
    0,
    0,
    p_meta_spend, -- total_spend = meta only initially
    NOW()
  )
  ON CONFLICT (date) DO UPDATE SET
    meta_spend = EXCLUDED.meta_spend,
    meta_impressions = EXCLUDED.meta_impressions,
    meta_clicks = EXCLUDED.meta_clicks,
    meta_purchases = EXCLUDED.meta_purchases,
    meta_revenue = EXCLUDED.meta_revenue,
    -- Preserve Google data, recalculate total
    total_spend = EXCLUDED.meta_spend + COALESCE(ad_daily_stats.google_spend, 0),
    computed_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Function for Google sync to update only Google columns
CREATE OR REPLACE FUNCTION upsert_ad_daily_stats_google(
  p_date DATE,
  p_google_spend NUMERIC,
  p_google_impressions BIGINT,
  p_google_clicks BIGINT,
  p_google_conversions NUMERIC,
  p_google_revenue NUMERIC
) RETURNS void AS $$
BEGIN
  INSERT INTO ad_daily_stats (
    date,
    meta_spend,
    meta_impressions,
    meta_clicks,
    meta_purchases,
    meta_revenue,
    google_spend,
    google_impressions,
    google_clicks,
    google_conversions,
    google_revenue,
    total_spend,
    computed_at
  ) VALUES (
    p_date,
    0, -- meta defaults
    0,
    0,
    0,
    0,
    p_google_spend,
    p_google_impressions,
    p_google_clicks,
    p_google_conversions,
    p_google_revenue,
    p_google_spend, -- total_spend = google only initially
    NOW()
  )
  ON CONFLICT (date) DO UPDATE SET
    google_spend = EXCLUDED.google_spend,
    google_impressions = EXCLUDED.google_impressions,
    google_clicks = EXCLUDED.google_clicks,
    google_conversions = EXCLUDED.google_conversions,
    google_revenue = EXCLUDED.google_revenue,
    -- Preserve Meta data, recalculate total
    total_spend = COALESCE(ad_daily_stats.meta_spend, 0) + EXCLUDED.google_spend,
    computed_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Add recommended indexes for performance
CREATE INDEX IF NOT EXISTS idx_ad_daily_stats_date ON ad_daily_stats(date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_date ON meta_campaigns(date DESC);
CREATE INDEX IF NOT EXISTS idx_google_campaigns_date ON google_campaigns(date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_campaign_date ON meta_campaigns(meta_campaign_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_google_campaigns_campaign_date ON google_campaigns(google_campaign_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_meta_ad_creative_stats_active ON meta_ad_creative_stats(is_active, lifetime_spend DESC) WHERE is_active = true;
