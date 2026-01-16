-- Fix: Use case-insensitive status comparison in calculate_klaviyo_period_stats
-- The Klaviyo API returns 'Sent' (capitalized) but we were checking for 'sent' (lowercase)

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
      AND LOWER(kc.status) = 'sent'
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
      AND LOWER(kc.status) = 'sent'
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
