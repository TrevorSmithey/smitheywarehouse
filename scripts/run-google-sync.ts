/**
 * Manual trigger for Google Ads sync
 * Runs the full 90-day sync and saves to database
 */

import { createClient } from "@supabase/supabase-js";
import { createGoogleAdsClient, type GoogleCampaignInsight } from "../lib/google-ads";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const UPSERT_BATCH_SIZE = 100;
const LOOKBACK_DAYS = 90;

async function runSync() {
  const startTime = Date.now();
  console.log("[GOOGLE SYNC] Starting full sync...");

  const stats = {
    campaignsSynced: 0,
    dailyStatsUpdated: 0,
    errors: 0,
  };

  try {
    const googleAds = createGoogleAdsClient();

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - LOOKBACK_DAYS);

    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];

    console.log(`[GOOGLE SYNC] Date range: ${startDateStr} to ${endDateStr}`);

    // Test connection
    const connectionTest = await googleAds.testConnection();
    if (!connectionTest.success) {
      throw new Error(`Connection failed: ${connectionTest.error}`);
    }
    console.log(`[GOOGLE SYNC] Connected to: ${connectionTest.accountName}`);

    // Fetch campaign insights
    console.log("[GOOGLE SYNC] Fetching campaign insights...");
    const campaignInsights = await googleAds.getCampaignInsights(startDateStr, endDateStr);
    console.log(`[GOOGLE SYNC] Retrieved ${campaignInsights.length} campaign insight records`);

    // Upsert in batches
    for (let i = 0; i < campaignInsights.length; i += UPSERT_BATCH_SIZE) {
      const batch = campaignInsights.slice(i, i + UPSERT_BATCH_SIZE);

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
        console.error(`[GOOGLE SYNC] Error upserting batch:`, error);
        stats.errors++;
      } else {
        stats.campaignsSynced += batch.length;
        process.stdout.write(`\r[GOOGLE SYNC] Synced ${stats.campaignsSynced} / ${campaignInsights.length}`);
      }
    }
    console.log();

    // Aggregate daily stats
    console.log("[GOOGLE SYNC] Aggregating daily stats...");

    // Group by date
    const dailyTotals = new Map<string, {
      google_spend: number;
      google_impressions: number;
      google_clicks: number;
      google_conversions: number;
      google_revenue: number;
    }>();

    for (const insight of campaignInsights) {
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

      const { error } = await supabase.from("ad_daily_stats").upsert(
        {
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
        },
        { onConflict: "date" }
      );

      if (error) {
        console.error(`[GOOGLE SYNC] Error upserting daily stats for ${date}:`, error);
        stats.errors++;
      } else {
        stats.dailyStatsUpdated++;
      }
    }

    // Log sync completion
    await supabase.from("ad_sync_logs").insert({
      sync_type: "google",
      status: "completed",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      records_synced: stats.campaignsSynced,
      metadata: { startDate: startDateStr, endDate: endDateStr, stats },
    });

    const duration = Date.now() - startTime;
    console.log(`\n[GOOGLE SYNC] Complete in ${(duration / 1000).toFixed(1)}s:`, stats);

  } catch (error) {
    console.error("[GOOGLE SYNC] Fatal error:", error);
    process.exit(1);
  }
}

runSync();
