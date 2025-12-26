/**
 * Klaviyo Marketing API
 * Returns campaign performance data for month-end reporting and inventory planning
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  KlaviyoResponse,
  KlaviyoCampaignSummary,
  KlaviyoMonthlySummary,
  KlaviyoUpcomingCampaign,
  KlaviyoFlow,
  KlaviyoStats,
  SendTimeAnalysis,
  FlowBreakdown,
} from "@/lib/types";
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`klaviyo:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const supabase = createServiceClient();
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
        // Handle year boundary: Q1 previous quarter is Q4 of prior year
        const prevQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1;
        const prevQuarterYear = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
        prevRangeStart = new Date(prevQuarterYear, prevQuarter * 3, 1);
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
      // Monthly stats for charts and YoY comparisons (need 24 months for YTD comparisons)
      supabase
        .from("klaviyo_monthly_stats")
        .select("*")
        .order("month_start", { ascending: false })
        .limit(24),
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
      flow_revenue: parseFloat(m.flow_revenue) || 0,
      flow_conversions: m.flow_conversions || 0,
      subscribers_120day: m.subscribers_120day,
      subscribers_365day: m.subscribers_365day,
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

    // Campaign revenue (filtered by period)
    const campaignRevenue = currentCampaigns.reduce((sum, c) => sum + (parseFloat(c.conversion_value) || 0), 0);
    const campaignConversions = currentCampaigns.reduce((sum, c) => sum + (c.conversions || 0), 0);

    // Helper to check if a month falls within a date range
    const isMonthInRange = (monthStart: string, start: Date, end: Date): boolean => {
      const [year, month] = monthStart.split('-').map(Number);
      const monthDate = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0, 23, 59, 59); // Last day of month
      // Month overlaps with range if month start <= range end AND month end >= range start
      return monthDate <= end && monthEnd >= start;
    };

    // Get flow revenue by summing monthly stats within the period range
    const monthsInPeriod = monthly.filter(m => isMonthInRange(m.month_start, rangeStart, rangeEnd));
    const flowRevenue = monthsInPeriod.reduce((sum, m) => sum + (m.flow_revenue || 0), 0);
    const flowConversions = monthsInPeriod.reduce((sum, m) => sum + (m.flow_conversions || 0), 0);

    // Get subscriber counts from the most recent month in the period (or current month for MTD)
    const latestMonthInPeriod = monthsInPeriod.length > 0
      ? monthsInPeriod.reduce((latest, m) =>
          new Date(m.month_start) > new Date(latest.month_start) ? m : latest
        )
      : monthly[0]; // Fallback to most recent month
    const subscribers120day = latestMonthInPeriod?.subscribers_120day || 0;
    const subscribers365day = latestMonthInPeriod?.subscribers_365day || 0;

    const totalEmailRevenue = campaignRevenue + flowRevenue;
    const totalConversions = campaignConversions + flowConversions;

    // Calculate averages from campaigns in the period
    const campaignsWithMetrics = currentCampaigns.filter((c) => c.recipients > 0);
    const avgOpenRate = campaignsWithMetrics.length > 0
      ? campaignsWithMetrics.reduce((sum, c) => sum + (c.open_rate || 0), 0) / campaignsWithMetrics.length
      : 0;
    const avgClickRate = campaignsWithMetrics.length > 0
      ? campaignsWithMetrics.reduce((sum, c) => sum + (c.click_rate || 0), 0) / campaignsWithMetrics.length
      : 0;

    // Calculate advanced KPIs from campaigns in the period
    const totalRecipients = currentCampaigns.reduce((sum, c) => sum + (c.recipients || 0), 0);
    const totalDelivered = currentCampaigns.reduce((sum, c) => sum + (c.delivered || 0), 0);
    const totalUnsubscribes = currentCampaigns.reduce((sum, c) => sum + (c.unsubscribes || 0), 0);
    const totalBounces = currentCampaigns.reduce((sum, c) => sum + (c.bounces || 0), 0);

    // Revenue Per Recipient (RPR) - THE most important email marketing metric
    const campaignRPR = totalRecipients > 0 ? campaignRevenue / totalRecipients : 0;

    // Flow RPR - Klaviyo doesn't provide flow recipient counts in reports
    // We can't calculate this accurately, so set to 0 (dashboard should hide if 0)
    const flowRPR = 0;

    // Unsubscribe rate - healthy is <0.5%
    const unsubscribeRate = totalDelivered > 0 ? totalUnsubscribes / totalDelivered : 0;

    // Placed Order Rate (conversion rate per delivery)
    const placedOrderRate = totalDelivered > 0 ? campaignConversions / totalDelivered : 0;

    // Deliverability metrics
    const bounceRate = totalRecipients > 0 ? totalBounces / totalRecipients : 0;
    const deliveryRate = totalRecipients > 0 ? totalDelivered / totalRecipients : 0;

    // Revenue per email sent (total revenue / total recipients)
    const revenuePerEmail = totalRecipients > 0 ? totalEmailRevenue / totalRecipients : 0;

    // List Health Score (0-100)
    // Factors: delivery rate, unsubscribe rate, bounce rate, engagement (open rate)
    // Higher delivery + open rate = good, higher unsub + bounce = bad
    const calculateListHealthScore = (): number => {
      if (totalRecipients === 0) return 0;

      // Weight each factor (total = 100)
      const deliveryScore = deliveryRate * 30; // 30 points max - delivery rate
      const bounceScore = (1 - Math.min(bounceRate * 10, 1)) * 20; // 20 points max - low bounce
      const unsubScore = (1 - Math.min(unsubscribeRate * 100, 1)) * 20; // 20 points max - low unsub
      const engagementScore = Math.min(avgOpenRate * 100, 30); // 30 points max - open rate capped at 30%

      return Math.round(deliveryScore + bounceScore + unsubScore + engagementScore);
    };
    const listHealthScore = calculateListHealthScore();

    // Send Time Analysis - aggregate campaigns by hour and day of week
    const calculateSendTimeAnalysis = (): SendTimeAnalysis => {
      const byHourMap = new Map<number, { campaigns: number; openRateSum: number; clickRateSum: number; revenue: number }>();
      const byDayMap = new Map<number, { campaigns: number; openRateSum: number; clickRateSum: number; revenue: number }>();
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

      // Initialize all hours and days
      for (let h = 0; h < 24; h++) {
        byHourMap.set(h, { campaigns: 0, openRateSum: 0, clickRateSum: 0, revenue: 0 });
      }
      for (let d = 0; d < 7; d++) {
        byDayMap.set(d, { campaigns: 0, openRateSum: 0, clickRateSum: 0, revenue: 0 });
      }

      // Aggregate campaigns
      for (const c of currentCampaigns) {
        if (!c.send_time) continue;
        const sendDate = new Date(c.send_time);
        const hour = sendDate.getHours();
        const day = sendDate.getDay();

        const hourData = byHourMap.get(hour)!;
        hourData.campaigns++;
        hourData.openRateSum += c.open_rate || 0;
        hourData.clickRateSum += c.click_rate || 0;
        hourData.revenue += parseFloat(c.conversion_value) || 0;

        const dayData = byDayMap.get(day)!;
        dayData.campaigns++;
        dayData.openRateSum += c.open_rate || 0;
        dayData.clickRateSum += c.click_rate || 0;
        dayData.revenue += parseFloat(c.conversion_value) || 0;
      }

      const byHour = Array.from(byHourMap.entries()).map(([hour, data]) => ({
        hour,
        campaigns: data.campaigns,
        avg_open_rate: data.campaigns > 0 ? data.openRateSum / data.campaigns : 0,
        avg_click_rate: data.campaigns > 0 ? data.clickRateSum / data.campaigns : 0,
        total_revenue: data.revenue,
      }));

      const byDayOfWeek = Array.from(byDayMap.entries()).map(([day, data]) => ({
        day,
        dayName: dayNames[day],
        campaigns: data.campaigns,
        avg_open_rate: data.campaigns > 0 ? data.openRateSum / data.campaigns : 0,
        avg_click_rate: data.campaigns > 0 ? data.clickRateSum / data.campaigns : 0,
        total_revenue: data.revenue,
      }));

      // Find best hour and day by open rate (only consider times with campaigns)
      const hoursWithCampaigns = byHour.filter(h => h.campaigns > 0);
      const daysWithCampaigns = byDayOfWeek.filter(d => d.campaigns > 0);

      const bestHourData = hoursWithCampaigns.length > 0
        ? hoursWithCampaigns.reduce((best, h) => h.avg_open_rate > best.avg_open_rate ? h : best)
        : { hour: 10 }; // Default to 10 AM
      const bestDayData = daysWithCampaigns.length > 0
        ? daysWithCampaigns.reduce((best, d) => d.avg_open_rate > best.avg_open_rate ? d : best)
        : { dayName: "Tuesday" }; // Default

      return {
        byHour,
        byDayOfWeek,
        bestHour: bestHourData.hour,
        bestDay: bestDayData.dayName,
      };
    };
    const sendTimeAnalysis = calculateSendTimeAnalysis();

    // Flow Performance Breakdown - categorize flows by type
    const calculateFlowBreakdown = (): FlowBreakdown => {
      const breakdown: FlowBreakdown = {
        welcome: { revenue: 0, conversions: 0, flowCount: 0 },
        abandoned_cart: { revenue: 0, conversions: 0, flowCount: 0 },
        abandoned_checkout: { revenue: 0, conversions: 0, flowCount: 0 },
        browse_abandonment: { revenue: 0, conversions: 0, flowCount: 0 },
        post_purchase: { revenue: 0, conversions: 0, flowCount: 0 },
        winback: { revenue: 0, conversions: 0, flowCount: 0 },
        other: { revenue: 0, conversions: 0, flowCount: 0 },
      };

      // Categorize flows by name/trigger type
      for (const flow of flows) {
        const nameLower = flow.name.toLowerCase();
        const triggerLower = (flow.trigger_type || "").toLowerCase();

        let category: keyof FlowBreakdown = "other";

        if (nameLower.includes("welcome") || triggerLower.includes("subscribed")) {
          category = "welcome";
        } else if (nameLower.includes("abandoned cart") || triggerLower.includes("added to cart")) {
          category = "abandoned_cart";
        } else if (nameLower.includes("checkout") || triggerLower.includes("started checkout")) {
          category = "abandoned_checkout";
        } else if (nameLower.includes("browse") || triggerLower.includes("viewed product")) {
          category = "browse_abandonment";
        } else if (nameLower.includes("post purchase") || nameLower.includes("thank you") || triggerLower.includes("placed order")) {
          category = "post_purchase";
        } else if (nameLower.includes("winback") || nameLower.includes("win back") || nameLower.includes("re-engage")) {
          category = "winback";
        }

        breakdown[category].revenue += flow.total_revenue;
        breakdown[category].conversions += flow.total_conversions;
        breakdown[category].flowCount++;
      }

      return breakdown;
    };
    const flowBreakdown = calculateFlowBreakdown();

    // Get Shopify revenue for email % calculation (already filtered by period)
    let shopifyRevenue = 0;
    try {
      const { data: shopifyStats } = await supabase
        .from("daily_stats")
        .select("total_revenue")
        .gte("date", rangeStart.toISOString().split("T")[0])
        .lte("date", rangeEnd.toISOString().split("T")[0]);

      if (shopifyStats) {
        shopifyRevenue = shopifyStats.reduce((sum, d) => sum + (parseFloat(d.total_revenue) || 0), 0);
      }
    } catch (err) {
      console.error("[KLAVIYO API] Failed to fetch Shopify revenue:", err);
    }

    const emailPctOfRevenue = shopifyRevenue > 0 ? (totalEmailRevenue / shopifyRevenue) * 100 : 0;

    // Previous period flow revenue - sum monthly stats in prev period range
    const prevMonthsInPeriod = monthly.filter(m => isMonthInRange(m.month_start, prevRangeStart, prevRangeEnd));
    const prevFlowRevenue = prevMonthsInPeriod.reduce((sum, m) => sum + (m.flow_revenue || 0), 0);

    // Previous period campaign revenue (already have from query)
    const prevCampaignRevenue = prevCampaigns.reduce((sum, c) => sum + (parseFloat(c.conversion_value) || 0), 0);

    const prevTotalRevenue = prevCampaignRevenue + prevFlowRevenue;
    const revenueDelta = totalEmailRevenue - prevTotalRevenue;
    const revenueDeltaPct = prevTotalRevenue > 0 ? (revenueDelta / prevTotalRevenue) * 100 : 0;

    const stats: KlaviyoStats = {
      campaign_revenue: campaignRevenue,
      flow_revenue: flowRevenue,
      total_revenue: totalEmailRevenue,
      total_conversions: totalConversions,
      campaigns_sent: currentCampaigns.length,
      subscribers_120day: subscribers120day,
      subscribers_365day: subscribers365day,
      avg_open_rate: avgOpenRate,
      avg_click_rate: avgClickRate,
      email_pct_of_revenue: emailPctOfRevenue,
      revenue_delta: revenueDelta,
      revenue_delta_pct: revenueDeltaPct,
      // Advanced KPIs
      campaign_rpr: campaignRPR,
      flow_rpr: flowRPR,
      total_recipients: totalRecipients,
      unsubscribe_rate: unsubscribeRate,
      placed_order_rate: placedOrderRate,
      // Deliverability metrics
      total_delivered: totalDelivered,
      total_bounces: totalBounces,
      bounce_rate: bounceRate,
      delivery_rate: deliveryRate,
      // List health score
      list_health_score: listHealthScore,
      // Revenue per email
      revenue_per_email: revenuePerEmail,
    };

    // Build response
    const response: KlaviyoResponse = {
      monthly,
      campaigns,
      upcoming,
      flows,
      stats,
      sendTimeAnalysis,
      flowBreakdown,
      lastSynced: lastSyncedResult.data?.last_synced_at || null,
    };

    // Add cache headers - data is updated by cron, cache for 60s
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });

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
  supabase: ReturnType<typeof createServiceClient>,
  startDate: Date,
  endDate: Date,
  channel: string | null
) {
  let query = supabase
    .from("klaviyo_campaigns")
    .select("*")
    .eq("status", "Sent")
    .gte("send_time", startDate.toISOString())
    .lte("send_time", endDate.toISOString())
    .order("send_time", { ascending: false });

  if (channel) {
    query = query.eq("channel", channel);
  }

  return query;
}
