/**
 * Meta Ads Sync Cron Job
 * Syncs campaign and ad performance data from Meta Marketing API to Supabase
 *
 * Triggered by Vercel cron daily at 6:30 AM UTC (1:30 AM EST)
 *
 * Syncs:
 * - Campaign insights (90 days to capture attribution changes)
 * - Ad insights (for creative fatigue tracking)
 * - Daily aggregated stats
 *
 * After initial historical backfill (separate script), this job
 * maintains a rolling 90-day window of fresh attribution data.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createMetaClient,
  getDailySyncDateRange,
  type ParsedCampaignInsight,
  type ParsedAdInsight,
} from "@/lib/meta";
import { sendSyncFailureAlert } from "@/lib/notifications";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";

const LOCK_NAME = "sync-meta";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

// Timeout threshold - alert if we exceed 80% of maxDuration
const TIMEOUT_WARNING_THRESHOLD = maxDuration * 0.8 * 1000;

// Batch size for upserts
const UPSERT_BATCH_SIZE = 100;

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
    console.warn(`[META] Skipping sync - another sync is in progress`);
    return NextResponse.json(
      { success: false, error: "Another sync is already in progress", skipped: true },
      { status: 409 }
    );
  }

  const stats = {
    campaignsSynced: 0,
    adsSynced: 0,
    dailyStatsUpdated: 0,
    errors: 0,
  };

  try {
    console.log("[META SYNC] Starting sync...");

    // Check for required env vars
    const accessToken = process.env.META_ACCESS_TOKEN;
    const adAccountId = process.env.META_AD_ACCOUNT_ID;

    if (!accessToken || !adAccountId) {
      return NextResponse.json(
        { error: "Missing Meta configuration (META_ACCESS_TOKEN or META_AD_ACCOUNT_ID)" },
        { status: 500 }
      );
    }

    const meta = createMetaClient();

    // Get date range (90 days for attribution changes)
    const { startDate, endDate } = getDailySyncDateRange();
    console.log(`[META SYNC] Date range: ${startDate} to ${endDate}`);

    // Log sync start
    await supabase.from("ad_sync_logs").insert({
      sync_type: "meta",
      status: "running",
      started_at: new Date().toISOString(),
      metadata: { startDate, endDate },
    });

    // ============================================================
    // 1. Fetch and sync campaign insights
    // ============================================================
    console.log("[META SYNC] Fetching campaign insights...");

    const campaignInsights = await meta.getCampaignInsights(startDate, endDate);
    console.log(`[META SYNC] Retrieved ${campaignInsights.length} campaign insight records`);

    // Get campaign statuses for enrichment
    const campaigns = await meta.getCampaigns();
    const campaignStatusMap = new Map<string, string>();
    for (const c of campaigns) {
      campaignStatusMap.set(c.id, c.status);
    }

    // Upsert in batches
    for (let i = 0; i < campaignInsights.length; i += UPSERT_BATCH_SIZE) {
      const batch = campaignInsights.slice(i, i + UPSERT_BATCH_SIZE);

      const records = batch.map((insight) => ({
        meta_campaign_id: insight.meta_campaign_id,
        name: insight.name,
        status: campaignStatusMap.get(insight.meta_campaign_id) || "UNKNOWN",
        objective: insight.objective,
        date: insight.date,
        spend: insight.spend,
        impressions: insight.impressions,
        reach: insight.reach,
        frequency: insight.frequency,
        clicks: insight.clicks,
        ctr: insight.ctr,
        cpc: insight.cpc,
        cpm: insight.cpm,
        purchases: insight.purchases,
        purchase_value: insight.purchase_value,
        add_to_carts: insight.add_to_carts,
        initiated_checkouts: insight.initiated_checkouts,
        platform_roas: insight.platform_roas,
        synced_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from("meta_campaigns")
        .upsert(records, { onConflict: "meta_campaign_id,date" });

      if (error) {
        console.error(`[META SYNC] Error upserting campaign batch:`, error);
        stats.errors++;
      } else {
        stats.campaignsSynced += batch.length;
      }
    }

    console.log(`[META SYNC] Synced ${stats.campaignsSynced} campaign records`);

    // ============================================================
    // 2. Fetch and sync ad insights (for creative tracking)
    // ============================================================
    console.log("[META SYNC] Fetching ad insights...");

    const adInsights = await meta.getAdInsights(startDate, endDate);
    console.log(`[META SYNC] Retrieved ${adInsights.length} ad insight records`);

    // Get creative details for thumbnail URLs
    // Wrapped in try-catch to prevent entire sync from failing if creative fetch times out
    const uniqueAdIds = [...new Set(adInsights.map((a) => a.meta_ad_id))];
    console.log(`[META SYNC] Fetching creatives for ${uniqueAdIds.length} unique ads...`);

    let creatives = new Map<string, { thumbnail_url?: string; object_type?: string }>();
    try {
      creatives = await meta.getAdCreatives(uniqueAdIds);
      console.log(`[META SYNC] Retrieved ${creatives.size} ad creatives`);
    } catch (creativeError) {
      // Log but don't fail - ads will sync without thumbnails
      console.error("[META SYNC] Failed to fetch creatives (continuing without thumbnails):", creativeError);
      stats.errors++;
    }

    // Upsert ad insights in batches
    for (let i = 0; i < adInsights.length; i += UPSERT_BATCH_SIZE) {
      const batch = adInsights.slice(i, i + UPSERT_BATCH_SIZE);

      const records = batch.map((insight) => {
        const creative = creatives.get(insight.meta_ad_id);
        return {
          meta_ad_id: insight.meta_ad_id,
          meta_adset_id: insight.meta_adset_id,
          meta_campaign_id: insight.meta_campaign_id,
          ad_name: insight.ad_name,
          adset_name: insight.adset_name,
          campaign_name: insight.campaign_name,
          date: insight.date,
          creative_type: creative?.object_type || null,
          thumbnail_url: creative?.thumbnail_url || null,
          spend: insight.spend,
          impressions: insight.impressions,
          clicks: insight.clicks,
          ctr: insight.ctr,
          purchases: insight.purchases,
          purchase_value: insight.purchase_value,
          synced_at: new Date().toISOString(),
        };
      });

      const { error } = await supabase
        .from("meta_ads")
        .upsert(records, { onConflict: "meta_ad_id,date" });

      if (error) {
        console.error(`[META SYNC] Error upserting ad batch:`, error);
        stats.errors++;
      } else {
        stats.adsSynced += batch.length;
      }
    }

    console.log(`[META SYNC] Synced ${stats.adsSynced} ad records`);

    // ============================================================
    // 3. Update creative stats for fatigue detection
    // ============================================================
    console.log("[META SYNC] Updating creative stats...");

    await updateCreativeStats(supabase, adInsights, creatives);

    // ============================================================
    // 4. Aggregate daily stats
    // ============================================================
    console.log("[META SYNC] Aggregating daily stats...");

    stats.dailyStatsUpdated = await aggregateDailyStats(supabase, startDate, endDate);

    // ============================================================
    // Done
    // ============================================================
    const duration = Date.now() - startTime;
    console.log(`[META SYNC] Complete in ${duration}ms:`, stats);

    // Check for timeout warning
    const approachedTimeout = duration > TIMEOUT_WARNING_THRESHOLD;
    if (approachedTimeout) {
      console.warn(`[META SYNC] WARNING: Sync took ${(duration / 1000).toFixed(1)}s - approaching timeout limit`);
      await sendSyncFailureAlert({
        syncType: "Meta Ads",
        error: `WARNING: Sync completed but took ${(duration / 1000).toFixed(1)}s. Consider splitting into smaller jobs.`,
        timestamp: new Date().toISOString(),
      });
    }

    // Update sync log
    await supabase
      .from("ad_sync_logs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        records_synced: stats.campaignsSynced + stats.adsSynced,
        metadata: { startDate, endDate, stats },
      })
      .eq("sync_type", "meta")
      .eq("status", "running");

    return NextResponse.json({
      success: true,
      ...stats,
      duration,
      dateRange: { startDate, endDate },
      ...(approachedTimeout && { warning: "Approaching timeout threshold" }),
    });

  } catch (error) {
    console.error("[META SYNC] Fatal error:", error);

    const errorMessage = error instanceof Error ? error.message : "Sync failed";
    const elapsed = Date.now() - startTime;

    // Send email alert
    await sendSyncFailureAlert({
      syncType: "Meta Ads",
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    // Update sync log
    await supabase
      .from("ad_sync_logs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: errorMessage,
      })
      .eq("sync_type", "meta")
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
 * Update creative stats table for fatigue detection
 */
