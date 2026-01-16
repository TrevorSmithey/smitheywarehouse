-- Migration: Klaviyo Marketing Integration
-- Created: 2025-12-11
-- Purpose: Store email/SMS campaign performance data for month-end reporting and inventory planning

-- ============================================================
-- Table: klaviyo_campaigns
-- Stores synced campaign data with performance metrics
-- ============================================================
CREATE TABLE IF NOT EXISTS klaviyo_campaigns (
  id SERIAL PRIMARY KEY,
  klaviyo_id TEXT UNIQUE NOT NULL,           -- Klaviyo's campaign ID
  name TEXT NOT NULL,
  channel TEXT NOT NULL,                      -- 'email' | 'sms'
  status TEXT,                                -- 'draft' | 'scheduled' | 'sent' | 'cancelled'
  send_time TIMESTAMPTZ,

  -- Audience
  recipients INTEGER DEFAULT 0,

  -- Delivery metrics
  delivered INTEGER DEFAULT 0,
  bounces INTEGER DEFAULT 0,

  -- Engagement metrics
  opens INTEGER DEFAULT 0,
  unique_opens INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  unique_clicks INTEGER DEFAULT 0,
  unsubscribes INTEGER DEFAULT 0,

  -- Conversion metrics
  conversions INTEGER DEFAULT 0,
  conversion_value NUMERIC(12, 2) DEFAULT 0,

  -- Calculated rates (stored for fast queries)
  open_rate NUMERIC(5, 4),                    -- e.g., 0.4523 = 45.23%
  click_rate NUMERIC(5, 4),
  conversion_rate NUMERIC(5, 4),

  -- SMS-specific
  sms_credits_used INTEGER,
  sms_spend NUMERIC(10, 2),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_klaviyo_campaigns_send_time ON klaviyo_campaigns(send_time DESC);
CREATE INDEX IF NOT EXISTS idx_klaviyo_campaigns_channel ON klaviyo_campaigns(channel);
CREATE INDEX IF NOT EXISTS idx_klaviyo_campaigns_status ON klaviyo_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_klaviyo_campaigns_klaviyo_id ON klaviyo_campaigns(klaviyo_id);

-- ============================================================
-- Table: klaviyo_flows
-- Stores automation/flow performance data
-- ============================================================
CREATE TABLE IF NOT EXISTS klaviyo_flows (
  id SERIAL PRIMARY KEY,
  klaviyo_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  status TEXT,                                -- 'live' | 'draft' | 'manual'
  trigger_type TEXT,                          -- e.g., 'Placed Order', 'Abandoned Cart'

  -- Lifetime metrics (updated each sync)
  total_recipients INTEGER DEFAULT 0,
  total_conversions INTEGER DEFAULT 0,
  total_revenue NUMERIC(12, 2) DEFAULT 0,
  conversion_rate NUMERIC(5, 4),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_klaviyo_flows_status ON klaviyo_flows(status);
CREATE INDEX IF NOT EXISTS idx_klaviyo_flows_klaviyo_id ON klaviyo_flows(klaviyo_id);

-- ============================================================
-- Table: klaviyo_monthly_stats
-- Pre-aggregated monthly rollups for fast month-end reporting
-- ============================================================
CREATE TABLE IF NOT EXISTS klaviyo_monthly_stats (
  id SERIAL PRIMARY KEY,
  month_start DATE NOT NULL UNIQUE,           -- First day of month (e.g., 2025-12-01)

  -- Email campaign metrics
  email_campaigns_sent INTEGER DEFAULT 0,
  email_recipients INTEGER DEFAULT 0,
  email_delivered INTEGER DEFAULT 0,
  email_opens INTEGER DEFAULT 0,
  email_clicks INTEGER DEFAULT 0,
  email_conversions INTEGER DEFAULT 0,
  email_revenue NUMERIC(12, 2) DEFAULT 0,
  email_unsubscribes INTEGER DEFAULT 0,
  email_avg_open_rate NUMERIC(5, 4),
  email_avg_click_rate NUMERIC(5, 4),

  -- SMS campaign metrics
  sms_campaigns_sent INTEGER DEFAULT 0,
  sms_recipients INTEGER DEFAULT 0,
  sms_delivered INTEGER DEFAULT 0,
  sms_clicks INTEGER DEFAULT 0,
  sms_conversions INTEGER DEFAULT 0,
  sms_revenue NUMERIC(12, 2) DEFAULT 0,
  sms_credits_used INTEGER DEFAULT 0,
  sms_spend NUMERIC(10, 2) DEFAULT 0,

  -- Flow metrics (lifetime snapshot at month end)
  flow_total_revenue NUMERIC(12, 2) DEFAULT 0,
  flow_total_conversions INTEGER DEFAULT 0,

  -- Combined totals
  total_revenue NUMERIC(12, 2) DEFAULT 0,
  total_conversions INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_klaviyo_monthly_month ON klaviyo_monthly_stats(month_start DESC);

-- ============================================================
-- Table: klaviyo_scheduled_campaigns
-- Upcoming campaigns for inventory planning
-- ============================================================
CREATE TABLE IF NOT EXISTS klaviyo_scheduled_campaigns (
  id SERIAL PRIMARY KEY,
  klaviyo_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,                      -- 'email' | 'sms'
  scheduled_time TIMESTAMPTZ NOT NULL,
  audience_size INTEGER,                      -- Estimated list/segment size
  subject_line TEXT,

  -- Predicted impact (calculated from historical averages)
  predicted_opens INTEGER,
  predicted_conversions INTEGER,
  predicted_revenue NUMERIC(12, 2),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_klaviyo_scheduled_time ON klaviyo_scheduled_campaigns(scheduled_time ASC);

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE klaviyo_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE klaviyo_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE klaviyo_monthly_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE klaviyo_scheduled_campaigns ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access" ON klaviyo_campaigns
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON klaviyo_flows
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON klaviyo_monthly_stats
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON klaviyo_scheduled_campaigns
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Anon/authenticated read access
CREATE POLICY "Allow read access" ON klaviyo_campaigns
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow read access" ON klaviyo_flows
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow read access" ON klaviyo_monthly_stats
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow read access" ON klaviyo_scheduled_campaigns
  FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- RPC Functions for Dashboard Queries
-- ============================================================

-- Get monthly summary for a date range
CREATE OR REPLACE FUNCTION get_klaviyo_monthly_summary(
  p_start_month DATE,
  p_end_month DATE
)
RETURNS TABLE (
  month_start DATE,
  email_campaigns_sent INTEGER,
  email_revenue NUMERIC,
  email_avg_open_rate NUMERIC,
  email_avg_click_rate NUMERIC,
  sms_campaigns_sent INTEGER,
  sms_revenue NUMERIC,
  total_revenue NUMERIC,
  total_conversions INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    kms.month_start,
    kms.email_campaigns_sent,
    kms.email_revenue,
    kms.email_avg_open_rate,
    kms.email_avg_click_rate,
    kms.sms_campaigns_sent,
    kms.sms_revenue,
    kms.total_revenue,
    kms.total_conversions
  FROM klaviyo_monthly_stats kms
  WHERE kms.month_start >= p_start_month
    AND kms.month_start <= p_end_month
  ORDER BY kms.month_start DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get recent campaign performance
CREATE OR REPLACE FUNCTION get_klaviyo_recent_campaigns(
  p_days_back INTEGER DEFAULT 30,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  klaviyo_id TEXT,
  name TEXT,
  channel TEXT,
  send_time TIMESTAMPTZ,
  recipients INTEGER,
  open_rate NUMERIC,
  click_rate NUMERIC,
  conversion_rate NUMERIC,
  conversion_value NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.klaviyo_id,
    kc.name,
    kc.channel,
    kc.send_time,
    kc.recipients,
    kc.open_rate,
    kc.click_rate,
    kc.conversion_rate,
    kc.conversion_value
  FROM klaviyo_campaigns kc
  WHERE kc.send_time >= NOW() - (p_days_back || ' days')::INTERVAL
    AND kc.status = 'sent'
  ORDER BY kc.send_time DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get upcoming scheduled campaigns
CREATE OR REPLACE FUNCTION get_klaviyo_upcoming_campaigns(
  p_days_ahead INTEGER DEFAULT 14
)
RETURNS TABLE (
  klaviyo_id TEXT,
  name TEXT,
  channel TEXT,
  scheduled_time TIMESTAMPTZ,
  audience_size INTEGER,
  predicted_revenue NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ksc.klaviyo_id,
    ksc.name,
    ksc.channel,
    ksc.scheduled_time,
    ksc.audience_size,
    ksc.predicted_revenue
  FROM klaviyo_scheduled_campaigns ksc
  WHERE ksc.scheduled_time >= NOW()
    AND ksc.scheduled_time <= NOW() + (p_days_ahead || ' days')::INTERVAL
  ORDER BY ksc.scheduled_time ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Calculate aggregate stats for a date range (used by cron to build monthly stats)
CREATE OR REPLACE FUNCTION calculate_klaviyo_period_stats(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  email_campaigns_sent BIGINT,
  email_recipients BIGINT,
  email_delivered BIGINT,
  email_opens BIGINT,
  email_clicks BIGINT,
  email_conversions BIGINT,
  email_revenue NUMERIC,
  email_unsubscribes BIGINT,
  email_avg_open_rate NUMERIC,
  email_avg_click_rate NUMERIC,
  sms_campaigns_sent BIGINT,
  sms_recipients BIGINT,
  sms_delivered BIGINT,
  sms_clicks BIGINT,
  sms_conversions BIGINT,
  sms_revenue NUMERIC,
  sms_credits_used BIGINT,
  sms_spend NUMERIC,
  total_revenue NUMERIC,
  total_conversions BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH email_stats AS (
    SELECT
      COUNT(*) AS campaigns,
      COALESCE(SUM(kc.recipients), 0) AS recipients,
      COALESCE(SUM(kc.delivered), 0) AS delivered,
      COALESCE(SUM(kc.opens), 0) AS opens,
      COALESCE(SUM(kc.clicks), 0) AS clicks,
      COALESCE(SUM(kc.conversions), 0) AS conversions,
      COALESCE(SUM(kc.conversion_value), 0) AS revenue,
      COALESCE(SUM(kc.unsubscribes), 0) AS unsubscribes,
      CASE WHEN SUM(kc.delivered) > 0
        THEN SUM(kc.opens)::NUMERIC / SUM(kc.delivered)
        ELSE 0 END AS avg_open_rate,
      CASE WHEN SUM(kc.opens) > 0
        THEN SUM(kc.clicks)::NUMERIC / SUM(kc.opens)
        ELSE 0 END AS avg_click_rate
    FROM klaviyo_campaigns kc
    WHERE kc.channel = 'email'
      AND kc.status = 'sent'
      AND kc.send_time >= p_start_date
      AND kc.send_time < p_end_date + INTERVAL '1 day'
  ),
  sms_stats AS (
    SELECT
      COUNT(*) AS campaigns,
      COALESCE(SUM(kc.recipients), 0) AS recipients,
      COALESCE(SUM(kc.delivered), 0) AS delivered,
      COALESCE(SUM(kc.clicks), 0) AS clicks,
      COALESCE(SUM(kc.conversions), 0) AS conversions,
      COALESCE(SUM(kc.conversion_value), 0) AS revenue,
      COALESCE(SUM(kc.sms_credits_used), 0) AS credits,
      COALESCE(SUM(kc.sms_spend), 0) AS spend
    FROM klaviyo_campaigns kc
    WHERE kc.channel = 'sms'
      AND kc.status = 'sent'
      AND kc.send_time >= p_start_date
      AND kc.send_time < p_end_date + INTERVAL '1 day'
  )
  SELECT
    e.campaigns,
    e.recipients,
    e.delivered,
    e.opens,
    e.clicks,
    e.conversions,
    e.revenue,
    e.unsubscribes,
    ROUND(e.avg_open_rate, 4),
    ROUND(e.avg_click_rate, 4),
    s.campaigns,
    s.recipients,
    s.delivered,
    s.clicks,
    s.conversions,
    s.revenue,
    s.credits,
    s.spend,
    e.revenue + s.revenue,
    e.conversions + s.conversions
  FROM email_stats e, sms_stats s;
END;
$$ LANGUAGE plpgsql STABLE;
