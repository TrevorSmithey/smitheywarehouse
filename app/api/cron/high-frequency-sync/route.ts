/**
 * High-Frequency Sync
 *
 * Combines multiple 15-minute sync jobs to save Vercel cron slots:
 * 1. Re:amaze support tickets (polls for new conversations, classifies with Claude)
 * 2. ShipHero inventory (syncs stock levels)
 * 3. Warehouse backfill (catches orders where Shopify Flow tags were added after webhook)
 *
 * Runs every 15 minutes
 */

import { NextResponse } from "next/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const results: Record<string, { success: boolean; duration: number; error?: string }> = {};

  // Use production URL for internal calls
  // VERCEL_PROJECT_PRODUCTION_URL is the canonical production domain
  // VERCEL_URL is the deployment URL (could be preview)
  // Fallback to request.url for local dev
  const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : (() => {
          const url = new URL(request.url);
          return `${url.protocol}//${url.host}`;
        })();

  console.log(`[HIGH-FREQ] Using baseUrl: ${baseUrl}`);

  // Get cron secret for internal calls
  const cronSecret = process.env.CRON_SECRET;
  const headers: HeadersInit = cronSecret
    ? { Authorization: `Bearer ${cronSecret}` }
    : {};

  // 1. Sync Re:amaze support tickets
  console.log("[HIGH-FREQ] Starting Re:amaze sync...");
  const reamazeStart = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/cron/sync-reamaze`, {
      method: "GET",
      headers,
    });
    const data = await res.json();
    results.reamaze = {
      success: res.ok,
      duration: Date.now() - reamazeStart,
      error: data.error,
    };
    console.log(`[HIGH-FREQ] Re:amaze: ${res.ok ? "success" : "failed"} - ${data.processed || 0} processed`);
  } catch (error) {
    results.reamaze = {
      success: false,
      duration: Date.now() - reamazeStart,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    console.error("[HIGH-FREQ] Re:amaze error:", error);
  }

  // 2. Sync ShipHero inventory
  console.log("[HIGH-FREQ] Starting inventory sync...");
  const inventoryStart = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/cron/sync-inventory`, {
      method: "GET",
      headers,
    });
    const data = await res.json();
    results.inventory = {
      success: res.ok,
      duration: Date.now() - inventoryStart,
      error: data.error,
    };
    console.log(`[HIGH-FREQ] Inventory: ${res.ok ? "success" : "failed"}`);
  } catch (error) {
    results.inventory = {
      success: false,
      duration: Date.now() - inventoryStart,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    console.error("[HIGH-FREQ] Inventory error:", error);
  }

  // 3. Backfill warehouse tags
  console.log("[HIGH-FREQ] Starting warehouse backfill...");
  const backfillStart = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/cron/backfill-warehouse`, {
      method: "GET",
      headers,
    });
    const data = await res.json();
    results.backfillWarehouse = {
      success: res.ok,
      duration: Date.now() - backfillStart,
      error: data.error,
    };
    console.log(`[HIGH-FREQ] Backfill: ${res.ok ? "success" : "failed"} - ${data.updated || 0} updated`);
  } catch (error) {
    results.backfillWarehouse = {
      success: false,
      duration: Date.now() - backfillStart,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    console.error("[HIGH-FREQ] Backfill error:", error);
  }

  const totalDuration = Date.now() - startTime;
  const allSuccess = Object.values(results).every((r) => r.success);

  console.log(`[HIGH-FREQ] Complete in ${totalDuration}ms. All success: ${allSuccess}`);

  return NextResponse.json({
    success: allSuccess,
    results,
    totalDuration,
  });
}

export async function POST(request: Request) {
  return GET(request);
}
