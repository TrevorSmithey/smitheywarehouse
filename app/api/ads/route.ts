/**
 * Paid Media API
 * Returns ad performance data for the decision engine dashboard
 *
 * Key metrics:
 * - MER (Marketing Efficiency Ratio) = Shopify Revenue / Ad Spend
 * - nCAC (New Customer Acquisition Cost) = Ad Spend / New Customers
 * - Channel comparison (Meta vs Google)
 * - Creative fatigue detection (Meta only)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/server";
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Types for API response
interface ChannelStats {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  conversions: number;
  revenue: number;
  platform_roas: number | null;
  cpa: number | null;
}

interface MetaCreative {
  meta_ad_id: string;
  ad_name: string | null;
  campaign_name: string | null;
  thumbnail_url: string | null;
  creative_type: string | null;
  lifetime_spend: number;
  current_ctr: number | null;
  peak_ctr: number | null;
  ctr_vs_peak: number | null;
  fatigue_severity: string | null;
}

interface DailyStats {
  date: string;
  meta_spend: number;
  google_spend: number;
  total_spend: number;
  shopify_revenue: number | null;
  mer: number | null;
}

interface MonthlyStats {
  month_start: string;
  meta_spend: number;
  google_spend: number;
  total_spend: number;
  shopify_revenue: number | null;
  new_customer_count: number | null;
  mer: number | null;
  ncac: number | null;
  // YoY comparison (same month last year)
  mer_yoy: number | null;      // % change vs same month last year
  ncac_yoy: number | null;     // % change vs same month last year
  spend_yoy: number | null;    // % change vs same month last year
  revenue_yoy: number | null;  // % change vs same month last year
}

interface Alert {
  id: string;
  alert_type: string;
  severity: string;
  channel: string | null;
  title: string;
  description: string;
  metric_value: string | null;
  action_recommended: string | null;
  entity_name: string | null;
  created_at: string;
}

interface MetaCampaignSummary {
  meta_campaign_id: string;
  name: string;
  objective: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchase_value: number;
  ctr: number | null;
  platform_roas: number | null;
}

interface GoogleCampaignSummary {
  google_campaign_id: string;
  name: string;
  campaign_type: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversion_value: number;
  ctr: number | null;
  platform_roas: number | null;
}

interface BudgetPacing {
  channel: string;
  budget: number;
  spent: number;
  pacing_pct: number;
  projected_spend: number;
  days_elapsed: number;
  days_in_month: number;
}

interface AdsResponse {
  // Hero metrics (THE TRUTH)
  mer: {
    current: number | null;
    prior: number | null;
    delta: number | null;
    delta_pct: number | null;
    trend: "improving" | "declining" | "stable";
  };
  ncac: {
    current: number | null;
    prior: number | null;
    delta: number | null;
    delta_pct: number | null;
  };
  blended_cpa: number | null;

  // Spend summary
  spend: {
    total: number;
    meta: number;
    google: number;
    meta_pct: number;
    google_pct: number;
  };

  // Budget pacing
  budgets: BudgetPacing[] | null;

  // Channel comparison
  channels: {
    meta: ChannelStats;
    google: ChannelStats;
  };

  // Alerts
  alerts: Alert[];

  // Creative performance (Meta only)
  top_creatives: MetaCreative[];
  fatigued_creatives: MetaCreative[];

  // Trends
  daily: DailyStats[];
  monthly: MonthlyStats[];

  // Campaigns
  meta_campaigns: MetaCampaignSummary[];
  google_campaigns: GoogleCampaignSummary[];

  // Metadata
  last_synced: {
    meta: string | null;
    google: string | null;
  };
  period: string;
  date_range: {
    start: string;
    end: string;
  };
}

export async function GET(request: NextRequest) {
  // Auth check - requires admin session
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`ads:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const period = searchParams.get("period") || "mtd";
    const channel = searchParams.get("channel") || "all";

    // Calculate date range based on period
    const now = new Date();
    let rangeStart: Date;
    let rangeEnd: Date = now;
    let prevRangeStart: Date;
    let prevRangeEnd: Date;

    switch (period) {
      case "ttm":
        // Trailing Twelve Months
        rangeStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        prevRangeStart = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
        prevRangeEnd = new Date(rangeStart.getTime() - 1);
        break;
      case "mtd":
        rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
        prevRangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevRangeEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        break;
      case "last_month":
        rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        rangeEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        prevRangeStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        prevRangeEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59);
        break;
      case "qtd":
        const currentQuarter = Math.floor(now.getMonth() / 3);
        rangeStart = new Date(now.getFullYear(), currentQuarter * 3, 1);
        const prevQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1;
        const prevQuarterYear = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
        prevRangeStart = new Date(prevQuarterYear, prevQuarter * 3, 1);
        prevRangeEnd = new Date(now.getFullYear(), currentQuarter * 3, 0, 23, 59, 59);
        break;
      case "ytd":
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

    const rangeStartStr = rangeStart.toISOString().split("T")[0];
    const rangeEndStr = rangeEnd.toISOString().split("T")[0];
    const prevRangeStartStr = prevRangeStart.toISOString().split("T")[0];
    const prevRangeEndStr = prevRangeEnd.toISOString().split("T")[0];

    // Execute all queries in parallel
    const [
      // Current period data
      metaCampaignsResult,
      googleCampaignsResult,
      dailyStatsResult,
      // Previous period for comparison
      prevDailyStatsResult,
      // Monthly stats for trends
      monthlyStatsResult,
      // Shopify revenue for MER
      shopifyRevenueResult,
      prevShopifyRevenueResult,
      // New customers for nCAC
      newCustomersResult,
      prevNewCustomersResult,
      // Creative stats
      topCreativesResult,
      fatiguedCreativesResult,
      // Alerts
      alertsResult,
      // Budgets
      budgetsResult,
      // Last sync times
      metaSyncResult,
      googleSyncResult,
    ] = await Promise.all([
      // Meta campaigns in period
      supabase
        .from("meta_campaigns")
        .select("*")
        .gte("date", rangeStartStr)
        .lte("date", rangeEndStr),
      // Google campaigns in period
      supabase
        .from("google_campaigns")
        .select("*")
        .gte("date", rangeStartStr)
        .lte("date", rangeEndStr),
      // Daily stats
      supabase
        .from("ad_daily_stats")
        .select("*")
        .gte("date", rangeStartStr)
        .lte("date", rangeEndStr)
        .order("date", { ascending: true }),
      // Previous period daily stats
      supabase
        .from("ad_daily_stats")
        .select("*")
        .gte("date", prevRangeStartStr)
        .lte("date", prevRangeEndStr),
      // Monthly stats (full history - 37 months available)
      supabase
        .from("ad_monthly_stats")
        .select("*")
        .order("month_start", { ascending: false })
        .limit(48),
      // Shopify revenue for current period (for MER)
      supabase
        .from("daily_stats")
        .select("date, total_revenue")
        .gte("date", rangeStartStr)
        .lte("date", rangeEndStr),
      // Shopify revenue for previous period
      supabase
        .from("daily_stats")
        .select("date, total_revenue")
        .gte("date", prevRangeStartStr)
        .lte("date", prevRangeEndStr),
      // New customers (first orders) in period
      supabase
        .from("orders")
        .select("id")
        .eq("is_first_order", true)
        .eq("canceled", false)
        .gte("created_at", rangeStart.toISOString())
        .lte("created_at", rangeEnd.toISOString()),
      // New customers in previous period
      supabase
        .from("orders")
        .select("id")
        .eq("is_first_order", true)
        .eq("canceled", false)
        .gte("created_at", prevRangeStart.toISOString())
        .lte("created_at", prevRangeEnd.toISOString()),
      // Top performing creatives
      supabase
        .from("meta_ad_creative_stats")
        .select("*")
        .eq("is_active", true)
        .order("lifetime_spend", { ascending: false })
        .limit(10),
      // Fatigued creatives
      supabase
        .from("meta_ad_creative_stats")
        .select("*")
        .eq("is_active", true)
        .eq("is_fatigued", true)
        .order("lifetime_spend", { ascending: false })
        .limit(10),
      // Active alerts
      supabase
        .from("ad_alerts")
        .select("*")
        .eq("is_dismissed", false)
        .order("created_at", { ascending: false })
        .limit(20),
      // Current month budgets (use manual construction to avoid timezone issues)
      supabase
        .from("ad_budgets")
        .select("*")
        .eq("month", `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`),
      // Last Meta sync
      supabase
        .from("ad_sync_logs")
        .select("completed_at")
        .eq("sync_type", "meta")
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .single(),
      // Last Google sync
      supabase
        .from("ad_sync_logs")
        .select("completed_at")
        .eq("sync_type", "google")
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .single(),
    ]);

    // Use pre-computed ad_daily_stats as single source of truth for aggregate metrics
    // This ensures consistency between what's stored and what's displayed
    const currentDailyStats = dailyStatsResult.data || [];
    const prevDailyStats = prevDailyStatsResult.data || [];

    // Aggregate from pre-computed daily stats (not raw campaigns)
    const aggregatedCurrent = currentDailyStats.reduce(
      (acc, d) => ({
        metaSpend: acc.metaSpend + (parseFloat(d.meta_spend) || 0),
        googleSpend: acc.googleSpend + (parseFloat(d.google_spend) || 0),
        totalSpend: acc.totalSpend + (parseFloat(d.total_spend) || 0),
        shopifyRevenue: acc.shopifyRevenue + (parseFloat(d.shopify_revenue) || 0),
        newCustomerCount: acc.newCustomerCount + (parseInt(d.new_customer_count) || 0),
        metaPurchases: acc.metaPurchases + (parseInt(d.meta_purchases) || 0),
        googleConversions: acc.googleConversions + (parseFloat(d.google_conversions) || 0),
      }),
      { metaSpend: 0, googleSpend: 0, totalSpend: 0, shopifyRevenue: 0, newCustomerCount: 0, metaPurchases: 0, googleConversions: 0 }
    );

    const aggregatedPrev = prevDailyStats.reduce(
      (acc, d) => ({
        totalSpend: acc.totalSpend + (parseFloat(d.total_spend) || 0),
        shopifyRevenue: acc.shopifyRevenue + (parseFloat(d.shopify_revenue) || 0),
        newCustomerCount: acc.newCustomerCount + (parseInt(d.new_customer_count) || 0),
      }),
      { totalSpend: 0, shopifyRevenue: 0, newCustomerCount: 0 }
    );

    // Use pre-computed aggregates for metrics
    const totalSpend = aggregatedCurrent.totalSpend;
    const currentShopifyRevenue = aggregatedCurrent.shopifyRevenue;
    const newCustomerCount = aggregatedCurrent.newCustomerCount;
    const prevTotalSpend = aggregatedPrev.totalSpend;
    const prevShopifyRevenue = aggregatedPrev.shopifyRevenue;
    const prevNewCustomerCount = aggregatedPrev.newCustomerCount;

    // Calculate MER from pre-computed data
    const currentMer = totalSpend > 0 ? currentShopifyRevenue / totalSpend : null;
    const prevMer = prevTotalSpend > 0 ? prevShopifyRevenue / prevTotalSpend : null;

    // Calculate nCAC from pre-computed data
    const currentNcac = newCustomerCount > 0 ? totalSpend / newCustomerCount : null;
    const prevNcac = prevNewCustomerCount > 0 ? prevTotalSpend / prevNewCustomerCount : null;

    // Calculate blended CPA from pre-computed data
    const totalConversions = aggregatedCurrent.metaPurchases + aggregatedCurrent.googleConversions;
    const blendedCpa = totalConversions > 0 ? totalSpend / totalConversions : null;

    // Determine MER trend using percentage change (not absolute)
    let merTrend: "improving" | "declining" | "stable" = "stable";
    if (currentMer !== null && prevMer !== null && prevMer !== 0) {
      const merChangePct = (currentMer - prevMer) / prevMer;
      if (merChangePct > 0.05) merTrend = "improving";      // >5% improvement
      else if (merChangePct < -0.05) merTrend = "declining"; // >5% decline
    }

    // Still use campaign data for campaign tables (need individual campaign breakdowns)
    const metaCampaigns = metaCampaignsResult.data || [];
    const metaStats = aggregateMetaStats(metaCampaigns);
    const metaCampaignSummaries = aggregateMetaCampaignSummaries(metaCampaigns);

    const googleCampaigns = googleCampaignsResult.data || [];
    const googleStats = aggregateGoogleStats(googleCampaigns);
    const googleCampaignSummaries = aggregateGoogleCampaignSummaries(googleCampaigns);

    // Calculate budget pacing using pre-computed spend values
    const budgets = calculateBudgetPacing(
      budgetsResult.data || [],
      aggregatedCurrent.metaSpend,
      aggregatedCurrent.googleSpend,
      now
    );

    // Process daily stats
    const dailyStats: DailyStats[] = (dailyStatsResult.data || []).map((d) => ({
      date: d.date,
      meta_spend: parseFloat(d.meta_spend) || 0,
      google_spend: parseFloat(d.google_spend) || 0,
      total_spend: parseFloat(d.total_spend) || 0,
      shopify_revenue: d.shopify_revenue ? parseFloat(d.shopify_revenue) : null,
      mer: d.mer ? parseFloat(d.mer) : null,
    }));

    // Process monthly stats with YoY comparison
    const rawMonthlyData = (monthlyStatsResult.data || []).map((m) => ({
      month_start: m.month_start,
      meta_spend: parseFloat(m.meta_spend) || 0,
      google_spend: parseFloat(m.google_spend) || 0,
      total_spend: parseFloat(m.total_spend) || 0,
      shopify_revenue: m.shopify_revenue ? parseFloat(m.shopify_revenue) : null,
      new_customer_count: m.new_customer_count,
      mer: m.mer ? parseFloat(m.mer) : null,
      ncac: m.ncac ? parseFloat(m.ncac) : null,
    }));

    // Create lookup map by month_start for YoY calculation
    const monthlyLookup = new Map(rawMonthlyData.map((m) => [m.month_start, m]));

    // Calculate YoY for each month
    const monthlyStats: MonthlyStats[] = rawMonthlyData.map((m) => {
      // Find same month last year (e.g., 2025-01-01 -> 2024-01-01)
      const [year, month, day] = m.month_start.split("-");
      const lastYearMonth = `${parseInt(year) - 1}-${month}-${day || "01"}`;
      const lastYear = monthlyLookup.get(lastYearMonth);

      // Calculate YoY percentage changes
      const calcYoY = (current: number | null, prior: number | null): number | null => {
        if (current === null || prior === null || prior === 0) return null;
        return ((current - prior) / prior) * 100;
      };

      return {
        ...m,
        mer_yoy: calcYoY(m.mer, lastYear?.mer ?? null),
        ncac_yoy: calcYoY(m.ncac, lastYear?.ncac ?? null),
        spend_yoy: calcYoY(m.total_spend, lastYear?.total_spend ?? null),
        revenue_yoy: calcYoY(m.shopify_revenue, lastYear?.shopify_revenue ?? null),
      };
    });

    // Process creatives
    const topCreatives: MetaCreative[] = (topCreativesResult.data || []).map((c) => ({
      meta_ad_id: c.meta_ad_id,
      ad_name: c.ad_name,
      campaign_name: c.campaign_name,
      thumbnail_url: c.thumbnail_url,
      creative_type: c.creative_type,
      lifetime_spend: parseFloat(c.lifetime_spend) || 0,
      current_ctr: c.current_ctr ? parseFloat(c.current_ctr) : null,
      peak_ctr: c.peak_ctr ? parseFloat(c.peak_ctr) : null,
      ctr_vs_peak: c.ctr_vs_peak ? parseFloat(c.ctr_vs_peak) : null,
      fatigue_severity: c.fatigue_severity,
    }));

    const fatiguedCreatives: MetaCreative[] = (fatiguedCreativesResult.data || []).map((c) => ({
      meta_ad_id: c.meta_ad_id,
      ad_name: c.ad_name,
      campaign_name: c.campaign_name,
      thumbnail_url: c.thumbnail_url,
      creative_type: c.creative_type,
      lifetime_spend: parseFloat(c.lifetime_spend) || 0,
      current_ctr: c.current_ctr ? parseFloat(c.current_ctr) : null,
      peak_ctr: c.peak_ctr ? parseFloat(c.peak_ctr) : null,
      ctr_vs_peak: c.ctr_vs_peak ? parseFloat(c.ctr_vs_peak) : null,
      fatigue_severity: c.fatigue_severity,
    }));

    // Process alerts
    const alerts: Alert[] = (alertsResult.data || []).map((a) => ({
      id: a.id,
      alert_type: a.alert_type,
      severity: a.severity,
      channel: a.channel,
      title: a.title,
      description: a.description,
      metric_value: a.metric_value,
      action_recommended: a.action_recommended,
      entity_name: a.entity_name,
      created_at: a.created_at,
    }));

    // Build response
    const response: AdsResponse = {
      mer: {
        current: currentMer,
        prior: prevMer,
        delta: currentMer !== null && prevMer !== null ? currentMer - prevMer : null,
        delta_pct: currentMer !== null && prevMer !== null && prevMer !== 0
          ? ((currentMer - prevMer) / prevMer) * 100
          : null,
        trend: merTrend,
      },
      ncac: {
        current: currentNcac,
        prior: prevNcac,
        delta: currentNcac !== null && prevNcac !== null ? currentNcac - prevNcac : null,
        delta_pct: currentNcac !== null && prevNcac !== null && prevNcac !== 0
          ? ((currentNcac - prevNcac) / prevNcac) * 100
          : null,
      },
      blended_cpa: blendedCpa,
      spend: {
        total: totalSpend,
        meta: aggregatedCurrent.metaSpend,
        google: aggregatedCurrent.googleSpend,
        meta_pct: totalSpend > 0 ? (aggregatedCurrent.metaSpend / totalSpend) * 100 : 0,
        google_pct: totalSpend > 0 ? (aggregatedCurrent.googleSpend / totalSpend) * 100 : 0,
      },
      budgets,
      channels: {
        meta: metaStats,
        google: googleStats,
      },
      alerts,
      top_creatives: topCreatives,
      fatigued_creatives: fatiguedCreatives,
      daily: dailyStats,
      monthly: monthlyStats,
      meta_campaigns: metaCampaignSummaries,
      google_campaigns: googleCampaignSummaries,
      last_synced: {
        meta: metaSyncResult.data?.completed_at || null,
        google: googleSyncResult.data?.completed_at || null,
      },
      period,
      date_range: {
        start: rangeStartStr,
        end: rangeEndStr,
      },
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error("[ADS API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch ads data" },
      { status: 500 }
    );
  }
}

/**
 * Aggregate Meta campaign data into channel stats
 */
