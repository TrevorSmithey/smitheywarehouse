/**
 * Compute Ad Metrics Cron Job
 *
 * Runs AFTER sync-meta (and sync-google-ads when added) to compute
 * MER and nCAC by joining ad spend with Shopify revenue and orders.
 *
 * Triggered by Vercel cron daily at 7:30 AM UTC (2:30 AM EST)
 *
 * Computes:
 * - MER (Marketing Efficiency Ratio) = Shopify Revenue / Total Ad Spend
 * - nCAC (New Customer Acquisition Cost) = Total Ad Spend / New Customers
 * - Monthly rollups for period comparison
 * - Alerts for significant changes
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";

const LOCK_NAME = "compute-ad-metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // 2 minutes

export async function GET(request: Request) {
  // Verify cron secret
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  // Acquire lock
  const lock = await acquireCronLock(supabase, LOCK_NAME);
  if (!lock.acquired) {
    console.warn(`[AD METRICS] Skipping - another compute is in progress`);
    return NextResponse.json(
      { success: false, error: "Another compute is already in progress", skipped: true },
      { status: 409 }
    );
  }

  const stats = {
    dailyUpdated: 0,
    monthlyUpdated: 0,
    alertsGenerated: 0,
    errors: 0,
  };

  try {
    console.log("[AD METRICS] Starting computation...");

    // Get date range - compute for last 90 days (same as sync window)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);

    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];

    console.log(`[AD METRICS] Date range: ${startDateStr} to ${endDateStr}`);

    // ============================================================
    // 1. Compute daily MER/nCAC by joining with Shopify data
    // ============================================================
    console.log("[AD METRICS] Computing daily MER/nCAC...");

    // Get all daily ad stats
    const { data: adDaily, error: adError } = await supabase
      .from("ad_daily_stats")
      .select("date, total_spend, meta_spend, google_spend")
      .gte("date", startDateStr)
      .lte("date", endDateStr);

    if (adError) {
      console.error("[AD METRICS] Error fetching ad_daily_stats:", adError);
      throw adError;
    }

    // Get Shopify daily stats
    const { data: shopifyDaily, error: shopifyError } = await supabase
      .from("daily_stats")
      .select("date, total_revenue, total_orders")
      .gte("date", startDateStr)
      .lte("date", endDateStr);

    if (shopifyError) {
      console.error("[AD METRICS] Error fetching daily_stats:", shopifyError);
      throw shopifyError;
    }

    // Get new customer counts by day (DISTINCT customers, not orders)
    const { data: newCustomers, error: ncError } = await supabase
      .from("orders")
      .select("created_at, shopify_customer_id")
      .eq("is_first_order", true)
      .eq("canceled", false)
      .gte("created_at", startDateStr)
      .lte("created_at", endDateStr + "T23:59:59");

    if (ncError) {
      console.error("[AD METRICS] Error fetching new customers:", ncError);
      throw ncError;
    }

    // Group UNIQUE customers by date using Sets
    // This prevents double-counting if a customer has multiple first orders on same day
    const uniqueCustomersByDate = new Map<string, Set<string>>();
    for (const order of newCustomers || []) {
      const date = order.created_at.split("T")[0];
      const customerId = order.shopify_customer_id;
      if (!customerId) continue; // Skip orders without customer ID

      const existing = uniqueCustomersByDate.get(date) || new Set<string>();
      existing.add(customerId);
      uniqueCustomersByDate.set(date, existing);
    }

    // Convert Sets to counts
    const newCustomersByDate = new Map<string, number>();
    for (const [date, customerSet] of uniqueCustomersByDate) {
      newCustomersByDate.set(date, customerSet.size);
    }

    // Create lookup maps
    const shopifyByDate = new Map<string, { revenue: number; orders: number }>();
    for (const row of shopifyDaily || []) {
      shopifyByDate.set(row.date, {
        revenue: parseFloat(row.total_revenue) || 0,
        orders: parseInt(row.total_orders) || 0,
      });
    }

    // Update ad_daily_stats with MER/nCAC
    for (const row of adDaily || []) {
      const shopify = shopifyByDate.get(row.date);
      const totalSpend = parseFloat(row.total_spend) || 0;
      const newCustCount = newCustomersByDate.get(row.date) || 0;

      // Calculate MER
      let mer: number | null = null;
      if (totalSpend > 0 && shopify?.revenue) {
        mer = shopify.revenue / totalSpend;
      }

      // Calculate nCAC
      let ncac: number | null = null;
      if (newCustCount > 0 && totalSpend > 0) {
        ncac = totalSpend / newCustCount;
      }

      const { error } = await supabase
        .from("ad_daily_stats")
        .update({
          shopify_revenue: shopify?.revenue || null,
          new_customer_count: newCustCount || null,
          mer,
          ncac,
          computed_at: new Date().toISOString(),
        })
        .eq("date", row.date);

      if (error) {
        console.error(`[AD METRICS] Error updating daily stats for ${row.date}:`, error);
        stats.errors++;
      } else {
        stats.dailyUpdated++;
      }
    }

    console.log(`[AD METRICS] Updated ${stats.dailyUpdated} daily records`);

    // ============================================================
    // 2. Compute monthly rollups
    // ============================================================
    console.log("[AD METRICS] Computing monthly rollups...");

    // Get all months in the date range
    const months = getMonthsInRange(startDateStr, endDateStr);

    for (const month of months) {
      const monthStart = `${month}-01`;
      const monthEnd = getLastDayOfMonth(month);

      // Aggregate daily stats for the month
      const { data: monthlyAgg, error: aggError } = await supabase
        .from("ad_daily_stats")
        .select("meta_spend, google_spend, total_spend, meta_purchases, google_conversions, shopify_revenue, new_customer_count")
        .gte("date", monthStart)
        .lte("date", monthEnd);

      if (aggError) {
        console.error(`[AD METRICS] Error aggregating month ${month}:`, aggError);
        stats.errors++;
        continue;
      }

      const monthData = (monthlyAgg || []).reduce(
        (acc, row) => ({
          meta_spend: acc.meta_spend + (parseFloat(row.meta_spend) || 0),
          google_spend: acc.google_spend + (parseFloat(row.google_spend) || 0),
          total_spend: acc.total_spend + (parseFloat(row.total_spend) || 0),
          meta_purchases: acc.meta_purchases + (parseInt(row.meta_purchases) || 0),
          google_conversions: acc.google_conversions + (parseFloat(row.google_conversions) || 0),
          shopify_revenue: acc.shopify_revenue + (parseFloat(row.shopify_revenue) || 0),
          new_customer_count: acc.new_customer_count + (parseInt(row.new_customer_count) || 0),
        }),
        {
          meta_spend: 0,
          google_spend: 0,
          total_spend: 0,
          meta_purchases: 0,
          google_conversions: 0,
          shopify_revenue: 0,
          new_customer_count: 0,
        }
      );

      // Calculate monthly MER/nCAC
      const mer = monthData.total_spend > 0
        ? monthData.shopify_revenue / monthData.total_spend
        : null;

      const ncac = monthData.new_customer_count > 0
        ? monthData.total_spend / monthData.new_customer_count
        : null;

      const blendedCpa = (monthData.meta_purchases + monthData.google_conversions) > 0
        ? monthData.total_spend / (monthData.meta_purchases + monthData.google_conversions)
        : null;

      // Get prior month for MoM comparison
      const priorMonth = getPriorMonth(month);
      const { data: priorData } = await supabase
        .from("ad_monthly_stats")
        .select("mer, ncac")
        .eq("month_start", `${priorMonth}-01`)
        .single();

      const merMomChange = priorData?.mer && mer
        ? (mer - priorData.mer) / priorData.mer
        : null;

      const ncacMomChange = priorData?.ncac && ncac
        ? (ncac - priorData.ncac) / priorData.ncac
        : null;

      const { error: upsertError } = await supabase
        .from("ad_monthly_stats")
        .upsert({
          month_start: monthStart,
          meta_spend: monthData.meta_spend,
          google_spend: monthData.google_spend,
          total_spend: monthData.total_spend,
          meta_purchases: monthData.meta_purchases,
          google_conversions: monthData.google_conversions,
          shopify_revenue: monthData.shopify_revenue,
          new_customer_count: monthData.new_customer_count,
          mer,
          ncac,
          blended_cpa: blendedCpa,
          mer_mom_change: merMomChange,
          ncac_mom_change: ncacMomChange,
          computed_at: new Date().toISOString(),
        }, { onConflict: "month_start" });

      if (upsertError) {
        console.error(`[AD METRICS] Error upserting monthly stats for ${month}:`, upsertError);
        stats.errors++;
      } else {
        stats.monthlyUpdated++;
      }
    }

    console.log(`[AD METRICS] Updated ${stats.monthlyUpdated} monthly records`);

    // ============================================================
    // 3. Generate alerts for significant changes
    // ============================================================
    console.log("[AD METRICS] Checking for alerts...");

    stats.alertsGenerated = await generateAlerts(supabase);

    console.log(`[AD METRICS] Generated ${stats.alertsGenerated} alerts`);

    // ============================================================
    // Done
    // ============================================================
    const duration = Date.now() - startTime;
    console.log(`[AD METRICS] Complete in ${duration}ms:`, stats);

    return NextResponse.json({
      success: true,
      ...stats,
      duration,
      dateRange: { startDate: startDateStr, endDate: endDateStr },
    });

  } catch (error) {
    console.error("[AD METRICS] Fatal error:", error);
    const errorMessage = error instanceof Error ? error.message : "Computation failed";

    return NextResponse.json(
      { error: errorMessage, duration: Date.now() - startTime },
      { status: 500 }
    );

  } finally {
    await releaseCronLock(supabase, LOCK_NAME);
  }
}

/**
 * Get list of months (YYYY-MM format) in a date range
 */
