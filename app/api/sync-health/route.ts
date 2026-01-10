import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * Sync Health Row from the sync_health view
 *
 * The view now includes:
 * - All syncs that have ever logged (from sync_logs)
 * - All syncs that SHOULD exist but haven't run (from expected_syncs)
 *
 * This fixes the critical flaw where syncs that never ran were invisible.
 */
interface SyncHealthRow {
  sync_type: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  records_expected: number | null;
  records_synced: number | null;
  success_rate: number;
  error_message: string | null;
  duration_ms: number | null;
  hours_since_success: number | null;
  display_name: string | null;
  stale_threshold_hours: number | null;
  is_stale: boolean;
  never_ran: boolean;
}

interface DataFreshnessRow {
  data_type: string;
  last_record: string | null;
  hours_stale: number;
  is_stale: boolean;
  records_last_24h: number;
}

// Sync types to exclude from health monitoring
// These are disabled/unconfigured syncs that shouldn't trigger alerts
const EXCLUDED_SYNC_TYPES = new Set<string>([
  "netsuite",                  // Replaced by chunked sync: netsuite_customers, netsuite_transactions, netsuite_lineitems
  "netsuite_customers_debug",  // Debug sync, not used in production
  "netsuite_lineitems_cursor", // Internal cursor tracking, not a real sync
]);

export async function GET(request: NextRequest) {
  // Auth check - requires admin session
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient();

    // Get latest sync status for each type
    // The view now includes syncs that SHOULD exist but haven't run (never_ran = true)
    // Fetch sync health and data freshness in parallel
    const [healthResult, freshnessResult] = await Promise.all([
      supabase.from("sync_health").select("*").returns<SyncHealthRow[]>(),
      supabase.from("data_freshness").select("*").returns<DataFreshnessRow[]>(),
    ]);

    if (healthResult.error) {
      console.error("Error fetching sync health:", healthResult.error);
      return NextResponse.json({ error: healthResult.error.message }, { status: 500 });
    }

    const health = healthResult.data;
    const freshness = freshnessResult.data || [];

    // Filter out excluded/disabled sync types
    const activeHealth = (health || []).filter(h => !EXCLUDED_SYNC_TYPES.has(h.sync_type));

    // Determine overall health (only from active syncs)
    // CRITICAL: never_ran syncs are now detected and flagged as critical
    const hasNeverRan = activeHealth.some((h) => h.never_ran);
    const hasFailures = activeHealth.some((h) => h.status === "failed");
    const hasPartials = activeHealth.some((h) => h.status === "partial");
    const hasStaleData = activeHealth.some((h) => h.is_stale && !h.never_ran);

    // Check data freshness (catches silent webhook failures)
    // This detects when webhooks stop firing even though crons show healthy
    const hasStaleWebhookData = freshness.some((f) => f.is_stale);

    // never_ran is critical - means expected sync has never logged
    // stale webhook data is critical - means webhooks silently stopped
    const overallStatus = hasNeverRan || hasFailures || hasStaleWebhookData
      ? "critical"
      : hasPartials || hasStaleData
        ? "warning"
        : "healthy";

    // Format for dashboard consumption (only active syncs)
    const syncs = activeHealth.map((h) => ({
      type: h.sync_type,
      displayName: h.display_name || h.sync_type,
      status: h.status,
      lastRun: h.completed_at,
      recordsExpected: h.records_expected,
      recordsSynced: h.records_synced,
      successRate: h.success_rate,
      durationMs: h.duration_ms,
      hoursSinceSuccess: h.hours_since_success,
      error: h.error_message,
      isStale: h.is_stale,
      staleThreshold: h.stale_threshold_hours || 24,
      neverRan: h.never_ran,
    }));

    // Format data freshness for response
    const dataFreshness = freshness.map((f) => ({
      type: f.data_type,
      lastRecord: f.last_record,
      hoursStale: Math.round(f.hours_stale * 10) / 10,
      isStale: f.is_stale,
      recordsLast24h: f.records_last_24h,
    }));

    // Cache for 1 minute, stale-while-revalidate for 3 minutes
    return NextResponse.json({
      status: overallStatus,
      syncs,
      dataFreshness,
      checkedAt: new Date().toISOString(),
      // Include counts for quick summary
      summary: {
        total: syncs.length,
        healthy: syncs.filter(s => s.status === "success" && !s.isStale).length,
        stale: syncs.filter(s => s.isStale && !s.neverRan).length,
        failed: syncs.filter(s => s.status === "failed").length,
        neverRan: syncs.filter(s => s.neverRan).length,
        staleData: dataFreshness.filter(d => d.isStale).length,
      },
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
