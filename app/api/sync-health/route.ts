import { NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Validate env vars and create client
function getSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase credentials (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY)");
  }

  return createClient(url, key);
}

const supabase = getSupabaseClient();

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
  d2c: 12,       // D2C webhook - orders should come in frequently
  b2b: 24,       // B2B webhook - less frequent, 24h is ok
  inventory: 6,  // Inventory cron - runs every few hours
  holiday: 24,   // Holiday sync - runs daily
  assembly: 48,  // Assembly sync - manually triggered
};

export async function GET() {
  try {
    // Get latest sync status for each type
    const { data: health, error } = await supabase
      .from("sync_health")
      .select("*")
      .returns<SyncHealthRow[]>();

    if (error) {
      console.error("Error fetching sync health:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Determine overall health
    const hasFailures = health?.some((h) => h.status === "failed") ?? false;
    const hasPartials = health?.some((h) => h.status === "partial") ?? false;
    const hasStaleData = health?.some((h) => {
      const threshold = STALE_THRESHOLDS[h.sync_type] || 24;
      return h.hours_since_success && h.hours_since_success > threshold;
    }) ?? false;

    const overallStatus = hasFailures
      ? "critical"
      : hasPartials || hasStaleData
        ? "warning"
        : "healthy";

    // Format for dashboard consumption
    const syncs = (health || []).map((h) => {
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

    return NextResponse.json({
      status: overallStatus,
      syncs,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Sync health check failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Health check failed" },
      { status: 500 }
    );
  }
}