function getMonthsInRange(startDate: string, endDate: string): string[] {
  const months: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  const current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, "0");
    months.push(`${year}-${month}`);
    current.setMonth(current.getMonth() + 1);
  }

  return months;
}

/**
 * Get last day of month in YYYY-MM-DD format
 */
function getLastDayOfMonth(monthStr: string): string {
  const [year, month] = monthStr.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${monthStr}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * Get prior month in YYYY-MM format
 */
function getPriorMonth(monthStr: string): string {
  const [year, month] = monthStr.split("-").map(Number);
  const date = new Date(year, month - 2, 1); // month - 1 - 1 (0-indexed + prior)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Generate alerts for significant metric changes
 */
async function generateAlerts(
  supabase: ReturnType<typeof createServiceClient>
): Promise<number> {
  let alertCount = 0;

  // Get current month stats
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const { data: currentStats } = await supabase
    .from("ad_monthly_stats")
    .select("*")
    .eq("month_start", currentMonth)
    .single();

  if (!currentStats) return 0;

  // Expire old alerts
  await supabase
    .from("ad_alerts")
    .delete()
    .lt("expires_at", new Date().toISOString());

  // Check MER decline (>15% drop)
  if (currentStats.mer_mom_change !== null && currentStats.mer_mom_change < -0.15) {
    const { error } = await supabase.from("ad_alerts").upsert({
      alert_type: "mer_decline",
      severity: "critical",
      channel: null,
      title: "MER Declining",
      description: `Marketing efficiency dropped ${Math.abs(currentStats.mer_mom_change * 100).toFixed(1)}% vs last month. Current MER: ${currentStats.mer?.toFixed(2)}x`,
      metric_value: currentStats.mer?.toFixed(2),
      action_recommended: "Review overall marketing efficiency. Check if ad spend increased without proportional revenue lift.",
      is_dismissed: false,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    }, { onConflict: "alert_type,channel" });

    if (!error) alertCount++;
  }

  // Check nCAC increase (>25% rise or >$100)
  const ncacThreshold = 100;
  if (
    (currentStats.ncac_mom_change !== null && currentStats.ncac_mom_change > 0.25) ||
    (currentStats.ncac !== null && currentStats.ncac > ncacThreshold)
  ) {
    const { error } = await supabase.from("ad_alerts").upsert({
      alert_type: "ncac_high",
      severity: "warning",
      channel: null,
      title: "High New Customer Acquisition Cost",
      description: `nCAC is $${currentStats.ncac?.toFixed(2)}${currentStats.ncac_mom_change ? ` (${currentStats.ncac_mom_change > 0 ? "+" : ""}${(currentStats.ncac_mom_change * 100).toFixed(1)}% vs last month)` : ""}`,
      metric_value: `$${currentStats.ncac?.toFixed(2)}`,
      action_recommended: "Review acquisition campaigns. Consider shifting budget to more efficient channels.",
      is_dismissed: false,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: "alert_type,channel" });

    if (!error) alertCount++;
  }

  // Check for creative fatigue alerts
  const { data: fatiguedAds } = await supabase
    .from("meta_ad_creative_stats")
    .select("meta_ad_id, ad_name, ctr_vs_peak, fatigue_severity")
    .eq("is_active", true)
    .eq("is_fatigued", true)
    .order("lifetime_spend", { ascending: false })
    .limit(5);

  if (fatiguedAds && fatiguedAds.length > 0) {
    const adList = fatiguedAds.map((a) => a.ad_name || a.meta_ad_id).slice(0, 3).join(", ");
    const { error } = await supabase.from("ad_alerts").upsert({
      alert_type: "creative_fatigue",
      severity: "warning",
      channel: "meta",
      title: `${fatiguedAds.length} Creatives Showing Fatigue`,
      description: `These ads have CTR declining significantly from their peak: ${adList}${fatiguedAds.length > 3 ? ` +${fatiguedAds.length - 3} more` : ""}`,
      metric_value: fatiguedAds.length.toString(),
      action_recommended: "Consider refreshing creative or pausing fatigued ads to improve campaign efficiency.",
      is_dismissed: false,
      expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days
    }, { onConflict: "alert_type,channel" });

    if (!error) alertCount++;
  }

  return alertCount;
}

// POST handler for manual triggers
export async function POST(request: Request) {
  return GET(request);
}