function aggregateMetaStats(campaigns: Record<string, unknown>[]): ChannelStats {
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let conversions = 0;
  let revenue = 0;

  for (const c of campaigns) {
    spend += parseFloat(c.spend as string) || 0;
    impressions += parseInt(c.impressions as string, 10) || 0;
    clicks += parseInt(c.clicks as string, 10) || 0;
    conversions += parseInt(c.purchases as string, 10) || 0;
    revenue += parseFloat(c.purchase_value as string) || 0;
  }

  return {
    spend,
    impressions,
    clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    conversions,
    revenue,
    platform_roas: spend > 0 ? revenue / spend : null,
    cpa: conversions > 0 ? spend / conversions : null,
  };
}

/**
 * Aggregate Google campaign data into channel stats
 */
function aggregateGoogleStats(campaigns: Record<string, unknown>[]): ChannelStats {
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let conversions = 0;
  let revenue = 0;

  for (const c of campaigns) {
    spend += parseFloat(c.spend as string) || 0;
    impressions += parseInt(c.impressions as string, 10) || 0;
    clicks += parseInt(c.clicks as string, 10) || 0;
    conversions += parseFloat(c.conversions as string) || 0;
    revenue += parseFloat(c.conversion_value as string) || 0;
  }

  return {
    spend,
    impressions,
    clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    conversions,
    revenue,
    platform_roas: spend > 0 ? revenue / spend : null,
    cpa: conversions > 0 ? spend / conversions : null,
  };
}

