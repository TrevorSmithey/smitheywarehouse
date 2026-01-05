/**
 * Compute Historical MER/nCAC Metrics
 *
 * Calculates MER and nCAC for the full historical date range.
 * Run this after historical backfills to populate all metrics.
 *
 * Usage:
 *   source .env.local && npx tsx scripts/compute-historical-metrics.ts
 *
 * Or with specific date range:
 *   source .env.local && npx tsx scripts/compute-historical-metrics.ts 2023-01-01 2026-01-05
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function computeHistoricalMetrics() {
  const startTime = Date.now();

  // Parse args or use defaults
  const args = process.argv.slice(2);
  const startDateStr = args[0] || "2023-01-01";
  const endDateStr = args[1] || new Date().toISOString().split("T")[0];

  console.log("========================================");
  console.log("Historical MER/nCAC Computation");
  console.log("========================================");
  console.log(`Date range: ${startDateStr} to ${endDateStr}`);

  const stats = {
    dailyUpdated: 0,
    monthlyUpdated: 0,
    errors: 0,
  };

  // Get all daily ad stats in date range
  console.log("\n[1/4] Fetching ad daily stats...");
  const { data: adDaily, error: adError } = await supabase
    .from("ad_daily_stats")
    .select("date, total_spend, meta_spend, google_spend")
    .gte("date", startDateStr)
    .lte("date", endDateStr)
    .order("date");

  if (adError) throw adError;
  console.log(`  Found ${adDaily?.length || 0} daily ad records`);

  // Get Shopify daily stats
  console.log("[2/4] Fetching Shopify daily stats...");
  const { data: shopifyDaily, error: shopifyError } = await supabase
    .from("daily_stats")
    .select("date, total_revenue, total_orders")
    .gte("date", startDateStr)
    .lte("date", endDateStr);

  if (shopifyError) throw shopifyError;
  console.log(`  Found ${shopifyDaily?.length || 0} Shopify daily records`);

  // Get new customer counts by day (first orders)
  console.log("[3/4] Fetching first-order customers...");
  const { data: newCustomers, error: ncError } = await supabase
    .from("orders")
    .select("created_at, shopify_customer_id")
    .eq("is_first_order", true)
    .eq("canceled", false)
    .gte("created_at", startDateStr)
    .lte("created_at", endDateStr + "T23:59:59");

  if (ncError) throw ncError;
  console.log(`  Found ${newCustomers?.length || 0} first orders`);

  // Group new customers by date
  const newCustomersByDate = new Map<string, number>();
  for (const order of newCustomers || []) {
    const date = order.created_at.split("T")[0];
    newCustomersByDate.set(date, (newCustomersByDate.get(date) || 0) + 1);
  }

  // Create Shopify lookup map
  const shopifyByDate = new Map<string, { revenue: number; orders: number }>();
  for (const row of shopifyDaily || []) {
    shopifyByDate.set(row.date, {
      revenue: parseFloat(row.total_revenue) || 0,
      orders: parseInt(row.total_orders) || 0,
    });
  }

  // Update ad_daily_stats with MER/nCAC
  console.log("[4/4] Computing daily MER/nCAC...");
  const batchSize = 50;
  let processed = 0;

  for (let i = 0; i < (adDaily?.length || 0); i += batchSize) {
    const batch = adDaily!.slice(i, i + batchSize);

    for (const row of batch) {
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

    processed += batch.length;
    process.stdout.write(`\r  Updated ${processed} / ${adDaily?.length || 0} daily records`);
  }
  console.log();

  // Compute monthly rollups
  console.log("\nComputing monthly rollups...");
  const months = getMonthsInRange(startDateStr, endDateStr);
  console.log(`  Processing ${months.length} months...`);

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
      console.error(`  Error updating ${month}:`, error.message);
      stats.errors++;
    }
  }

  const duration = (Date.now() - startTime) / 1000;

  console.log("\n========================================");
  console.log("Computation Complete");
  console.log("========================================");
  console.log(`Daily records updated: ${stats.dailyUpdated}`);
  console.log(`Monthly records updated: ${stats.monthlyUpdated}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Duration: ${duration.toFixed(1)}s`);

  // Show sample of monthly stats
  console.log("\nSample monthly stats (most recent 6 months):");
  const { data: sample } = await supabase
    .from("ad_monthly_stats")
    .select("month_start, total_spend, shopify_revenue, mer, new_customer_count, ncac")
    .order("month_start", { ascending: false })
    .limit(6);

  if (sample) {
    for (const row of sample.reverse()) {
      const spendK = (row.total_spend / 1000).toFixed(0);
      const revK = (row.shopify_revenue / 1000).toFixed(0);
      const merStr = row.mer ? row.mer.toFixed(2) : "N/A";
      const ncacStr = row.ncac ? `$${row.ncac.toFixed(0)}` : "N/A";
      console.log(`  ${row.month_start}: $${spendK}K spend, $${revK}K rev, MER ${merStr}x, nCAC ${ncacStr} (${row.new_customer_count || 0} new)`);
    }
  }

  console.log("\nDone!");
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

computeHistoricalMetrics().catch(console.error);
