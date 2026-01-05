/**
 * Google Ads Historical Backfill
 *
 * Fetches historical campaign data going back to match Meta coverage.
 * Run in batches by month to avoid timeouts.
 *
 * Usage:
 *   source .env.local && npx tsx scripts/backfill-google-historical.ts
 *
 * Or with specific date range:
 *   source .env.local && npx tsx scripts/backfill-google-historical.ts 2023-01-01 2025-10-06
 */

import { createClient } from "@supabase/supabase-js";
import { createGoogleAdsClient, type GoogleCampaignInsight } from "../lib/google-ads";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const UPSERT_BATCH_SIZE = 100;

interface MonthRange {
  start: string;
  end: string;
  label: string;
}

function getMonthRanges(startDate: string, endDate: string): MonthRange[] {
  const ranges: MonthRange[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  const current = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current <= end) {
    const year = current.getFullYear();
    const month = current.getMonth();

    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0); // Last day of month

    // Don't go past the end date
    const actualEnd = monthEnd > end ? end : monthEnd;

    ranges.push({
      start: monthStart.toISOString().split("T")[0],
      end: actualEnd.toISOString().split("T")[0],
      label: `${year}-${String(month + 1).padStart(2, "0")}`,
    });

    current.setMonth(current.getMonth() + 1);
  }

  return ranges;
}

