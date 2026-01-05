/**
 * Manual trigger for compute-ad-metrics
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function runCompute() {
  const startTime = Date.now();
  console.log("[AD METRICS] Starting computation...");

  const stats = {
    dailyUpdated: 0,
    monthlyUpdated: 0,
    errors: 0,
  };

  // Get date range - compute for last 90 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);

  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  console.log(`[AD METRICS] Date range: ${startDateStr} to ${endDateStr}`);

  // Get all daily ad stats
  const { data: adDaily, error: adError } = await supabase
    .from("ad_daily_stats")
    .select("date, total_spend, meta_spend, google_spend")
    .gte("date", startDateStr)
    .lte("date", endDateStr);

  if (adError) throw adError;

  // Get Shopify daily stats
  const { data: shopifyDaily, error: shopifyError } = await supabase
    .from("daily_stats")
    .select("date, total_revenue, total_orders")
    .gte("date", startDateStr)
    .lte("date", endDateStr);

  if (shopifyError) throw shopifyError;

  // Get new customer counts by day
  const { data: newCustomers, error: ncError } = await supabase
    .from("orders")
    .select("created_at, shopify_customer_id")
    .eq("is_first_order", true)
    .eq("canceled", false)
    .gte("created_at", startDateStr)
    .lte("created_at", endDateStr + "T23:59:59");

  if (ncError) throw ncError;

  // Group new customers by date
  const newCustomersByDate = new Map<string, number>();
  for (const order of newCustomers || []) {
    const date = order.created_at.split("T")[0];
    newCustomersByDate.set(date, (newCustomersByDate.get(date) || 0) + 1);
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

    let mer: number | null = null;
    if (totalSpend > 0 && shopify?.revenue) {
      mer = shopify.revenue / totalSpend;
    }

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
      stats.errors++;
    } else {
      stats.dailyUpdated++;
    }
  }

  console.log(`[AD METRICS] Updated ${stats.dailyUpdated} daily records`);

  // Compute monthly rollups
  console.log("[AD METRICS] Computing monthly rollups...");

  const months = getMonthsInRange(startDateStr, endDateStr);

  for (const month of months) {
    const monthStart = `${month}-01`;
    const monthEnd = getLastDayOfMonth(month);

    const { data: monthlyAgg } = await supabase
      .from("ad_daily_stats")
      .select("meta_spend, google_spend, total_spend, meta_purchases, google_conversions, shopify_revenue, new_customer_count")
      .gte("date", monthStart)
      .lte("date", monthEnd);

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

    const mer = monthData.total_spend > 0 ? monthData.shopify_revenue / monthData.total_spend : null;
    const ncac = monthData.new_customer_count > 0 ? monthData.total_spend / monthData.new_customer_count : null;
    const blendedCpa = (monthData.meta_purchases + monthData.google_conversions) > 0
      ? monthData.total_spend / (monthData.meta_purchases + monthData.google_conversions)
      : null;

    const { error } = await supabase.from("ad_monthly_stats").upsert({
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
      computed_at: new Date().toISOString(),
    }, { onConflict: "month_start" });

    if (!error) {
      stats.monthlyUpdated++;
    } else {
      stats.errors++;
    }
  }

  console.log(`[AD METRICS] Updated ${stats.monthlyUpdated} monthly records`);

  const duration = Date.now() - startTime;
  console.log(`\n[AD METRICS] Complete in ${(duration / 1000).toFixed(1)}s:`, stats);
}

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

function getLastDayOfMonth(monthStr: string): string {
  const [year, month] = monthStr.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${monthStr}-${String(lastDay).padStart(2, "0")}`;
}

runCompute().catch(console.error);