/**
 * Aggregate Meta campaigns into summaries by campaign
 */
function aggregateMetaCampaignSummaries(
  campaigns: Record<string, unknown>[]
): MetaCampaignSummary[] {
  const byId = new Map<string, MetaCampaignSummary>();

  for (const c of campaigns) {
    const id = c.meta_campaign_id as string;
    const existing = byId.get(id);

    if (existing) {
      existing.spend += parseFloat(c.spend as string) || 0;
      existing.impressions += parseInt(c.impressions as string, 10) || 0;
      existing.clicks += parseInt(c.clicks as string, 10) || 0;
      existing.purchases += parseInt(c.purchases as string, 10) || 0;
      existing.purchase_value += parseFloat(c.purchase_value as string) || 0;
    } else {
      byId.set(id, {
        meta_campaign_id: id,
        name: c.name as string,
        objective: c.objective as string | null,
        spend: parseFloat(c.spend as string) || 0,
        impressions: parseInt(c.impressions as string, 10) || 0,
        clicks: parseInt(c.clicks as string, 10) || 0,
        purchases: parseInt(c.purchases as string, 10) || 0,
        purchase_value: parseFloat(c.purchase_value as string) || 0,
        ctr: null,
        platform_roas: null,
      });
    }
  }

  // Calculate derived metrics
  const summaries = Array.from(byId.values());
  for (const s of summaries) {
    s.ctr = s.impressions > 0 ? (s.clicks / s.impressions) * 100 : null;
    s.platform_roas = s.spend > 0 ? s.purchase_value / s.spend : null;
  }

  // Sort by spend descending
  return summaries.sort((a, b) => b.spend - a.spend);
}

