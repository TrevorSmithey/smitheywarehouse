/**
 * Klaviyo Sync Cron Job
 * Syncs email campaign and flow performance data from Klaviyo to Supabase
 *
 * Triggered by Vercel cron daily at 6 AM UTC (1 AM EST)
 *
 * Syncs:
 * - Sent campaigns from last 2 years (with full metrics)
 * - Scheduled campaigns (for inventory planning)
 * - Flow revenue data
 * - Subscriber counts from key segments
 * - Monthly aggregated stats
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createKlaviyoClient,
  reportToMetrics,
  predictCampaignRevenue,
  type KlaviyoCampaign,
} from "@/lib/klaviyo";
import { sendSyncFailureAlert } from "@/lib/notifications";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";

const LOCK_NAME = "sync-klaviyo";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes - must be literal for Next.js static analysis

// Timeout threshold - alert if we exceed 80% of maxDuration
const TIMEOUT_WARNING_THRESHOLD = maxDuration * 0.8 * 1000;

// Get start of month for a given date
function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// Get end of month for a given date
function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

// Get date N days ago
function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date;
}

export async function GET(request: Request) {
  // Always verify cron secret - no exceptions
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  // Acquire lock to prevent concurrent runs
  const lock = await acquireCronLock(supabase, LOCK_NAME);
  if (!lock.acquired) {
    console.warn(`[KLAVIYO] Skipping sync - another sync is in progress`);
    return NextResponse.json(
      { success: false, error: "Another sync is already in progress", skipped: true },
      { status: 409 }
    );
  }

  const stats = {
    campaignsSynced: 0,
    scheduledSynced: 0,
    flowsSynced: 0,
    monthlyStatsUpdated: 0,
    errors: 0,
  };
  const failedIds: { campaigns: string[]; scheduled: string[]; flows: string[] } = {
    campaigns: [],
    scheduled: [],
    flows: [],
  };

  try {
    console.log("[KLAVIYO SYNC] Starting sync...");

    // Check for required env var
    const privateKey = process.env.KLAVIYO_PRIVATE_API_KEY;
    if (!privateKey) {
      return NextResponse.json(
        { error: "Missing Klaviyo configuration (KLAVIYO_PRIVATE_API_KEY)" },
        { status: 500 }
      );
    }

    const klaviyo = createKlaviyoClient();

    // ============================================================
    // 1. Sync sent campaigns from last 30 days (historical data already imported)
    // ============================================================
    console.log("[KLAVIYO SYNC] Fetching sent campaigns (last 30 days)...");

    const thirtyDaysAgo = daysAgo(30); // Only sync recent data - historical already imported
    const now = new Date();

    // Build custom timeframe for reports (30 days is well under Klaviyo's 1-year limit)
    const customTimeframe = {
      start: thirtyDaysAgo.toISOString().split("T")[0],
      end: now.toISOString().split("T")[0],
    };

    // Get campaigns list and bulk reports in parallel
    const [sentCampaigns, campaignReports] = await Promise.all([
      klaviyo.getSentCampaigns(thirtyDaysAgo, now),
      klaviyo.getAllCampaignReports(customTimeframe),
    ]);

    console.log(`[KLAVIYO SYNC] Found ${sentCampaigns.length} sent campaigns, ${campaignReports.size} with reports`);

    for (const campaign of sentCampaigns) {
      try {
        // Get metrics from bulk report data
        const reportStats = campaignReports.get(campaign.id);

        if (reportStats) {
          const report = { campaignId: campaign.id, statistics: reportStats };
          const metrics = reportToMetrics(report);

          // Upsert campaign with metrics
          const { error } = await supabase.from("klaviyo_campaigns").upsert(
            {
              klaviyo_id: campaign.id,
              name: campaign.attributes.name,
              channel: "email", // We're filtering for email campaigns
              status: campaign.attributes.status,
              send_time: campaign.attributes.send_time,
              recipients: metrics.recipients,
              delivered: metrics.delivered,
              bounces: metrics.bounces,
              opens: metrics.opens,
              unique_opens: metrics.uniqueOpens,
              clicks: metrics.clicks,
              unique_clicks: metrics.uniqueClicks,
              unsubscribes: metrics.unsubscribes,
              conversions: metrics.conversions,
              conversion_value: metrics.conversionValue,
              open_rate: metrics.openRate,
              click_rate: metrics.clickRate,
              conversion_rate: metrics.conversionRate,
              last_synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "klaviyo_id" }
          );

          if (error) {
            console.error(`[KLAVIYO SYNC] Error upserting campaign ${campaign.id}:`, error);
            stats.errors++;
            failedIds.campaigns.push(campaign.id);
          } else {
            stats.campaignsSynced++;
          }
        } else {
          console.log(`[KLAVIYO SYNC] No report data for campaign ${campaign.id} (${campaign.attributes.name})`);
        }

      } catch (err) {
        console.error(`[KLAVIYO SYNC] Error processing campaign ${campaign.id}:`, err);
        stats.errors++;
        failedIds.campaigns.push(campaign.id);
      }
    }

    console.log(`[KLAVIYO SYNC] Synced ${stats.campaignsSynced} campaigns`);

    // ============================================================
    // 2. Sync scheduled campaigns (for inventory planning)
    // ============================================================
    console.log("[KLAVIYO SYNC] Fetching scheduled campaigns...");

    const scheduledCampaigns = await klaviyo.getScheduledCampaigns();
    console.log(`[KLAVIYO SYNC] Found ${scheduledCampaigns.length} scheduled campaigns`);

    // Clear old scheduled campaigns that are now past
    await supabase
      .from("klaviyo_scheduled_campaigns")
      .delete()
      .lt("scheduled_time", new Date().toISOString());

    // Get historical averages for predictions
    const { data: avgMetrics } = await supabase
      .from("klaviyo_campaigns")
      .select("open_rate, click_rate, conversion_rate, conversion_value, recipients")
      .eq("status", "sent")
      .eq("channel", "email")
      .gte("send_time", daysAgo(90).toISOString())
      .not("conversion_rate", "is", null);

    // Calculate averages
    let avgOpenRate = 0.25; // Default 25%
    let avgClickRate = 0.03; // Default 3%
    let avgConversionRate = 0.02; // Default 2%
    let avgOrderValue = 150; // Default $150

    if (avgMetrics && avgMetrics.length > 0) {
      const validMetrics = avgMetrics.filter(m => m.recipients > 0);
      if (validMetrics.length > 0) {
        avgOpenRate = validMetrics.reduce((sum, m) => sum + (m.open_rate || 0), 0) / validMetrics.length;
        avgClickRate = validMetrics.reduce((sum, m) => sum + (m.click_rate || 0), 0) / validMetrics.length;
        avgConversionRate = validMetrics.reduce((sum, m) => sum + (m.conversion_rate || 0), 0) / validMetrics.length;

        const withRevenue = validMetrics.filter(m => m.conversion_value > 0);
        if (withRevenue.length > 0) {
          const totalRevenue = withRevenue.reduce((sum, m) => sum + m.conversion_value, 0);
          const totalConversions = withRevenue.reduce((sum, m) => {
            const convs = Math.round(m.recipients * (m.conversion_rate || 0));
            return sum + convs;
          }, 0);
          if (totalConversions > 0) {
            avgOrderValue = totalRevenue / totalConversions;
          }
        }
      }
    }

    for (const campaign of scheduledCampaigns) {
      try {
        // Get audience size (estimate from included lists/segments)
        let audienceSize = 0;
        const audiences = campaign.attributes.audiences;

        if (audiences?.included?.length > 0) {
          for (const audienceId of audiences.included.slice(0, 3)) { // Limit API calls
            // Try as list first, then segment
            const listSize = await klaviyo.getListSize(audienceId);
            if (listSize > 0) {
              audienceSize += listSize;
            } else {
              const segmentSize = await klaviyo.getSegmentSize(audienceId);
              audienceSize += segmentSize;
            }
          }
        }

        // Calculate predictions
        const predictedRevenue = predictCampaignRevenue(
          audienceSize,
          avgOpenRate,
          avgClickRate,
          avgConversionRate,
          avgOrderValue
        );

        const predictedOpens = Math.round(audienceSize * avgOpenRate);
        const predictedConversions = Math.round(predictedOpens * avgClickRate * avgConversionRate);

        // Upsert scheduled campaign
        const { error } = await supabase.from("klaviyo_scheduled_campaigns").upsert(
          {
            klaviyo_id: campaign.id,
            name: campaign.attributes.name,
            channel: "email", // We're filtering for email campaigns
            scheduled_time: campaign.attributes.scheduled_at || campaign.attributes.send_strategy.options_static?.datetime,
            audience_size: audienceSize > 0 ? audienceSize : null,
            predicted_opens: predictedOpens > 0 ? predictedOpens : null,
            predicted_conversions: predictedConversions > 0 ? predictedConversions : null,
            predicted_revenue: predictedRevenue > 0 ? predictedRevenue : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "klaviyo_id" }
        );

        if (error) {
          console.error(`[KLAVIYO SYNC] Error upserting scheduled campaign ${campaign.id}:`, error);
          stats.errors++;
          failedIds.scheduled.push(campaign.id);
        } else {
          stats.scheduledSynced++;
        }

        // Rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));

      } catch (err) {
        console.error(`[KLAVIYO SYNC] Error processing scheduled campaign ${campaign.id}:`, err);
        stats.errors++;
        failedIds.scheduled.push(campaign.id);
      }
    }

    console.log(`[KLAVIYO SYNC] Synced ${stats.scheduledSynced} scheduled campaigns`);

    // ============================================================
    // 3. Sync flows
    // ============================================================
    console.log("[KLAVIYO SYNC] Fetching flows...");

    const flows = await klaviyo.getFlows();
    console.log(`[KLAVIYO SYNC] Found ${flows.length} flows`);

    for (const flow of flows) {
      try {
        const { error } = await supabase.from("klaviyo_flows").upsert(
          {
            klaviyo_id: flow.id,
            name: flow.attributes.name,
            status: flow.attributes.status,
            trigger_type: flow.attributes.trigger_type,
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "klaviyo_id" }
        );

        if (error) {
          console.error(`[KLAVIYO SYNC] Error upserting flow ${flow.id}:`, error);
          stats.errors++;
          failedIds.flows.push(flow.id);
        } else {
          stats.flowsSynced++;
        }
      } catch (err) {
        console.error(`[KLAVIYO SYNC] Error processing flow ${flow.id}:`, err);
        stats.errors++;
        failedIds.flows.push(flow.id);
      }
    }

    console.log(`[KLAVIYO SYNC] Synced ${stats.flowsSynced} flows`);

    // ============================================================
    // 4. Get flow revenue and subscriber counts
    // ============================================================
    console.log("[KLAVIYO SYNC] Fetching flow revenue and subscriber counts...");

    // Get MTD flow revenue
    const flowReports = await klaviyo.getFlowReports("this_month");
    const mtdFlowRevenue = flowReports.totalRevenue;
    const mtdFlowConversions = flowReports.totalConversions;

    // Get lifetime flow revenue for per-flow breakdown
    // Using last_365_days as proxy for lifetime (Klaviyo doesn't have true all_time)
    const lifetimeFlowReports = await klaviyo.getFlowReports("last_365_days");
    console.log(`[KLAVIYO SYNC] Got per-flow metrics for ${lifetimeFlowReports.byFlow.size} flows`);

    // Update each flow with its per-flow revenue
    for (const [flowId, stats] of lifetimeFlowReports.byFlow) {
      try {
        const { error } = await supabase
          .from("klaviyo_flows")
          .update({
            total_revenue: stats.conversion_value || 0,
            total_conversions: stats.conversions || 0,
            updated_at: new Date().toISOString(),
          })
          .eq("klaviyo_id", flowId);

        if (error) {
          console.error(`[KLAVIYO SYNC] Error updating flow metrics for ${flowId}:`, error);
        }
      } catch (err) {
        console.error(`[KLAVIYO SYNC] Error updating flow metrics for ${flowId}:`, err);
      }
    }

    // Get subscriber counts (current)
    const subscriberCounts = await klaviyo.getSubscriberCounts();

    // Get historical data for last 30 days only (historical data already imported)
    const [subscriberHistory, flowRevenueHistory] = await Promise.all([
      klaviyo.getSubscriberHistory("last_30_days"),
      klaviyo.getFlowRevenueHistory("last_30_days"),
    ]);

    console.log(`[KLAVIYO SYNC] Flow revenue MTD: $${mtdFlowRevenue.toFixed(2)}, Subscribers: ${subscriberCounts.engaged365}`);
    console.log(`[KLAVIYO SYNC] Got ${subscriberHistory.engaged365Day.length} months of subscriber history`);
    console.log(`[KLAVIYO SYNC] Got ${flowRevenueHistory.length} months of flow revenue history`);

    // ============================================================
    // 5. Update monthly stats for ALL months with campaign data
    // ============================================================
    console.log("[KLAVIYO SYNC] Updating monthly stats...");

    const currentMonth = startOfMonth(now);
    const previousMonth = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));

    // Find all distinct months with campaigns (last 30 days - historical data already imported)
    const { data: campaignMonths } = await supabase
      .from("klaviyo_campaigns")
      .select("send_time")
      .eq("status", "Sent")
      .gte("send_time", thirtyDaysAgo.toISOString())
      .order("send_time", { ascending: false });

    // Build unique set of month starts
    const monthsToUpdate = new Set<string>();
    monthsToUpdate.add(currentMonth.toISOString().split("T")[0]);
    monthsToUpdate.add(previousMonth.toISOString().split("T")[0]);

    if (campaignMonths) {
      for (const row of campaignMonths) {
        if (row.send_time) {
          const date = new Date(row.send_time);
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
          monthsToUpdate.add(monthKey);
        }
      }
    }

    console.log(`[KLAVIYO SYNC] Found ${monthsToUpdate.size} months to update`);

    // Build map of flow revenue by month from historical data
    const flowRevenueByMonth = new Map<string, { revenue: number; conversions: number }>();
    for (const item of flowRevenueHistory) {
      const monthKey = item.date.substring(0, 7); // YYYY-MM
      flowRevenueByMonth.set(monthKey, { revenue: item.revenue, conversions: item.conversions });
    }

    for (const monthStartStr of monthsToUpdate) {
      const monthStart = new Date(monthStartStr);
      const monthEnd = endOfMonth(monthStart);
      const isCurrentMonth = monthStartStr === currentMonth.toISOString().split("T")[0];
      const monthKey = monthStartStr.substring(0, 7); // YYYY-MM

      try {
        // Use the DB function to calculate campaign stats
        const { data: periodStats, error: statsError } = await supabase
          .rpc("calculate_klaviyo_period_stats", {
            p_start_date: monthStartStr,
            p_end_date: monthEnd.toISOString().split("T")[0],
          });

        if (statsError) {
          console.error(`[KLAVIYO SYNC] Error calculating stats for ${monthStartStr}:`, statsError);
          stats.errors++;
          continue;
        }

        // Get flow revenue from historical data, or current month's live data
        let monthFlowRevenue = 0;
        let monthFlowConversions = 0;

        if (isCurrentMonth) {
          // Use live MTD data for current month
          monthFlowRevenue = mtdFlowRevenue;
          monthFlowConversions = mtdFlowConversions;
        } else {
          // Use historical data for past months
          const historical = flowRevenueByMonth.get(monthKey);
          if (historical) {
            monthFlowRevenue = historical.revenue;
            monthFlowConversions = historical.conversions;
          }
        }

        if (periodStats && periodStats.length > 0) {
          const s = periodStats[0];
          const emailRevenue = parseFloat(s.email_revenue) || 0;
          const totalRevenue = emailRevenue + monthFlowRevenue;

          // Get existing subscriber counts (preserve historical data)
          const { data: existing } = await supabase
            .from("klaviyo_monthly_stats")
            .select("subscribers_120day, subscribers_365day")
            .eq("month_start", monthStartStr)
            .single();

          const { error: upsertError } = await supabase.from("klaviyo_monthly_stats").upsert(
            {
              month_start: monthStartStr,
              email_campaigns_sent: s.email_campaigns_sent,
              email_recipients: s.email_recipients,
              email_delivered: s.email_delivered,
              email_opens: s.email_opens,
              email_clicks: s.email_clicks,
              email_conversions: s.email_conversions,
              email_revenue: emailRevenue,
              email_unsubscribes: s.email_unsubscribes,
              email_avg_open_rate: s.email_avg_open_rate,
              email_avg_click_rate: s.email_avg_click_rate,
              flow_revenue: monthFlowRevenue,
              flow_conversions: monthFlowConversions,
              // Preserve existing subscriber counts, or update if current month
              subscribers_120day: isCurrentMonth
                ? subscriberCounts.active120Day
                : (existing?.subscribers_120day ?? null),
              subscribers_365day: isCurrentMonth
                ? subscriberCounts.engaged365
                : (existing?.subscribers_365day ?? null),
              total_revenue: totalRevenue,
              total_conversions: (s.total_conversions || 0) + monthFlowConversions,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "month_start" }
          );

          if (upsertError) {
            console.error(`[KLAVIYO SYNC] Error upserting monthly stats for ${monthStartStr}:`, upsertError);
            stats.errors++;
          } else {
            stats.monthlyStatsUpdated++;
          }
        }
      } catch (err) {
        console.error(`[KLAVIYO SYNC] Error updating monthly stats for ${monthStartStr}:`, err);
        stats.errors++;
      }
    }

    console.log(`[KLAVIYO SYNC] Updated ${stats.monthlyStatsUpdated} monthly stat records`);

    // ============================================================
    // 6. Backfill historical subscriber counts
    // ============================================================
    console.log("[KLAVIYO SYNC] Backfilling historical subscriber counts...");

    // Build a map of month -> subscriber counts from history
    const subscriberByMonth = new Map<string, { active120Day: number | null; engaged365Day: number | null }>();

    for (const item of subscriberHistory.active120Day) {
      const monthKey = item.date.substring(0, 7); // YYYY-MM
      const existing = subscriberByMonth.get(monthKey) || { active120Day: null, engaged365Day: null };
      existing.active120Day = item.count;
      subscriberByMonth.set(monthKey, existing);
    }

    for (const item of subscriberHistory.engaged365Day) {
      const monthKey = item.date.substring(0, 7); // YYYY-MM
      const existing = subscriberByMonth.get(monthKey) || { active120Day: null, engaged365Day: null };
      existing.engaged365Day = item.count;
      subscriberByMonth.set(monthKey, existing);
    }

    // Update each month's record with historical subscriber data
    let subscriberUpdates = 0;
    for (const [monthKey, counts] of subscriberByMonth) {
      const monthStart = `${monthKey}-01`;

      try {
        // Always update subscriber counts for existing records
        const { error, count } = await supabase
          .from("klaviyo_monthly_stats")
          .update({
            subscribers_120day: counts.active120Day,
            subscribers_365day: counts.engaged365Day,
            updated_at: new Date().toISOString(),
          })
          .eq("month_start", monthStart);

        if (!error && count && count > 0) {
          subscriberUpdates++;
        } else if (!error) {
          // Create a minimal record for historical months
          const { error } = await supabase.from("klaviyo_monthly_stats").insert({
            month_start: monthStart,
            subscribers_120day: counts.active120Day,
            subscribers_365day: counts.engaged365Day,
            email_campaigns_sent: 0,
            email_recipients: 0,
            email_delivered: 0,
            email_opens: 0,
            email_clicks: 0,
            email_conversions: 0,
            email_revenue: 0,
            email_unsubscribes: 0,
            flow_revenue: 0,
            flow_conversions: 0,
            total_revenue: 0,
            total_conversions: 0,
            updated_at: new Date().toISOString(),
          });

          if (!error) {
            subscriberUpdates++;
          }
        }
      } catch (err) {
        console.error(`[KLAVIYO SYNC] Error updating subscriber history for ${monthStart}:`, err);
      }
    }

    console.log(`[KLAVIYO SYNC] Updated ${subscriberUpdates} months with historical subscriber data`);

    // ============================================================
    // Done
    // ============================================================
    const duration = Date.now() - startTime;
    console.log(`[KLAVIYO SYNC] Complete in ${duration}ms:`, stats);

    // Log failed IDs for debugging
    const totalFailed = failedIds.campaigns.length + failedIds.scheduled.length + failedIds.flows.length;
    if (totalFailed > 0) {
      console.error(`[KLAVIYO SYNC] Failed IDs:`, JSON.stringify(failedIds));
    }

    // Check for timeout warning
    const approachedTimeout = duration > TIMEOUT_WARNING_THRESHOLD;
    if (approachedTimeout) {
      console.warn(`[KLAVIYO SYNC] WARNING: Sync took ${(duration / 1000).toFixed(1)}s - approaching timeout limit of ${maxDuration}s`);
      // Send alert about potential timeout risk
      await sendSyncFailureAlert({
        syncType: "Klaviyo Email Campaigns",
        error: `WARNING: Sync completed but took ${(duration / 1000).toFixed(1)}s (${((duration / (maxDuration * 1000)) * 100).toFixed(0)}% of max). Consider splitting into smaller jobs.`,
        timestamp: new Date().toISOString(),
      });
    }

    // Log success to sync_logs
    const totalSynced = stats.campaignsSynced + stats.scheduledSynced + stats.flowsSynced;
    await supabase.from("sync_logs").insert({
      sync_type: "klaviyo",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: totalSynced,
      records_synced: totalSynced,
      duration_ms: duration,
      details: stats,
    });

    return NextResponse.json({
      success: true,
      ...stats,
      duration,
      ...(totalFailed > 0 && { failedIds }),
      ...(approachedTimeout && { warning: "Approaching timeout threshold - consider splitting sync" }),
    });

  } catch (error) {
    console.error("[KLAVIYO SYNC] Fatal error:", error);

    const errorMessage = error instanceof Error ? error.message : "Sync failed";
    const elapsed = Date.now() - startTime;

    // Send email alert
    await sendSyncFailureAlert({
      syncType: "Klaviyo Email Campaigns",
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    // Log to sync_logs
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "klaviyo",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 0,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("[KLAVIYO SYNC] Failed to log sync failure:", logError);
    }

    return NextResponse.json(
      {
        error: errorMessage,
        duration: elapsed,
      },
      { status: 500 }
    );
  } finally {
    // Always release the lock
    await releaseCronLock(supabase, LOCK_NAME);
  }
}

// POST handler for manual triggers
export async function POST(request: Request) {
  return GET(request);
}
