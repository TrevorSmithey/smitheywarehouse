/**
 * ShipHero Token Refresh Cron
 *
 * Automatically refreshes the ShipHero API token before it expires.
 * Runs weekly (tokens expire after 28 days, so weekly gives plenty of margin).
 *
 * Flow:
 * 1. Read refresh_token from api_tokens table
 * 2. Call ShipHero's /auth/refresh endpoint
 * 3. Update access_token and expires_at in database
 * 4. Log result to sync_logs
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // 30 seconds should be plenty

const SHIPHERO_REFRESH_URL = "https://public-api.shiphero.com/auth/refresh";

interface ShipHeroRefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds until expiration
  refresh_token?: string; // ShipHero might return a new refresh token
}

export async function GET(request: Request) {
  // Always verify cron secret
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  try {
    console.log("[SHIPHERO REFRESH] Starting token refresh...");

    // 1. Get the current refresh token from database
    const { data: tokenData, error: fetchError } = await supabase
      .from("api_tokens")
      .select("refresh_token, expires_at")
      .eq("service", "shiphero")
      .single();

    if (fetchError) {
      throw new Error(`Failed to fetch token from DB: ${fetchError.message}`);
    }

    if (!tokenData?.refresh_token) {
      throw new Error("No refresh token found in database");
    }

    // Check if token is still valid (optional - might want to skip if not close to expiry)
    const expiresAt = tokenData.expires_at ? new Date(tokenData.expires_at) : null;
    const daysUntilExpiry = expiresAt
      ? Math.floor((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null;

    console.log(`[SHIPHERO REFRESH] Current token expires in ${daysUntilExpiry ?? "unknown"} days`);

    // 2. Call ShipHero refresh endpoint
    const refreshResponse = await fetch(SHIPHERO_REFRESH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refresh_token: tokenData.refresh_token,
      }),
    });

    if (!refreshResponse.ok) {
      const errorText = await refreshResponse.text();
      throw new Error(`ShipHero refresh failed: ${refreshResponse.status} - ${errorText}`);
    }

    const refreshData: ShipHeroRefreshResponse = await refreshResponse.json();

    if (!refreshData.access_token) {
      throw new Error("ShipHero refresh response missing access_token");
    }

    // 3. Calculate new expiration time
    // ShipHero returns expires_in as seconds
    const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000);

    // 4. Update the token in database
    const updateData: {
      access_token: string;
      expires_at: string;
      updated_at: string;
      refresh_token?: string;
    } = {
      access_token: refreshData.access_token,
      expires_at: newExpiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    };

    // If ShipHero returns a new refresh token, update that too
    if (refreshData.refresh_token) {
      updateData.refresh_token = refreshData.refresh_token;
    }

    const { error: updateError } = await supabase
      .from("api_tokens")
      .update(updateData)
      .eq("service", "shiphero");

    if (updateError) {
      throw new Error(`Failed to update token in DB: ${updateError.message}`);
    }

    const duration = Date.now() - startTime;
    const newDaysUntilExpiry = Math.floor(
      (newExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    console.log(
      `[SHIPHERO REFRESH] Success! New token expires in ${newDaysUntilExpiry} days (${newExpiresAt.toISOString()})`
    );

    // 5. Log success to sync_logs
    await supabase.from("sync_logs").insert({
      sync_type: "shiphero_token_refresh",
      status: "success",
      duration_ms: duration,
      records_processed: 1,
      message: `Token refreshed successfully. New expiry: ${newExpiresAt.toISOString()} (${newDaysUntilExpiry} days)`,
    });

    return NextResponse.json({
      success: true,
      message: "ShipHero token refreshed successfully",
      expiresAt: newExpiresAt.toISOString(),
      daysUntilExpiry: newDaysUntilExpiry,
      duration: `${duration}ms`,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    console.error(`[SHIPHERO REFRESH] Failed: ${errorMessage}`);

    // Log failure to sync_logs
    await supabase.from("sync_logs").insert({
      sync_type: "shiphero_token_refresh",
      status: "error",
      duration_ms: duration,
      error_message: errorMessage,
      message: `Token refresh failed: ${errorMessage}`,
    });

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        duration: `${duration}ms`,
      },
      { status: 500 }
    );
  }
}
