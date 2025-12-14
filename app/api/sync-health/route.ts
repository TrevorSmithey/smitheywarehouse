import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface SyncHealthRow {
  sync_type: string;
  status: string;
  started_at: string;
  completed_at: string;
  records_expected: number | null;
  records_synced: number | null;
  success_rate: number;
  error_message: string | null;
  duration_ms: number | null;
  hours_since_success: number | null;
}

// Stale thresholds per sync type (in hours)
// Webhooks: Should fire frequently during business hours, 12h is concerning
// Crons: Depend on schedule, but 24h is reasonable for most
// Assembly: Only runs when manually triggered, give it more slack
const STALE_THRESHOLDS: Record<string, number> = {
  d2c: 12,          // D2C webhook - orders should come in frequently
  b2b: 24,          // B2B webhook - less frequent, 24h is ok
  inventory: 6,     // Inventory cron - runs every few hours
  holiday: 24,      // Holiday sync - runs daily
  assembly: 48,     // Assembly sync - manually triggered
  netsuite_customers: 24,    // NetSuite customers - runs daily at 6 AM UTC
  netsuite_transactions: 24, // NetSuite transactions - runs daily at 6:05 AM UTC
  netsuite_lineitems: 24,    // NetSuite line items - runs daily at 6:10 AM UTC
  klaviyo: 24,      // Klaviyo sync - runs daily
  reamaze: 24,      // Reamaze sync - runs daily
  shopify_stats: 24, // Shopify stats - runs daily
};

// Sync types to exclude from health monitoring
// These are disabled/unconfigured syncs that shouldn't trigger alerts
const EXCLUDED_SYNC_TYPES = new Set<string>([
  "netsuite", // Replaced by chunked sync: netsuite_customers, netsuite_transactions, netsuite_lineitems
]);

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Get latest sync status for each type
    const { data: health, error } = await supabase
      .from("sync_health")
      .select("*")
      .returns<SyncHealthRow[]>();

    if (error) {
      console.error("Error fetching sync health:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Filter out excluded/disabled sync types
    const activeHealth = (health || []).filter(h => !EXCLUDED_SYNC_TYPES.has(h.sync_type));

    // Determine overall health (only from active syncs)
    const hasFailures = activeHealth.some((h) => h.status === "failed");
    const hasPartials = activeHealth.some((h) => h.status === "partial");
    const hasStaleData = activeHealth.some((h) => {
      const threshold = STALE_THRESHOLDS[h.sync_type] || 24;
      return h.hours_since_success && h.hours_since_success > threshold;
    });

    const overallStatus = hasFailures
      ? "critical"
      : hasPartials || hasStaleData
        ? "warning"
        : "healthy";

    // Format for dashboard consumption (only active syncs)
    const syncs = activeHealth.map((h) => {
      const threshold = STALE_THRESHOLDS[h.sync_type] || 24;
      return {
        type: h.sync_type,
        status: h.status,
        lastRun: h.completed_at,
        recordsExpected: h.records_expected,
        recordsSynced: h.records_synced,
        successRate: h.success_rate,
        durationMs: h.duration_ms,
        hoursSinceSuccess: h.hours_since_success,
        error: h.error_message,
        isStale: h.hours_since_success ? h.hours_since_success > threshold : false,
        staleThreshold: threshold,
      };
    });

    // Cache for 1 minute, stale-while-revalidate for 3 minutes
    return NextResponse.json({
      status: overallStatus,
      syncs,
      checkedAt: new Date().toISOString(),
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180",
      },
    });
  } catch (error) {
    console.error("Sync health check failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Health check failed" },
      { status: 500 }
    );
  }
}
