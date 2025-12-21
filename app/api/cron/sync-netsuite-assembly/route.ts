/**
 * NetSuite Assembly Builds Sync
 *
 * Syncs assembly production data from NetSuite to Supabase.
 * Replaces manual Excel export → sync-assembly-tracking.ts workflow.
 *
 * This replicates the "Assembled By Day and Item Search" saved search
 * (customsearchsi_assemblies_by_day) which tracks:
 * - Date of assembly
 * - SKU assembled (Smith-CI-*, Smith-CS-*)
 * - Quantity produced
 *
 * Default: Syncs last 30 days
 * Pass ?full=true to sync full year
 * Pass ?days=N to sync last N days
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import {
  hasNetSuiteCredentials,
  fetchAssemblyBuilds,
  type NSAssemblyBuild,
} from "@/lib/netsuite";

const LOCK_NAME = "sync-netsuite-assembly";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Default to 30 days for incremental sync
const DEFAULT_SYNC_DAYS = 30;

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  // Acquire lock to prevent concurrent runs
  const lock = await acquireCronLock(supabase, LOCK_NAME);
  if (!lock.acquired) {
    console.warn(`[ASSEMBLY] Skipping sync - another sync is in progress`);
    return NextResponse.json(
      { success: false, error: "Another sync is already in progress", skipped: true },
      { status: 409 }
    );
  }

  // Parse query params
  const url = new URL(request.url);
  const isFullSync = url.searchParams.get("full") === "true";
  const customDays = url.searchParams.get("days");

  // Determine date range
  const today = new Date();
  let startDate: string;
  let syncDescription: string;

  if (isFullSync) {
    // Full year sync
    startDate = `${today.getFullYear()}-01-01`;
    syncDescription = `full year ${today.getFullYear()}`;
  } else if (customDays && !isNaN(parseInt(customDays))) {
    // Custom days
    const days = parseInt(customDays);
    const start = new Date(today);
    start.setDate(start.getDate() - days);
    startDate = start.toISOString().split("T")[0];
    syncDescription = `last ${days} days`;
  } else {
    // Default: last 30 days
    const start = new Date(today);
    start.setDate(start.getDate() - DEFAULT_SYNC_DAYS);
    startDate = start.toISOString().split("T")[0];
    syncDescription = `last ${DEFAULT_SYNC_DAYS} days`;
  }

  const endDate = today.toISOString().split("T")[0];

  try {
    if (!hasNetSuiteCredentials()) {
      return NextResponse.json({ error: "Missing NetSuite credentials" }, { status: 500 });
    }

    console.log(`[ASSEMBLY] Starting sync (${syncDescription}): ${startDate} to ${endDate}`);

    // Fetch assembly builds from NetSuite
    const assemblyBuilds = await fetchAssemblyBuilds(startDate, endDate);

    if (assemblyBuilds.length === 0) {
      console.log(`[ASSEMBLY] No assembly builds found in date range`);

      await supabase.from("sync_logs").insert({
        sync_type: "netsuite_assembly",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "success",
        records_expected: 0,
        records_synced: 0,
        duration_ms: Date.now() - startTime,
      });

      return NextResponse.json({
        success: true,
        type: "assembly",
        mode: syncDescription,
        fetched: 0,
        upserted: 0,
        dateRange: { start: startDate, end: endDate },
      });
    }

    // Transform to database format
    const records = assemblyBuilds
      .filter((ab: NSAssemblyBuild) => {
        // Only process Smith- SKUs (finished goods)
        return ab.item_sku && ab.item_sku.startsWith("Smith-");
      })
      .map((ab: NSAssemblyBuild) => ({
        date: ab.trandate,
        sku: ab.item_sku,
        quantity: parseInt(ab.quantity) || 0,
      }))
      .filter((r) => r.quantity > 0); // Skip zero quantities

    console.log(`[ASSEMBLY] Processing ${records.length} valid records (filtered from ${assemblyBuilds.length})`);

    // Upsert in batches
    const BATCH_SIZE = 500;
    let totalUpserted = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);

      const { error } = await supabase
        .from("assembly_sku_daily")
        .upsert(batch, { onConflict: "date,sku" });

      if (error) {
        console.error(`[ASSEMBLY] Upsert error at batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error);
      } else {
        totalUpserted += batch.length;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[ASSEMBLY] Sync complete: ${totalUpserted}/${records.length} records in ${(elapsed/1000).toFixed(1)}s`);

    // Log the sync
    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_assembly",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: records.length,
      records_synced: totalUpserted,
      duration_ms: elapsed,
    });

    // ─────────────────────────────────────────────────────────────
    // Compute and upsert assembly_daily aggregates
    // This replaces the "Daily_Aggregation" sheet from the old Excel
    // ─────────────────────────────────────────────────────────────
    const dailyTotals = new Map<string, number>();
    for (const r of records) {
      dailyTotals.set(r.date, (dailyTotals.get(r.date) || 0) + r.quantity);
    }

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    // Helper to get ISO week number
    function getWeekNumber(date: Date): number {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    }

    const dailyAggregates = Array.from(dailyTotals.entries()).map(([dateStr, total]) => {
      const date = new Date(dateStr + "T12:00:00Z"); // Noon UTC to avoid timezone issues
      return {
        date: dateStr,
        daily_total: total,
        day_of_week: dayNames[date.getUTCDay()],
        week_num: getWeekNumber(date),
        month: date.getUTCMonth() + 1,
        year: date.getUTCFullYear(),
      };
    });

    let dailyUpserted = 0;
    if (dailyAggregates.length > 0) {
      const { error: dailyError } = await supabase
        .from("assembly_daily")
        .upsert(dailyAggregates, { onConflict: "date" });

      if (dailyError) {
        console.error("[ASSEMBLY] Daily aggregates upsert error:", dailyError);
      } else {
        dailyUpserted = dailyAggregates.length;
        console.log(`[ASSEMBLY] Upserted ${dailyUpserted} daily aggregate records`);
      }
    }

    // Get some stats for the response
    const skuCounts = new Map<string, number>();
    for (const r of records) {
      skuCounts.set(r.sku, (skuCounts.get(r.sku) || 0) + r.quantity);
    }
    const topSkus = Array.from(skuCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([sku, qty]) => ({ sku, qty }));

    return NextResponse.json({
      success: true,
      type: "assembly",
      mode: syncDescription,
      dateRange: { start: startDate, end: endDate },
      fetched: assemblyBuilds.length,
      filtered: records.length,
      skuDailyUpserted: totalUpserted,
      dailyAggregatesUpserted: dailyUpserted,
      uniqueSkus: skuCounts.size,
      uniqueDays: dailyTotals.size,
      topSkus,
      elapsed: `${(elapsed/1000).toFixed(1)}s`,
    });
  } catch (error) {
    console.error("[ASSEMBLY] Sync failed:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_assembly",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "failed",
      records_expected: 0,
      records_synced: 0,
      error_message: errorMessage,
      duration_ms: Date.now() - startTime,
    });

    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  } finally {
    await releaseCronLock(supabase, LOCK_NAME);
  }
}

export async function POST(request: Request) {
  return GET(request);
}
