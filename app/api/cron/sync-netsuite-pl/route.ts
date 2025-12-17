/**
 * NetSuite P&L Data Sync
 *
 * Syncs monthly P&L data from NetSuite by product category and channel.
 * Uses efficient server-side aggregation (2 API calls instead of 55+).
 *
 * By default syncs the current year. Pass ?year=YYYY for specific year.
 * Pass ?full=true for full historical sync (2024+).
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import {
  hasNetSuiteCredentials,
  fetchPLFromAccounts,
  fetchPLCookwareBreakdown,
  NSPLAggregated,
} from "@/lib/netsuite";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface PLMonthlyRecord {
  year_month: string;
  channel: string;
  category: string;
  revenue: number;
  synced_at: string;
}

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  const url = new URL(request.url);
  const isFullSync = url.searchParams.get("full") === "true";
  const specificYear = url.searchParams.get("year");

  // Determine date range
  const currentYear = new Date().getFullYear();
  let startYear = specificYear ? parseInt(specificYear) : currentYear;
  if (isFullSync) {
    startYear = 2019; // Start from 2019 for full historical sync (all available data)
  }
  const endYear = specificYear ? parseInt(specificYear) : currentYear;

  const startDate = `${startYear}-01-01`;
  const endDate = `${endYear}-12-31`;

  try {
    if (!hasNetSuiteCredentials()) {
      return NextResponse.json({ error: "Missing NetSuite credentials" }, { status: 500 });
    }

    console.log(`[PL-SYNC] Starting P&L sync for ${startDate} to ${endDate}...`);

    // 1. Fetch P&L from income accounts (source of truth)
    // Returns: Cookware, Accessories, Services, Shipping, Discounts by month/channel
    console.log("[PL-SYNC] Fetching P&L from income accounts...");
    const accountData = await fetchPLFromAccounts(startDate, endDate);
    console.log(`[PL-SYNC] Got ${accountData.length} account-level rows`);

    // 2. Fetch cookware breakdown (Cast Iron, Carbon Steel, Glass Lids)
    // Breaks down account 40200 into product categories
    console.log("[PL-SYNC] Fetching cookware breakdown...");
    const cookwareBreakdown = await fetchPLCookwareBreakdown(startDate, endDate);
    console.log(`[PL-SYNC] Got ${cookwareBreakdown.length} cookware breakdown rows`);

    const syncedAt = new Date().toISOString();
    const monthlyData: Record<string, PLMonthlyRecord> = {};

    // Process account data (excludes "Cookware" since we'll use the breakdown)
    for (const row of accountData) {
      // Skip "Cookware" - we'll use the detailed breakdown instead
      if (row.category === "Cookware") continue;

      const key = `${row.year_month}|${row.channel}|${row.category}`;
      const amount = parseFloat(row.total) || 0;

      if (!monthlyData[key]) {
        monthlyData[key] = {
          year_month: row.year_month,
          channel: row.channel,
          category: row.category,
          revenue: 0,
          synced_at: syncedAt,
        };
      }
      monthlyData[key].revenue += amount;
    }

    // Process cookware breakdown (Cast Iron, Carbon Steel, Glass Lids)
    for (const row of cookwareBreakdown) {
      const key = `${row.year_month}|${row.channel}|${row.category}`;
      const amount = parseFloat(row.total) || 0;

      if (!monthlyData[key]) {
        monthlyData[key] = {
          year_month: row.year_month,
          channel: row.channel,
          category: row.category,
          revenue: 0,
          synced_at: syncedAt,
        };
      }
      monthlyData[key].revenue += amount;
    }

    // 3. Upsert monthly P&L data
    const monthlyRecords = Object.values(monthlyData);
    console.log(`[PL-SYNC] Upserting ${monthlyRecords.length} monthly records...`);

    // Delete existing records for the date range first (clean slate)
    const { error: deleteMonthlyError } = await supabase
      .from("ns_pl_monthly")
      .delete()
      .gte("year_month", `${startYear}-01`)
      .lte("year_month", `${endYear}-12`);

    if (deleteMonthlyError) {
      console.error("[PL-SYNC] Error deleting existing monthly records:", deleteMonthlyError);
    }

    // Insert new records in batches
    const BATCH_SIZE = 100;
    let monthlyUpserted = 0;
    for (let i = 0; i < monthlyRecords.length; i += BATCH_SIZE) {
      const batch = monthlyRecords.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from("ns_pl_monthly").insert(batch);
      if (error) {
        console.error("[PL-SYNC] Monthly insert error:", error);
      } else {
        monthlyUpserted += batch.length;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[PL-SYNC] Complete: ${monthlyUpserted} records in ${(elapsed / 1000).toFixed(1)}s`);

    // Log sync
    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_pl",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: monthlyRecords.length,
      records_synced: monthlyUpserted,
      duration_ms: elapsed,
    });

    return NextResponse.json({
      success: true,
      dateRange: { start: startDate, end: endDate },
      accountRows: accountData.length,
      cookwareBreakdownRows: cookwareBreakdown.length,
      monthlyRecords: monthlyUpserted,
      elapsed: `${(elapsed / 1000).toFixed(1)}s`,
    });
  } catch (error) {
    console.error("[PL-SYNC] Failed:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_pl",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "failed",
      records_expected: 0,
      records_synced: 0,
      error_message: errorMessage,
      duration_ms: Date.now() - startTime,
    });

    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
