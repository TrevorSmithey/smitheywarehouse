import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

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
    const hasStaleData = health?.some(
      (h) => h.hours_since_success && h.hours_since_success > 24
    ) ?? false;

    const overallStatus = hasFailures
      ? "critical"
      : hasPartials || hasStaleData
        ? "warning"
        : "healthy";

    // Format for dashboard consumption
    const syncs = (health || []).map((h) => ({
      type: h.sync_type,
      status: h.status,
      lastRun: h.completed_at,
      recordsExpected: h.records_expected,
      recordsSynced: h.records_synced,
      successRate: h.success_rate,
      durationMs: h.duration_ms,
      hoursSinceSuccess: h.hours_since_success,
      error: h.error_message,
      isStale: h.hours_since_success ? h.hours_since_success > 24 : false,
    }));

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
