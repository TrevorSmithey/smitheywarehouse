/**
 * Google Ads Sync Cron Job
 * Syncs campaign performance data from Google Ads API to Supabase
 *
 * Triggered by Vercel cron daily at 7:00 AM UTC (2:00 AM EST)
 *
 * Syncs:
 * - Campaign insights (90 days to capture attribution changes)
 * - Daily aggregated stats
 *
 * After initial historical backfill (separate script), this job
 * maintains a rolling 90-day window of fresh attribution data.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createGoogleAdsClient, type GoogleCampaignInsight } from "@/lib/google-ads";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";

const LOCK_NAME = "sync-google-ads";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

// Timeout threshold - alert if we exceed 80% of maxDuration
const TIMEOUT_WARNING_THRESHOLD = maxDuration * 0.8 * 1000;

// Batch size for upserts
const UPSERT_BATCH_SIZE = 100;

// 90-day lookback for attribution changes
const LOOKBACK_DAYS = 90;

export async function GET(request: Request) {
  // Verify cron secret
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  // Acquire lock to prevent concurrent runs
  const lock = await acquireCronLock(supabase, LOCK_NAME);
  if (!lock.acquired) {
    console.warn(`[GOOGLE] Skipping sync - another sync is in progress`);
    return NextResponse.json(
      { success: false, error: "Another sync is already in progress", skipped: true },
      { status: 409 }
    );
  }

  const stats = {
    campaignsSynced: 0,
    dailyStatsUpdated: 0,
    errors: 0,
  };

  try {
    console.log("[GOOGLE SYNC] Starting sync...");

    // Check for required env vars
    const required = [
      "GOOGLE_ADS_DEVELOPER_TOKEN",
      "GOOGLE_ADS_CLIENT_ID",
      "GOOGLE_ADS_CLIENT_SECRET",
      "GOOGLE_ADS_REFRESH_TOKEN",
      "GOOGLE_ADS_CUSTOMER_ID",
    ];

    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      console.log("[GOOGLE SYNC] Missing configuration:", missing.join(", "));
      return NextResponse.json(
        { error: `Missing Google Ads configuration: ${missing.join(", ")}` },
        { status: 500 }
      );
    }

    const googleAds = createGoogleAdsClient();

    // Calculate date range (90 days for attribution changes)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - LOOKBACK_DAYS);

    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];

    console.log(`[GOOGLE SYNC] Date range: ${startDateStr} to ${endDateStr}`);

    // Log sync start
    await supabase.from("ad_sync_logs").insert({
      sync_type: "google",
      status: "running",
      started_at: new Date().toISOString(),
      metadata: { startDate: startDateStr, endDate: endDateStr },
    });

    // ============================================================
    // 1. Test connection
    // ============================================================
    console.log("[GOOGLE SYNC] Testing connection...");
    const connectionTest = await googleAds.testConnection();

    if (!connectionTest.success) {
      throw new Error(`Connection failed: ${connectionTest.error}`);
    }
    console.log(`[GOOGLE SYNC] Connected to: ${connectionTest.accountName}`);

    // ============================================================
    // 2. Fetch and sync campaign insights
    // ============================================================
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
        console.error(`[GOOGLE SYNC] Error upserting campaign batch:`, error);
        stats.errors++;
      } else {
        stats.campaignsSynced += batch.length;
      }
    }

    console.log(`[GOOGLE SYNC] Synced ${stats.campaignsSynced} campaign records`);

    // ============================================================
    // 3. Aggregate daily stats
    // ============================================================
    console.log("[GOOGLE SYNC] Aggregating daily stats...");

    stats.dailyStatsUpdated = await aggregateDailyStats(
      supabase,
      startDateStr,
      endDateStr
    );

    // ============================================================
    // Done
    // ============================================================
    const duration = Date.now() - startTime;
    console.log(`[GOOGLE SYNC] Complete in ${duration}ms:`, stats);

    // Check for timeout warning
    const approachedTimeout = duration > TIMEOUT_WARNING_THRESHOLD;
    if (approachedTimeout) {
      console.warn(
        `[GOOGLE SYNC] WARNING: Sync took ${(duration / 1000).toFixed(1)}s - approaching timeout limit`
      );
    }

    // Update sync log
    await supabase
      .from("ad_sync_logs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        records_synced: stats.campaignsSynced,
        metadata: { startDate: startDateStr, endDate: endDateStr, stats },
      })
      .eq("sync_type", "google")
      .eq("status", "running");

    return NextResponse.json({
      success: true,
      ...stats,
      duration,
      dateRange: { startDate: startDateStr, endDate: endDateStr },
      ...(approachedTimeout && { warning: "Approaching timeout threshold" }),
    });
  } catch (error) {
    console.error("[GOOGLE SYNC] Fatal error:", error);

    const errorMessage = error instanceof Error ? error.message : "Sync failed";
    const elapsed = Date.now() - startTime;

    // Update sync log
    await supabase
      .from("ad_sync_logs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: errorMessage,
      })
      .eq("sync_type", "google")
      .eq("status", "running");

    return NextResponse.json(
      { error: errorMessage, duration: elapsed },
      { status: 500 }
    );
  } finally {
    await releaseCronLock(supabase, LOCK_NAME);
  }
}

/**
 * Aggregate daily Google stats into ad_daily_stats
 */
async function aggregateDailyStats(
  supabase: ReturnType<typeof createServiceClient>,
  startDate: string,
  endDate: string
): Promise<number> {
  // Query aggregated daily totals from google_campaigns
  const { data: dailyData, error: queryError } = await supabase
    .from("google_campaigns")
    .select("date, spend, impressions, clicks, conversions, conversion_value")
    .gte("date", startDate)
    .lte("date", endDate);

  if (queryError) {
    console.error("[GOOGLE SYNC] Error querying daily aggregates:", queryError);
    return 0;
  }

  // Group by date
  const dailyTotals = new Map<
    string,
    {
      google_spend: number;
      google_impressions: number;
      google_clicks: number;
      google_conversions: number;
      google_revenue: number;
    }
  >();

  for (const row of dailyData || []) {
    const existing = dailyTotals.get(row.date) || {
      google_spend: 0,
      google_impressions: 0,
      google_clicks: 0,
      google_conversions: 0,
      google_revenue: 0,
    };

    existing.google_spend += parseFloat(row.spend) || 0;
    existing.google_impressions += parseInt(row.impressions) || 0;
    existing.google_clicks += parseInt(row.clicks) || 0;
    existing.google_conversions += parseFloat(row.conversions) || 0;
    existing.google_revenue += parseFloat(row.conversion_value) || 0;

    dailyTotals.set(row.date, existing);
  }

  // Upsert daily stats using atomic database function
  // This prevents race conditions with sync-meta by only updating Google columns
  let updated = 0;

  for (const [date, totals] of dailyTotals) {
    const { error } = await supabase.rpc("upsert_ad_daily_stats_google", {
      p_date: date,
      p_google_spend: totals.google_spend,
      p_google_impressions: totals.google_impressions,
      p_google_clicks: totals.google_clicks,
      p_google_conversions: totals.google_conversions,
      p_google_revenue: totals.google_revenue,
    });

    if (error) {
      console.error(`[GOOGLE SYNC] Error upserting daily stats for ${date}:`, error);
    } else {
      updated++;
    }
  }

  return updated;
}

// POST handler for manual triggers
export async function POST(request: Request) {
  return GET(request);
}
