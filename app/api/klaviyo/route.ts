/**
 * Klaviyo Marketing API
 * Returns campaign performance data for month-end reporting and inventory planning
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type {
  KlaviyoResponse,
  KlaviyoCampaignSummary,
  KlaviyoMonthlySummary,
  KlaviyoUpcomingCampaign,
  KlaviyoFlow,
  KlaviyoStats,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const period = searchParams.get("period") || "mtd"; // mtd, last_month, qtd, ytd, 30d, 90d
    const channel = searchParams.get("channel"); // email, sms, or null for all

    // Calculate date range based on period
    const now = new Date();
    let rangeStart: Date;
    let rangeEnd: Date = now;
    let prevRangeStart: Date;
    let prevRangeEnd: Date;

    switch (period) {
      case "mtd":
        // Month to date
        rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
        prevRangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevRangeEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        break;
      case "last_month":
        // Previous full month
        rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        rangeEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        prevRangeStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        prevRangeEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59);
        break;
      case "qtd":
        // Quarter to date
        const currentQuarter = Math.floor(now.getMonth() / 3);
        rangeStart = new Date(now.getFullYear(), currentQuarter * 3, 1);
        prevRangeStart = new Date(now.getFullYear(), (currentQuarter - 1) * 3, 1);
        prevRangeEnd = new Date(now.getFullYear(), currentQuarter * 3, 0, 23, 59, 59);
        break;
      case "ytd":
        // Year to date
        rangeStart = new Date(now.getFullYear(), 0, 1);
        prevRangeStart = new Date(now.getFullYear() - 1, 0, 1);
        prevRangeEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 23, 59, 59);
        break;
      case "30d":
        rangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        prevRangeStart = new Date(rangeStart.getTime() - 30 * 24 * 60 * 60 * 1000);
        prevRangeEnd = new Date(rangeStart.getTime() - 1);
        break;
      case "90d":
        rangeStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        prevRangeStart = new Date(rangeStart.getTime() - 90 * 24 * 60 * 60 * 1000);
        prevRangeEnd = new Date(rangeStart.getTime() - 1);
        break;
      default:
        rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
        prevRangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevRangeEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    }

    // Execute all queries in parallel
    const [
      campaignsResult,
      prevCampaignsResult,
      monthlyResult,
      upcomingResult,
      flowsResult,
      lastSyncedResult,
    ] = await Promise.all([
      // Recent campaigns in period
      buildCampaignsQuery(supabase, rangeStart, rangeEnd, channel),
      // Previous period campaigns for comparison
      buildCampaignsQuery(supabase, prevRangeStart, prevRangeEnd, channel),
      // Monthly stats for trend chart (last 12 months)
      supabase
        .from("klaviyo_monthly_stats")
        .select("*")
        .order("month_start", { ascending: false })
        .limit(12),
      // Upcoming scheduled campaigns (next 14 days)
      supabase
        .from("klaviyo_scheduled_campaigns")
        .select("*")
        .gte("scheduled_time", now.toISOString())
        .order("scheduled_time", { ascending: true })
        .limit(20),
      // Flows
      supabase
        .from("klaviyo_flows")
        .select("*")
        .eq("status", "live")
        .order("total_revenue", { ascending: false }),
      // Last sync time
      supabase
        .from("klaviyo_campaigns")
        .select("last_synced_at")
        .order("last_synced_at", { ascending: false })
        .limit(1)
        .single(),
    ]);

    // Handle errors
    if (campaignsResult.error) throw campaignsResult.error;

    // Process campaigns
    const campaigns: KlaviyoCampaignSummary[] = (campaignsResult.data || []).map((c) => ({
      klaviyo_id: c.klaviyo_id,
      name: c.name,
      channel: c.channel,
      send_time: c.send_time,
      recipients: c.recipients || 0,
      delivered: c.delivered || 0,
      opens: c.opens || 0,
      clicks: c.clicks || 0,
      conversions: c.conversions || 0,
      conversion_value: c.conversion_value || 0,
      open_rate: c.open_rate,
      click_rate: c.click_rate,
      conversion_rate: c.conversion_rate,
      unsubscribes: c.unsubscribes || 0,
    }));

    // Process monthly stats
    const monthly: KlaviyoMonthlySummary[] = (monthlyResult.data || []).map((m) => ({
      month_start: m.month_start,
      email_campaigns_sent: m.email_campaigns_sent || 0,
      email_recipients: m.email_recipients || 0,
      email_delivered: m.email_delivered || 0,
      email_opens: m.email_opens || 0,
      email_clicks: m.email_clicks || 0,
      email_conversions: m.email_conversions || 0,
      email_revenue: parseFloat(m.email_revenue) || 0,
      email_unsubscribes: m.email_unsubscribes || 0,
      email_avg_open_rate: m.email_avg_open_rate,
      email_avg_click_rate: m.email_avg_click_rate,
      sms_campaigns_sent: m.sms_campaigns_sent || 0,
      sms_recipients: m.sms_recipients || 0,
      sms_delivered: m.sms_delivered || 0,
      sms_clicks: m.sms_clicks || 0,
      sms_conversions: m.sms_conversions || 0,
      sms_revenue: parseFloat(m.sms_revenue) || 0,
      sms_credits_used: m.sms_credits_used || 0,
      sms_spend: parseFloat(m.sms_spend) || 0,
      total_revenue: parseFloat(m.total_revenue) || 0,
      total_conversions: m.total_conversions || 0,
    }));

    // Process upcoming campaigns
    const upcoming: KlaviyoUpcomingCampaign[] = (upcomingResult.data || []).map((u) => ({
      klaviyo_id: u.klaviyo_id,
      name: u.name,
      channel: u.channel,
      scheduled_time: u.scheduled_time,
      audience_size: u.audience_size,
      predicted_opens: u.predicted_opens,
      predicted_conversions: u.predicted_conversions,
      predicted_revenue: u.predicted_revenue ? parseFloat(u.predicted_revenue) : null,
    }));

    // Process flows
    const flows: KlaviyoFlow[] = (flowsResult.data || []).map((f) => ({
      klaviyo_id: f.klaviyo_id,
      name: f.name,
      status: f.status,
      trigger_type: f.trigger_type,
      total_recipients: f.total_recipients || 0,
      total_conversions: f.total_conversions || 0,
      total_revenue: parseFloat(f.total_revenue) || 0,
      conversion_rate: f.conversion_rate,
    }));

    // Calculate summary stats for the period
    const currentCampaigns = campaignsResult.data || [];
    const prevCampaigns = prevCampaignsResult.data || [];

    const emailCampaigns = currentCampaigns.filter((c) => c.channel === "email");
    const smsCampaigns = currentCampaigns.filter((c) => c.channel === "sms");

    const emailRevenue = emailCampaigns.reduce((sum, c) => sum + (parseFloat(c.conversion_value) || 0), 0);
    const smsRevenue = smsCampaigns.reduce((sum, c) => sum + (parseFloat(c.conversion_value) || 0), 0);
    const totalRevenue = emailRevenue + smsRevenue;
    const totalConversions = currentCampaigns.reduce((sum, c) => sum + (c.conversions || 0), 0);

    // Calculate averages
    const campaignsWithMetrics = currentCampaigns.filter((c) => c.recipients > 0);
    const avgOpenRate = campaignsWithMetrics.length > 0
      ? campaignsWithMetrics.reduce((sum, c) => sum + (c.open_rate || 0), 0) / campaignsWithMetrics.length
      : 0;
    const avgClickRate = campaignsWithMetrics.length > 0
      ? campaignsWithMetrics.reduce((sum, c) => sum + (c.click_rate || 0), 0) / campaignsWithMetrics.length
      : 0;
    const avgConversionRate = campaignsWithMetrics.length > 0
      ? campaignsWithMetrics.reduce((sum, c) => sum + (c.conversion_rate || 0), 0) / campaignsWithMetrics.length
      : 0;

    // Previous period revenue for delta
    const prevTotalRevenue = prevCampaigns.reduce((sum, c) => sum + (parseFloat(c.conversion_value) || 0), 0);
    const revenueDelta = totalRevenue - prevTotalRevenue;
    const revenueDeltaPct = prevTotalRevenue > 0 ? (revenueDelta / prevTotalRevenue) * 100 : 0;

    const stats: KlaviyoStats = {
      email_revenue: emailRevenue,
      sms_revenue: smsRevenue,
      total_revenue: totalRevenue,
      total_conversions: totalConversions,
      campaigns_sent: currentCampaigns.length,
      avg_open_rate: avgOpenRate,
      avg_click_rate: avgClickRate,
      avg_conversion_rate: avgConversionRate,
      revenue_delta: revenueDelta,
      revenue_delta_pct: revenueDeltaPct,
    };

    // Build response
    const response: KlaviyoResponse = {
      monthly,
      campaigns,
      upcoming,
      flows,
      stats,
      lastSynced: lastSyncedResult.data?.last_synced_at || null,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error("[KLAVIYO API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch Klaviyo data" },
      { status: 500 }
    );
  }
}

// Helper to build campaigns query with optional channel filter
function buildCampaignsQuery(
  supabase: ReturnType<typeof createClient> extends Promise<infer T> ? T : never,
  startDate: Date,
  endDate: Date,
  channel: string | null
) {
  let query = supabase
    .from("klaviyo_campaigns")
    .select("*")
    .eq("status", "sent")
    .gte("send_time", startDate.toISOString())
    .lte("send_time", endDate.toISOString())
    .order("send_time", { ascending: false });

  if (channel) {
    query = query.eq("channel", channel);
  }

  return query;
}
