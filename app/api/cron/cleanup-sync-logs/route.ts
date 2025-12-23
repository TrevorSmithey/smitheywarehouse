/**
 * Sync Logs Cleanup Cron
 *
 * Removes sync_logs entries older than 7 days to prevent table bloat.
 * The table was growing at ~24K rows/day before D2C webhook logging was disabled.
 * This cron ensures any future logging doesn't cause runaway growth.
 *
 * Schedule: Daily at 3:00 AM UTC (before other crons start)
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Retention period in days
const RETENTION_DAYS = 7;

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  try {
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    const cutoffISO = cutoffDate.toISOString();

    // Get count before deletion for logging
    const { count: beforeCount } = await supabase
      .from("sync_logs")
      .select("*", { count: "exact", head: true });

    // Delete old logs
    const { error: deleteError, count: deletedCount } = await supabase
      .from("sync_logs")
      .delete({ count: "exact" })
      .lt("started_at", cutoffISO);

    if (deleteError) {
      throw new Error(`Failed to delete old logs: ${deleteError.message}`);
    }

    // Get count after deletion
    const { count: afterCount } = await supabase
      .from("sync_logs")
      .select("*", { count: "exact", head: true });

    const elapsed = Date.now() - startTime;

    // Log the cleanup itself (this is meta, but useful for monitoring)
    await supabase.from("sync_logs").insert({
      sync_type: "cleanup_sync_logs",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: beforeCount || 0,
      records_synced: deletedCount || 0,
      details: {
        retention_days: RETENTION_DAYS,
        cutoff_date: cutoffISO,
        rows_before: beforeCount,
        rows_deleted: deletedCount,
        rows_after: afterCount,
      },
      duration_ms: elapsed,
    });

    console.log(
      `[CLEANUP] Deleted ${deletedCount} sync_logs older than ${RETENTION_DAYS} days. ` +
      `Remaining: ${afterCount} rows.`
    );

    return NextResponse.json({
      success: true,
      deleted: deletedCount,
      remaining: afterCount,
      cutoffDate: cutoffISO,
      durationMs: elapsed,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    console.error("[CLEANUP] sync_logs cleanup failed:", errorMessage);

    // Log failure
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "cleanup_sync_logs",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 0,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("[CLEANUP] Failed to log cleanup failure:", logError);
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