async function backfillMonth(
  client: ReturnType<typeof createGoogleAdsClient>,
  month: MonthRange
): Promise<{ synced: number; errors: number }> {
  const stats = { synced: 0, errors: 0 };

  try {
    const insights = await client.getCampaignInsights(month.start, month.end);

    if (insights.length === 0) {
      console.log(`  [${month.label}] No data`);
      return stats;
    }

    // Upsert in batches
    for (let i = 0; i < insights.length; i += UPSERT_BATCH_SIZE) {
      const batch = insights.slice(i, i + UPSERT_BATCH_SIZE);

      const records = batch.map((insight: GoogleCampaignInsight) => ({
        google_campaign_id: insight.google_campaign_id,
        name: insight.name,
        status: insight.status,
        campaign_type: insight.campaign_type,
        date: insight.date,
        spend: insight.spend,
        impressions: insight.impressions,
        clicks: insight.clicks,
        ctr: insight.ctr,
        cpc: insight.cpc,
        cpm: insight.cpm,
        conversions: insight.conversions,
        conversion_value: insight.conversion_value,
        cost_per_conversion: insight.cost_per_conversion,
        search_impression_share: insight.search_impression_share,
        platform_roas: insight.platform_roas,
        synced_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from("google_campaigns")
        .upsert(records, { onConflict: "google_campaign_id,date" });

      if (error) {
        console.error(`  [${month.label}] Upsert error:`, error.message);
        stats.errors++;
      } else {
        stats.synced += batch.length;
      }
    }

    // Also update ad_daily_stats for this month
    await updateDailyStats(insights);

    console.log(`  [${month.label}] Synced ${stats.synced} records`);

  } catch (error) {
    console.error(`  [${month.label}] Error:`, error instanceof Error ? error.message : error);
    stats.errors++;
  }

  return stats;
}

async function updateDailyStats(insights: GoogleCampaignInsight[]): Promise<void> {
  // Group by date
  const dailyTotals = new Map<string, {
    google_spend: number;
    google_impressions: number;
    google_clicks: number;
    google_conversions: number;
    google_revenue: number;
  }>();

  for (const insight of insights) {
    const existing = dailyTotals.get(insight.date) || {
      google_spend: 0,
      google_impressions: 0,
      google_clicks: 0,
      google_conversions: 0,
      google_revenue: 0,
    };

    existing.google_spend += insight.spend;
    existing.google_impressions += insight.impressions;
    existing.google_clicks += insight.clicks;
    existing.google_conversions += insight.conversions;
    existing.google_revenue += insight.conversion_value;

    dailyTotals.set(insight.date, existing);
  }

  // Upsert daily stats
  for (const [date, totals] of dailyTotals) {
    // Get existing row to preserve Meta data
    const { data: existing } = await supabase
      .from("ad_daily_stats")
      .select("meta_spend, meta_impressions, meta_clicks, meta_purchases, meta_revenue")
      .eq("date", date)
      .single();

    const metaSpend = parseFloat(String(existing?.meta_spend || 0));
    const totalSpend = metaSpend + totals.google_spend;

    await supabase.from("ad_daily_stats").upsert({
      date,
      meta_spend: existing?.meta_spend || 0,
      meta_impressions: existing?.meta_impressions || 0,
      meta_clicks: existing?.meta_clicks || 0,
      meta_purchases: existing?.meta_purchases || 0,
      meta_revenue: existing?.meta_revenue || 0,
      google_spend: totals.google_spend,
      google_impressions: totals.google_impressions,
      google_clicks: totals.google_clicks,
      google_conversions: totals.google_conversions,
      google_revenue: totals.google_revenue,
      total_spend: totalSpend,
      computed_at: new Date().toISOString(),
    }, { onConflict: "date" });
  }
}

async function main() {
  const startTime = Date.now();

  // Parse args or use defaults
  const args = process.argv.slice(2);
  const startDate = args[0] || "2023-01-01";
  const endDate = args[1] || "2025-10-06"; // Day before current data starts

  console.log("========================================");
  console.log("Google Ads Historical Backfill");
  console.log("========================================");
  console.log(`Date range: ${startDate} to ${endDate}`);

  const googleAds = createGoogleAdsClient();

  // Test connection
  const connection = await googleAds.testConnection();
  if (!connection.success) {
    console.error("Connection failed:", connection.error);
    process.exit(1);
  }
  console.log(`Connected to: ${connection.accountName}\n`);

  // Get month ranges
  const months = getMonthRanges(startDate, endDate);
  console.log(`Will process ${months.length} months\n`);

  let totalSynced = 0;
  let totalErrors = 0;

  for (let i = 0; i < months.length; i++) {
    const month = months[i];
    process.stdout.write(`[${i + 1}/${months.length}] ${month.label}... `);

    const result = await backfillMonth(googleAds, month);
    totalSynced += result.synced;
    totalErrors += result.errors;

    // Small delay between months to avoid rate limits
    if (i < months.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  const duration = (Date.now() - startTime) / 1000;

  console.log("\n========================================");
  console.log("Backfill Complete");
  console.log("========================================");
  console.log(`Total records synced: ${totalSynced}`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`Duration: ${duration.toFixed(1)}s`);

  // Now recompute monthly stats
  console.log("\nRecomputing monthly stats...");
  await recomputeMonthlyStats(startDate, endDate);

  console.log("\nDone!");
}

async function recomputeMonthlyStats(startDate: string, endDate: string): Promise<void> {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start.getFullYear(), start.getMonth(), 1);

  let updated = 0;

  while (current <= end) {
    const year = current.getFullYear();
    const month = current.getMonth();
    const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const monthEnd = new Date(year, month + 1, 0).toISOString().split("T")[0];

    // Aggregate daily stats
    const { data: monthlyAgg } = await supabase
      .from("ad_daily_stats")
      .select("meta_spend, google_spend, total_spend, meta_purchases, google_conversions, shopify_revenue, new_customer_count")
      .gte("date", monthStart)
      .lte("date", monthEnd);

    if (!monthlyAgg || monthlyAgg.length === 0) {
      current.setMonth(current.getMonth() + 1);
      continue;
    }

    const monthData = monthlyAgg.reduce(
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

    await supabase.from("ad_monthly_stats").upsert({
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

    updated++;
    current.setMonth(current.getMonth() + 1);
  }

  console.log(`Updated ${updated} monthly records`);
}

main().catch(console.error);
