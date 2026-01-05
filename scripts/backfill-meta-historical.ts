/**
 * Meta Historical Backfill Script
 *
 * Pulls the maximum available historical data from Meta Marketing API (37 months)
 * to enable YoY comparisons and trend analysis.
 *
 * Run once after initial setup:
 *   npx tsx scripts/backfill-meta-historical.ts
 *
 * This script:
 * 1. Pulls campaign insights month by month (to avoid timeouts)
 * 2. Aggregates into ad_daily_stats and ad_monthly_stats
 * 3. Computes MER by joining with existing Shopify data
 *
 * After this runs, the daily sync-meta cron maintains rolling 90-day freshness.
 */

import { createClient } from "@supabase/supabase-js";

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN!;
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID!;

// Meta API supports 37 months of data
const HISTORICAL_MONTHS = 37;
const API_VERSION = "v21.0";
const RATE_LIMIT_DELAY = 200; // ms between requests

interface CampaignInsight {
  campaign_id: string;
  campaign_name: string;
  objective?: string;
  date_start: string;
  date_stop: string;
  spend: string;
  impressions: string;
  reach?: string;
  frequency?: string;
  clicks: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
}

async function fetchMetaInsights(
  startDate: string,
  endDate: string
): Promise<CampaignInsight[]> {
  const fields = [
    "campaign_id",
    "campaign_name",
    "objective",
    "spend",
    "impressions",
    "reach",
    "frequency",
    "clicks",
    "ctr",
    "cpc",
    "cpm",
    "actions",
    "action_values",
  ].join(",");

  const url = `https://graph.facebook.com/${API_VERSION}/${META_AD_ACCOUNT_ID}/insights?` +
    `fields=${fields}&` +
    `level=campaign&` +
    `time_range={"since":"${startDate}","until":"${endDate}"}&` +
    `time_increment=1&` +
    `limit=500&` +
    `access_token=${META_ACCESS_TOKEN}`;

  const allData: CampaignInsight[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const response = await fetch(nextUrl);
    if (!response.ok) {
      const error = await response.text();
      console.error(`API error for ${startDate} to ${endDate}:`, error);
      throw new Error(`Meta API error: ${response.status}`);
    }

    const json = await response.json();
    allData.push(...(json.data || []));

    nextUrl = json.paging?.next || null;
    if (nextUrl) {
      await sleep(RATE_LIMIT_DELAY);
    }
  }

  return allData;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMonthRange(monthsAgo: number): { start: string; end: string } {
  const now = new Date();
  const targetMonth = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0);

  return {
    start: targetMonth.toISOString().split("T")[0],
    end: lastDay.toISOString().split("T")[0],
  };
}

function parseCampaignInsight(insight: CampaignInsight) {
  const purchases = insight.actions?.find((a) => a.action_type === "purchase")?.value || "0";
  const purchaseValue = insight.action_values?.find((a) => a.action_type === "purchase")?.value || "0";
  const addToCarts = insight.actions?.find((a) => a.action_type === "add_to_cart")?.value || "0";
  const checkouts = insight.actions?.find((a) => a.action_type === "initiate_checkout")?.value || "0";

  const spend = parseFloat(insight.spend) || 0;
  const purchaseValueNum = parseFloat(purchaseValue) || 0;
  const purchasesNum = parseInt(purchases) || 0;

  return {
    meta_campaign_id: insight.campaign_id,
    name: insight.campaign_name,
    objective: insight.objective || null,
    date: insight.date_start,
    spend,
    impressions: parseInt(insight.impressions) || 0,
    reach: parseInt(insight.reach || "0") || 0,
    frequency: parseFloat(insight.frequency || "0") || null,
    clicks: parseInt(insight.clicks) || 0,
    ctr: parseFloat(insight.ctr || "0") || null,
    cpc: parseFloat(insight.cpc || "0") || null,
    cpm: parseFloat(insight.cpm || "0") || null,
    purchases: purchasesNum,
    purchase_value: purchaseValueNum,
    add_to_carts: parseInt(addToCarts) || 0,
    initiated_checkouts: parseInt(checkouts) || 0,
    platform_roas: spend > 0 ? purchaseValueNum / spend : null,
    synced_at: new Date().toISOString(),
  };
}