/**
 * Aggregate Google campaigns by ID for the summary table
 * Groups daily data by campaign, calculates totals and derived metrics
 */
function aggregateGoogleCampaignSummaries(
  campaigns: Record<string, unknown>[]
): GoogleCampaignSummary[] {
  const byId = new Map<string, GoogleCampaignSummary>();

  for (const c of campaigns) {
    const id = c.google_campaign_id as string;
    const existing = byId.get(id);

    if (existing) {
      existing.spend += parseFloat(c.spend as string) || 0;
      existing.impressions += parseInt(c.impressions as string, 10) || 0;
      existing.clicks += parseInt(c.clicks as string, 10) || 0;
      existing.conversions += parseFloat(c.conversions as string) || 0;
      existing.conversion_value += parseFloat(c.conversion_value as string) || 0;
    } else {
      byId.set(id, {
        google_campaign_id: id,
        name: c.name as string,
        campaign_type: c.campaign_type as string | null,
        spend: parseFloat(c.spend as string) || 0,
        impressions: parseInt(c.impressions as string, 10) || 0,
        clicks: parseInt(c.clicks as string, 10) || 0,
        conversions: parseFloat(c.conversions as string) || 0,
        conversion_value: parseFloat(c.conversion_value as string) || 0,
        ctr: null,
        platform_roas: null,
      });
    }
  }

  // Calculate derived metrics
  const summaries = Array.from(byId.values());
  for (const s of summaries) {
    s.ctr = s.impressions > 0 ? (s.clicks / s.impressions) * 100 : null;
    s.platform_roas = s.spend > 0 ? s.conversion_value / s.spend : null;
  }

  // Sort by spend descending
  return summaries.sort((a, b) => b.spend - a.spend);
}

/**
 * Calculate budget pacing for current month
 */
function calculateBudgetPacing(
  budgets: Record<string, unknown>[],
  metaSpend: number,
  googleSpend: number,
  now: Date
): BudgetPacing[] | null {
  if (budgets.length === 0) return null;

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const dailyPacingRate = daysElapsed / daysInMonth;

  const pacing: BudgetPacing[] = [];

  for (const b of budgets) {
    const channel = b.channel as string;
    const budget = parseFloat(b.budget_amount as string) || 0;
    const spent = channel === "meta" ? metaSpend : channel === "google" ? googleSpend : 0;
    const pacingPct = budget > 0 ? (spent / budget) * 100 : 0;
    const projectedSpend = daysElapsed > 0 ? (spent / daysElapsed) * daysInMonth : 0;

    pacing.push({
      channel,
      budget,
      spent,
      pacing_pct: pacingPct,
      projected_spend: projectedSpend,
      days_elapsed: daysElapsed,
      days_in_month: daysInMonth,
    });
  }

  return pacing;
}
