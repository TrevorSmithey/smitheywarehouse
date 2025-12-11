/**
 * Klaviyo Sync Cron Job
 * Syncs email/SMS campaign performance data from Klaviyo to Supabase
 *
 * Triggered by Vercel cron daily at 6 AM UTC (1 AM EST)
 *
 * Syncs:
 * - Sent campaigns from last 90 days (with full metrics)
 * - Scheduled campaigns (for inventory planning)
 * - Flow performance data
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

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes max for cron

// Verify cron secret for security
function verifyCronSecret(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.warn("CRON_SECRET not configured");
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

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
  // Verify this is a legitimate cron call
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const stats = {
    campaignsSynced: 0,
    scheduledSynced: 0,
    flowsSynced: 0,
    monthlyStatsUpdated: 0,
    errors: 0,
  };

  try {
    console.log("[KLAVIYO SYNC] Starting sync...");

    // Initialize clients
    const supabase = createServiceClient();

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
    // 1. Sync sent campaigns from last 90 days
    // ============================================================
    console.log("[KLAVIYO SYNC] Fetching sent campaigns...");

    const ninetyDaysAgo = daysAgo(90);
    const now = new Date();

    const sentCampaigns = await klaviyo.getCampaignsByDateRange(ninetyDaysAgo, now);
    console.log(`[KLAVIYO SYNC] Found ${sentCampaigns.length} sent campaigns`);

    for (const campaign of sentCampaigns) {
      try {
        // Get detailed metrics for this campaign
        const report = await klaviyo.getCampaignReport(campaign.id);

        if (report) {
          const metrics = reportToMetrics(report);

          // Upsert campaign with metrics
          const { error } = await supabase.from("klaviyo_campaigns").upsert(
            {
              klaviyo_id: campaign.id,
              name: campaign.attributes.name,
              channel: campaign.attributes.channel,
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
          } else {
            stats.campaignsSynced++;
          }
        }

        // Rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));

      } catch (err) {
        console.error(`[KLAVIYO SYNC] Error processing campaign ${campaign.id}:`, err);
        stats.errors++;
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
            channel: campaign.attributes.channel,
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
        } else {
          stats.scheduledSynced++;
        }

        // Rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));

      } catch (err) {
        console.error(`[KLAVIYO SYNC] Error processing scheduled campaign ${campaign.id}:`, err);
        stats.errors++;
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
        } else {
          stats.flowsSynced++;
        }
      } catch (err) {
        console.error(`[KLAVIYO SYNC] Error processing flow ${flow.id}:`, err);
        stats.errors++;
      }
    }

    console.log(`[KLAVIYO SYNC] Synced ${stats.flowsSynced} flows`);

    // ============================================================
    // 4. Update monthly stats (current + previous month)
    // ============================================================
    console.log("[KLAVIYO SYNC] Updating monthly stats...");

    const currentMonth = startOfMonth(now);
    const previousMonth = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));

    for (const monthStart of [currentMonth, previousMonth]) {
      const monthEnd = endOfMonth(monthStart);

      try {
        // Use the DB function to calculate stats
        const { data: periodStats, error: statsError } = await supabase
          .rpc("calculate_klaviyo_period_stats", {
            p_start_date: monthStart.toISOString().split("T")[0],
            p_end_date: monthEnd.toISOString().split("T")[0],
          });

        if (statsError) {
          console.error(`[KLAVIYO SYNC] Error calculating stats for ${monthStart.toISOString()}:`, statsError);
          stats.errors++;
          continue;
        }

        if (periodStats && periodStats.length > 0) {
          const s = periodStats[0];

          const { error: upsertError } = await supabase.from("klaviyo_monthly_stats").upsert(
            {
              month_start: monthStart.toISOString().split("T")[0],
              email_campaigns_sent: s.email_campaigns_sent,
              email_recipients: s.email_recipients,
              email_delivered: s.email_delivered,
              email_opens: s.email_opens,
              email_clicks: s.email_clicks,
              email_conversions: s.email_conversions,
              email_revenue: s.email_revenue,
              email_unsubscribes: s.email_unsubscribes,
              email_avg_open_rate: s.email_avg_open_rate,
              email_avg_click_rate: s.email_avg_click_rate,
              sms_campaigns_sent: s.sms_campaigns_sent,
              sms_recipients: s.sms_recipients,
              sms_delivered: s.sms_delivered,
              sms_clicks: s.sms_clicks,
              sms_conversions: s.sms_conversions,
              sms_revenue: s.sms_revenue,
              sms_credits_used: s.sms_credits_used,
              sms_spend: s.sms_spend,
              total_revenue: s.total_revenue,
              total_conversions: s.total_conversions,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "month_start" }
          );

          if (upsertError) {
            console.error(`[KLAVIYO SYNC] Error upserting monthly stats:`, upsertError);
            stats.errors++;
          } else {
            stats.monthlyStatsUpdated++;
          }
        }
      } catch (err) {
        console.error(`[KLAVIYO SYNC] Error updating monthly stats for ${monthStart}:`, err);
        stats.errors++;
      }
    }

    console.log(`[KLAVIYO SYNC] Updated ${stats.monthlyStatsUpdated} monthly stat records`);

    // ============================================================
    // Done
    // ============================================================
    const duration = Date.now() - startTime;
    console.log(`[KLAVIYO SYNC] Complete in ${duration}ms:`, stats);

    return NextResponse.json({
      success: true,
      ...stats,
      duration,
    });

  } catch (error) {
    console.error("[KLAVIYO SYNC] Fatal error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Sync failed",
        duration: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// POST handler for manual triggers
export async function POST(request: Request) {
  return GET(request);
}