async function main() {
  console.log("=".repeat(60));
  console.log("META HISTORICAL BACKFILL");
  console.log("=".repeat(60));
  console.log(`\nPulling ${HISTORICAL_MONTHS} months of historical data...\n`);

  if (!SUPABASE_URL || !SUPABASE_KEY || !META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID) {
    console.error("Missing required environment variables!");
    console.error("Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY, META_ACCESS_TOKEN, META_AD_ACCOUNT_ID");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  let totalCampaigns = 0;
  let totalDays = 0;
  const monthlyAggregates = new Map<string, {
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    revenue: number;
  }>();

  // Process month by month (oldest first)
  for (let monthsAgo = HISTORICAL_MONTHS - 1; monthsAgo >= 0; monthsAgo--) {
    const { start, end } = getMonthRange(monthsAgo);
    const monthLabel = new Date(start).toLocaleDateString("en-US", { month: "short", year: "numeric" });

    console.log(`\n[${monthLabel}] Fetching ${start} to ${end}...`);

    try {
      const insights = await fetchMetaInsights(start, end);
      console.log(`  → Got ${insights.length} campaign-day records`);

      if (insights.length === 0) {
        console.log(`  → No data for this month (likely before ad account existed)`);
        continue;
      }

      // Parse and prepare records
      const records = insights.map(parseCampaignInsight);

      // Upsert to meta_campaigns
      const batchSize = 100;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error } = await supabase
          .from("meta_campaigns")
          .upsert(batch, { onConflict: "meta_campaign_id,date" });

        if (error) {
          console.error(`  → Upsert error:`, error.message);
        }
      }

      totalCampaigns += records.length;

      // Aggregate by day for ad_daily_stats
      const dailyTotals = new Map<string, {
        meta_spend: number;
        meta_impressions: number;
        meta_clicks: number;
        meta_purchases: number;
        meta_revenue: number;
      }>();

      for (const r of records) {
        const existing = dailyTotals.get(r.date) || {
          meta_spend: 0,
          meta_impressions: 0,
          meta_clicks: 0,
          meta_purchases: 0,
          meta_revenue: 0,
        };
        existing.meta_spend += r.spend;
        existing.meta_impressions += r.impressions;
        existing.meta_clicks += r.clicks;
        existing.meta_purchases += r.purchases;
        existing.meta_revenue += r.purchase_value;
        dailyTotals.set(r.date, existing);
      }

      // Upsert daily stats
      for (const [date, totals] of dailyTotals) {
        const { error } = await supabase
          .from("ad_daily_stats")
          .upsert({
            date,
            meta_spend: totals.meta_spend,
            meta_impressions: totals.meta_impressions,
            meta_clicks: totals.meta_clicks,
            meta_purchases: totals.meta_purchases,
            meta_revenue: totals.meta_revenue,
            total_spend: totals.meta_spend, // Google = 0 for now
            computed_at: new Date().toISOString(),
          }, { onConflict: "date" });

        if (error && !error.message.includes("duplicate")) {
          console.error(`  → Daily stats error for ${date}:`, error.message);
        }
      }

      totalDays += dailyTotals.size;

      // Accumulate monthly totals
      const monthKey = start.substring(0, 7) + "-01"; // YYYY-MM-01
      const monthData = monthlyAggregates.get(monthKey) || {
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        revenue: 0,
      };
      for (const totals of dailyTotals.values()) {
        monthData.spend += totals.meta_spend;
        monthData.impressions += totals.meta_impressions;
        monthData.clicks += totals.meta_clicks;
        monthData.purchases += totals.meta_purchases;
        monthData.revenue += totals.meta_revenue;
      }
      monthlyAggregates.set(monthKey, monthData);

      console.log(`  → Synced ${dailyTotals.size} days, $${monthData.spend.toFixed(2)} total spend`);

      // Rate limit between months
      await sleep(500);

    } catch (error) {
      console.error(`  → ERROR:`, error instanceof Error ? error.message : error);
      // Continue to next month on error
    }
  }

  // Now upsert monthly aggregates
  console.log("\n" + "=".repeat(60));
  console.log("COMPUTING MONTHLY STATS WITH MER");
  console.log("=".repeat(60));

  for (const [monthStart, totals] of monthlyAggregates) {
    // Get Shopify revenue for this month
    // Parse date components to avoid timezone issues
    const [year, month] = monthStart.split("-").map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const monthEndStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const { data: shopifyData } = await supabase
      .from("daily_stats")
      .select("total_revenue")
      .gte("date", monthStart)
      .lte("date", monthEndStr);

    const shopifyRevenue = (shopifyData || []).reduce(
      (sum, d) => sum + (parseFloat(d.total_revenue) || 0),
      0
    );

    // Get new customer count
    const { count: newCustomers } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("is_first_order", true)
      .eq("canceled", false)
      .gte("created_at", monthStart)
      .lte("created_at", monthEndStr + "T23:59:59");

    const mer = totals.spend > 0 ? shopifyRevenue / totals.spend : null;
    const ncac = (newCustomers || 0) > 0 ? totals.spend / (newCustomers || 1) : null;

    const { error } = await supabase
      .from("ad_monthly_stats")
      .upsert({
        month_start: monthStart,
        meta_spend: totals.spend,
        google_spend: 0,
        total_spend: totals.spend,
        meta_purchases: totals.purchases,
        google_conversions: 0,
        shopify_revenue: shopifyRevenue,
        new_customer_count: newCustomers || 0,
        mer,
        ncac,
        blended_cpa: totals.purchases > 0 ? totals.spend / totals.purchases : null,
        computed_at: new Date().toISOString(),
      }, { onConflict: "month_start" });

    if (error) {
      console.error(`Monthly stats error for ${monthStart}:`, error.message);
    } else {
      const monthLabel = new Date(monthStart + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
      console.log(`  ${monthLabel}: $${totals.spend.toFixed(0)} spend, $${shopifyRevenue.toFixed(0)} rev, MER ${mer?.toFixed(2) || "—"}x`);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("BACKFILL COMPLETE");
  console.log("=".repeat(60));
  console.log(`  Campaign records: ${totalCampaigns.toLocaleString()}`);
  console.log(`  Daily stats: ${totalDays.toLocaleString()} days`);
  console.log(`  Monthly stats: ${monthlyAggregates.size} months`);
  console.log("\nRun the compute-ad-metrics cron to update MER/nCAC for recent data.");
}

main().catch(console.error);
