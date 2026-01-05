/**
 * Weekly Maintenance Cron
 *
 * Combines multiple weekly tasks into one cron job to save slots:
 * 1. ShipHero token refresh
 * 2. Shopify stats reconciliation
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

  // Get the base URL from the request
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

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
