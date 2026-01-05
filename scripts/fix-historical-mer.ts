/**
 * Fix Historical MER Data
 *
 * Repairs the monthly stats that had incorrect shopify_revenue
 * due to a timezone bug in the date calculation.
 *
 * The bug: `new Date("2025-03-01")` parses as UTC, which in EST
 * becomes Feb 28 at 7 PM, causing the month calculation to be off.
 *
 * This script:
 * 1. Recomputes ad_daily_stats.shopify_revenue from daily_stats
 * 2. Recomputes ad_monthly_stats with correct MER values
 *
 * Run once to fix historical data:
 *   npx tsx scripts/fix-historical-mer.ts
 */

import { createClient } from "@supabase/supabase-js";

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

async function main() {
  console.log("=".repeat(60));
  console.log("FIX HISTORICAL MER DATA");
  console.log("=".repeat(60));

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing required environment variables!");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // ============================================================
  // 1. Update ad_daily_stats with shopify_revenue from daily_stats
  // ============================================================
  console.log("\n[1/3] Fetching all daily_stats data...");

  const { data: dailyStats, error: dailyError } = await supabase
    .from("daily_stats")
    .select("date, total_revenue")
    .order("date");

  if (dailyError) {
    console.error("Error fetching daily_stats:", dailyError);
    process.exit(1);
  }

  console.log(`  Found ${dailyStats?.length || 0} days of Shopify data`);

  // Create lookup map
  const revenueByDate = new Map<string, number>();
  for (const row of dailyStats || []) {
    revenueByDate.set(row.date, parseFloat(row.total_revenue) || 0);
  }

  // Get all ad_daily_stats records
  const { data: adDaily, error: adError } = await supabase
    .from("ad_daily_stats")
    .select("date, total_spend")
    .order("date");

  if (adError) {
    console.error("Error fetching ad_daily_stats:", adError);
    process.exit(1);
  }

  console.log(`  Found ${adDaily?.length || 0} days of ad data`);

  // Get new customer counts
  console.log("\n[2/3] Fetching new customer data...");

  const { data: orders } = await supabase
    .from("orders")
    .select("created_at")
    .eq("is_first_order", true)
    .eq("canceled", false);

  const newCustByDate = new Map<string, number>();
  for (const order of orders || []) {
    const date = order.created_at.split("T")[0];
    newCustByDate.set(date, (newCustByDate.get(date) || 0) + 1);
  }

  console.log(`  Found ${orders?.length || 0} first-time orders`);

  // Update ad_daily_stats with shopify_revenue and compute MER
  console.log("\n[3/3] Updating ad_daily_stats with Shopify revenue...");

  let updatedCount = 0;
  const batchSize = 50;

  for (let i = 0; i < (adDaily?.length || 0); i += batchSize) {
    const batch = (adDaily || []).slice(i, i + batchSize);

    for (const row of batch) {
      const revenue = revenueByDate.get(row.date) || 0;
      const spend = parseFloat(row.total_spend) || 0;
      const newCust = newCustByDate.get(row.date) || 0;

      const mer = spend > 0 && revenue > 0 ? revenue / spend : null;
      const ncac = spend > 0 && newCust > 0 ? spend / newCust : null;

      const { error } = await supabase
        .from("ad_daily_stats")
        .update({
          shopify_revenue: revenue || null,
          new_customer_count: newCust || null,
          mer,
          ncac,
          computed_at: new Date().toISOString(),
        })
        .eq("date", row.date);

      if (!error) {
        updatedCount++;
      }
    }

    // Progress indicator
    console.log(`  Updated ${Math.min(i + batchSize, adDaily?.length || 0)}/${adDaily?.length || 0} days`);
  }

  console.log(`\n  ✓ Updated ${updatedCount} daily records`);

  // ============================================================
  // 4. Recompute all monthly stats with correct aggregation
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("RECOMPUTING MONTHLY STATS");
  console.log("=".repeat(60));

  // Get unique months from ad_monthly_stats
  const { data: existingMonths } = await supabase
    .from("ad_monthly_stats")
    .select("month_start")
    .order("month_start", { ascending: false });

  console.log(`\nRecomputing ${existingMonths?.length || 0} months...`);

  let monthsUpdated = 0;

  for (const m of existingMonths || []) {
    const monthStart = m.month_start; // "YYYY-MM-01"

    // Parse correctly to avoid timezone issues
    const [year, month] = monthStart.split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate(); // Last day of the month
    const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    // Aggregate from ad_daily_stats
    const { data: dailyAgg } = await supabase
      .from("ad_daily_stats")
      .select("meta_spend, google_spend, total_spend, meta_purchases, google_conversions, shopify_revenue, new_customer_count")
      .gte("date", monthStart)
      .lte("date", monthEnd);

    const agg = (dailyAgg || []).reduce(
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

    // Calculate MER/nCAC
    const mer = agg.total_spend > 0 && agg.shopify_revenue > 0
      ? agg.shopify_revenue / agg.total_spend
      : null;

    const ncac = agg.total_spend > 0 && agg.new_customer_count > 0
      ? agg.total_spend / agg.new_customer_count
      : null;

    const blendedCpa = (agg.meta_purchases + agg.google_conversions) > 0
      ? agg.total_spend / (agg.meta_purchases + agg.google_conversions)
      : null;

    // Upsert
    const { error } = await supabase
      .from("ad_monthly_stats")
      .upsert({
        month_start: monthStart,
        meta_spend: agg.meta_spend,
        google_spend: agg.google_spend,
        total_spend: agg.total_spend,
        meta_purchases: agg.meta_purchases,
        google_conversions: agg.google_conversions,
        shopify_revenue: agg.shopify_revenue,
        new_customer_count: agg.new_customer_count,
        mer,
        ncac,
        blended_cpa: blendedCpa,
        computed_at: new Date().toISOString(),
      }, { onConflict: "month_start" });

    if (!error) {
      monthsUpdated++;
      const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
      console.log(`  ${monthLabel}: Spend $${agg.total_spend.toFixed(0)}, Rev $${agg.shopify_revenue.toFixed(0)}, MER ${mer?.toFixed(2) || "—"}x`);
    }
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("FIX COMPLETE");
  console.log("=".repeat(60));
  console.log(`  Daily stats updated: ${updatedCount}`);
  console.log(`  Monthly stats updated: ${monthsUpdated}`);
  console.log("\nThe MER values should now be accurate for all historical months.");
}

main().catch(console.error);
