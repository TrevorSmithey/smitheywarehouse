/**
 * Weekly Maintenance Cron
 *
 * Combines multiple weekly tasks into one cron job to save slots:
 * 1. ShipHero token refresh
 * 2. Shopify stats reconciliation
 * 3. Sync logs cleanup (prevents table bloat)
 * 4. Archived orders sync (catches orders archived in Shopify admin)
 *
 * Runs Sundays at 2:00 AM UTC (9:00 PM EST Saturday)
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

  // Use production URL for internal calls (Vercel cron may pass internal hostnames in request.url)
  const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : (() => {
          const url = new URL(request.url);
          return `${url.protocol}//${url.host}`;
        })();
  console.log(`[WEEKLY] Using baseUrl: ${baseUrl}`);

  // Get cron secret for internal calls
  const cronSecret = process.env.CRON_SECRET;
  const headers: HeadersInit = cronSecret
    ? { Authorization: `Bearer ${cronSecret}` }
    : {};

  // 1. Refresh ShipHero token
  console.log("[WEEKLY] Starting ShipHero token refresh...");
  const shipheroStart = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/cron/refresh-shiphero-token`, {
      method: "GET",
      headers,
    });
    const data = await res.json();
    results.shipheroRefresh = {
      success: res.ok,
      duration: Date.now() - shipheroStart,
      error: data.error,
    };
    console.log(`[WEEKLY] ShipHero refresh: ${res.ok ? "success" : "failed"}`);
  } catch (error) {
    results.shipheroRefresh = {
      success: false,
      duration: Date.now() - shipheroStart,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    console.error("[WEEKLY] ShipHero refresh error:", error);
  }

  // 2. Reconcile Shopify stats
  console.log("[WEEKLY] Starting Shopify stats reconciliation...");
  const reconcileStart = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/cron/reconcile-shopify-stats`, {
      method: "GET",
      headers,
    });
    const data = await res.json();
    results.shopifyReconcile = {
      success: res.ok,
      duration: Date.now() - reconcileStart,
      error: data.error,
    };
    console.log(`[WEEKLY] Shopify reconcile: ${res.ok ? "success" : "failed"}`);
  } catch (error) {
    results.shopifyReconcile = {
      success: false,
      duration: Date.now() - reconcileStart,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    console.error("[WEEKLY] Shopify reconcile error:", error);
  }

  // 3. Cleanup old sync logs (prevents table bloat)
  console.log("[WEEKLY] Starting sync logs cleanup...");
  const cleanupStart = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/cron/cleanup-sync-logs`, {
      method: "GET",
      headers,
    });
    const data = await res.json();
    results.syncLogsCleanup = {
      success: res.ok,
      duration: Date.now() - cleanupStart,
      error: data.error,
    };
    console.log(`[WEEKLY] Sync logs cleanup: ${res.ok ? "success" : "failed"} - deleted ${data.deleted || 0} rows`);
  } catch (error) {
    results.syncLogsCleanup = {
      success: false,
      duration: Date.now() - cleanupStart,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    console.error("[WEEKLY] Sync logs cleanup error:", error);
  }

  // 4. Sync archived orders from Shopify (catches orders archived in admin)
  console.log("[WEEKLY] Starting archived orders sync...");
  const archivedStart = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/cron/sync-archived-orders`, {
      method: "GET",
      headers,
    });
    const data = await res.json();
    results.archivedOrdersSync = {
      success: res.ok,
      duration: Date.now() - archivedStart,
      error: data.error,
    };
    console.log(`[WEEKLY] Archived orders sync: ${res.ok ? "success" : "failed"} - marked ${data.ordersMarkedArchived || 0} orders`);
  } catch (error) {
    results.archivedOrdersSync = {
      success: false,
      duration: Date.now() - archivedStart,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    console.error("[WEEKLY] Archived orders sync error:", error);
  }

  const totalDuration = Date.now() - startTime;
  const allSuccess = Object.values(results).every((r) => r.success);

  console.log(`[WEEKLY] Complete in ${totalDuration}ms. All success: ${allSuccess}`);

  return NextResponse.json({
    success: allSuccess,
    results,
    totalDuration,
  });
}

export async function POST(request: Request) {
  return GET(request);
}