async function updateCreativeStats(
  supabase: ReturnType<typeof createServiceClient>,
  adInsights: ParsedAdInsight[],
  creatives: Map<string, { thumbnail_url?: string; object_type?: string }>
): Promise<void> {
  // Group insights by ad
  const adStats = new Map<string, {
    ad_name: string | null;
    campaign_name: string | null;
    thumbnail_url: string | null;
    creative_type: string | null;
    totalSpend: number;
    totalImpressions: number;
    totalPurchases: number;
    dailyCtr: { date: string; ctr: number; impressions: number }[];
  }>();

  for (const insight of adInsights) {
    const existing = adStats.get(insight.meta_ad_id);
    const creative = creatives.get(insight.meta_ad_id);

    if (existing) {
      existing.totalSpend += insight.spend;
      existing.totalImpressions += insight.impressions;
      existing.totalPurchases += insight.purchases;
      if (insight.ctr !== null && insight.impressions > 0) {
        existing.dailyCtr.push({
          date: insight.date,
          ctr: insight.ctr,
          impressions: insight.impressions,
        });
      }
    } else {
      adStats.set(insight.meta_ad_id, {
        ad_name: insight.ad_name,
        campaign_name: insight.campaign_name,
        thumbnail_url: creative?.thumbnail_url || insight.thumbnail_url,
        creative_type: creative?.object_type || insight.creative_type,
        totalSpend: insight.spend,
        totalImpressions: insight.impressions,
        totalPurchases: insight.purchases,
        dailyCtr: insight.ctr !== null && insight.impressions > 0
          ? [{ date: insight.date, ctr: insight.ctr, impressions: insight.impressions }]
          : [],
      });
    }
  }

  // Calculate peak CTR and current CTR for each ad
  const records = [];

  for (const [adId, stats] of adStats) {
    if (stats.dailyCtr.length === 0) continue;

    // Sort by date
    stats.dailyCtr.sort((a, b) => a.date.localeCompare(b.date));

    // Find peak CTR (weighted by impressions)
    let peakCtr = 0;
    let peakCtrDate: string | null = null;

    for (const day of stats.dailyCtr) {
      if (day.ctr > peakCtr) {
        peakCtr = day.ctr;
        peakCtrDate = day.date;
      }
    }

    // Calculate current CTR (last 7 days weighted average)
    const recentDays = stats.dailyCtr.slice(-7);
    const totalRecentImpressions = recentDays.reduce((sum, d) => sum + d.impressions, 0);
    const weightedCtrSum = recentDays.reduce((sum, d) => sum + (d.ctr * d.impressions), 0);
    const currentCtr = totalRecentImpressions > 0 ? weightedCtrSum / totalRecentImpressions : null;

    // Calculate fatigue
    const ctrVsPeak = peakCtr > 0 && currentCtr !== null ? currentCtr / peakCtr : null;
    const isFatigued = ctrVsPeak !== null && ctrVsPeak < 0.65;
    let fatigueSeverity: string | null = null;

    if (ctrVsPeak !== null) {
      if (ctrVsPeak < 0.50) fatigueSeverity = "high";
      else if (ctrVsPeak < 0.65) fatigueSeverity = "medium";
      else if (ctrVsPeak < 0.75) fatigueSeverity = "low";
    }

    // Check if active (had spend in last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];
    const isActive = recentDays.some((d) => d.date >= sevenDaysAgoStr);

    records.push({
      meta_ad_id: adId,
      ad_name: stats.ad_name,
      campaign_name: stats.campaign_name,
      thumbnail_url: stats.thumbnail_url,
      creative_type: stats.creative_type,
      lifetime_spend: stats.totalSpend,
      lifetime_impressions: stats.totalImpressions,
      lifetime_purchases: stats.totalPurchases,
      peak_ctr: peakCtr,
      peak_ctr_date: peakCtrDate,
      current_ctr: currentCtr,
      ctr_vs_peak: ctrVsPeak,
      is_active: isActive,
      is_fatigued: isFatigued,
      fatigue_severity: fatigueSeverity,
      updated_at: new Date().toISOString(),
    });
  }

  // Upsert in batches
  for (let i = 0; i < records.length; i += UPSERT_BATCH_SIZE) {
    const batch = records.slice(i, i + UPSERT_BATCH_SIZE);

    const { error } = await supabase
      .from("meta_ad_creative_stats")
      .upsert(batch, { onConflict: "meta_ad_id" });

    if (error) {
      console.error(`[META SYNC] Error upserting creative stats:`, error);
    }
  }

  console.log(`[META SYNC] Updated ${records.length} creative stats`);
}

