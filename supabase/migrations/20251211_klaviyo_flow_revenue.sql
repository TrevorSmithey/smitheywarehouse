-- Add flow revenue and subscriber tracking to Klaviyo monthly stats
-- Run this in Supabase SQL editor

-- Add flow revenue columns to monthly stats
ALTER TABLE klaviyo_monthly_stats
ADD COLUMN IF NOT EXISTS flow_revenue DECIMAL(12, 2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS flow_conversions INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS subscribers_120day INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS subscribers_365day INTEGER DEFAULT 0;

-- Drop SMS columns (not used)
ALTER TABLE klaviyo_monthly_stats
DROP COLUMN IF EXISTS sms_campaigns_sent,
DROP COLUMN IF EXISTS sms_recipients,
DROP COLUMN IF EXISTS sms_delivered,
DROP COLUMN IF EXISTS sms_clicks,
DROP COLUMN IF EXISTS sms_conversions,
DROP COLUMN IF EXISTS sms_revenue,
DROP COLUMN IF EXISTS sms_credits_used,
DROP COLUMN IF EXISTS sms_spend;

-- Update total_revenue calculation to include flows
COMMENT ON COLUMN klaviyo_monthly_stats.total_revenue IS 'email_revenue + flow_revenue';

-- Add index for faster monthly queries
CREATE INDEX IF NOT EXISTS idx_klaviyo_monthly_month ON klaviyo_monthly_stats(month_start DESC);