/**
 * Aggregate daily Meta stats into ad_daily_stats
 */
async function aggregateDailyStats(
  supabase: ReturnType<typeof createServiceClient>,
  startDate: string,
  endDate: string
): Promise<number> {
  // Query aggregated daily totals from meta_campaigns
  const { data: dailyData, error: queryError } = await supabase
    .from("meta_campaigns")
    .select("date, spend, impressions, clicks, purchases, purchase_value")
    .gte("date", startDate)
    .lte("date", endDate);

  if (queryError) {
    console.error("[META SYNC] Error querying daily aggregates:", queryError);
    return 0;
  }

  // Group by date
  const dailyTotals = new Map<string, {
    meta_spend: number;
    meta_impressions: number;
    meta_clicks: number;
    meta_purchases: number;
    meta_revenue: number;
  }>();

  for (const row of dailyData || []) {
    const existing = dailyTotals.get(row.date) || {
      meta_spend: 0,
      meta_impressions: 0,
      meta_clicks: 0,
      meta_purchases: 0,
      meta_revenue: 0,
    };

    existing.meta_spend += parseFloat(row.spend) || 0;
    existing.meta_impressions += parseInt(row.impressions) || 0;
    existing.meta_clicks += parseInt(row.clicks) || 0;
    existing.meta_purchases += parseInt(row.purchases) || 0;
    existing.meta_revenue += parseFloat(row.purchase_value) || 0;

    dailyTotals.set(row.date, existing);
  }

  // Upsert daily stats using atomic database function
  // This prevents race conditions with sync-google-ads by only updating Meta columns
  let updated = 0;

  for (const [date, totals] of dailyTotals) {
    const { error } = await supabase.rpc("upsert_ad_daily_stats_meta", {
      p_date: date,
      p_meta_spend: totals.meta_spend,
      p_meta_impressions: totals.meta_impressions,
      p_meta_clicks: totals.meta_clicks,
      p_meta_purchases: totals.meta_purchases,
      p_meta_revenue: totals.meta_revenue,
    });

    if (error) {
      console.error(`[META SYNC] Error upserting daily stats for ${date}:`, error);
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
