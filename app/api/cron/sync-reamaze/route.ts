/**
 * Re:amaze Sync Cron Job
 * Polls Re:amaze API for new conversations, classifies them with Claude, stores in Supabase
 *
 * Triggered by Vercel cron every 5 minutes
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { ReamazeClient, cleanMessageBody } from "@/lib/reamaze";
import { classifyTicket } from "@/lib/ticket-classifier";
import { sendSyncFailureAlert } from "@/lib/notifications";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes - must be literal for Next.js static analysis

export async function GET(request: Request) {
  // Always verify cron secret - no exceptions
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();

  try {
    console.log("[REAMAZE SYNC] Starting sync...");

    // Initialize clients
    const supabase = createServiceClient();

    // Check for required env vars
    const brand = process.env.REAMAZE_BRAND;
    const email = process.env.REAMAZE_EMAIL;
    const apiToken = process.env.REAMAZE_API_TOKEN;

    if (!brand || !email || !apiToken) {
      return NextResponse.json(
        { error: "Missing Re:amaze configuration" },
        { status: 500 }
      );
    }

    const reamaze = new ReamazeClient({ brand, email, apiToken });

    // Get last sync time from most recent ticket
    const { data: lastTicket } = await supabase
      .from("support_tickets")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Default to 24 hours ago if no tickets exist
    const lastSyncTime = lastTicket?.created_at
      ? new Date(lastTicket.created_at).toISOString()
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    console.log(`[REAMAZE SYNC] Fetching conversations since ${lastSyncTime}`);

    // Fetch new conversations from Re:amaze
    const conversations = await reamaze.fetchNewConversations(lastSyncTime);

    if (conversations.length === 0) {
      console.log("[REAMAZE SYNC] No new conversations");
      const duration = Date.now() - startTime;

      // Log success even when no new conversations
      try {
        await supabase.from("sync_logs").insert({
          sync_type: "reamaze",
          started_at: new Date(startTime).toISOString(),
          completed_at: new Date().toISOString(),
          status: "success",
          records_expected: 0,
          records_synced: 0,
          details: { message: "No new conversations" },
          duration_ms: duration,
        });
      } catch (logError) {
        console.error("[REAMAZE SYNC] Failed to log sync success:", logError);
      }

      return NextResponse.json({
        success: true,
        message: "No new conversations",
        processed: 0,
        duration,
      });
    }

    console.log(`[REAMAZE SYNC] Found ${conversations.length} new conversations`);

    // Process each conversation
    let processed = 0;
    let skipped = 0;
    let errors = 0;
    const failedTicketIds: string[] = [];

    for (const conv of conversations) {
      try {
        // Check if already exists
        const { data: existing } = await supabase
          .from("support_tickets")
          .select("id")
          .eq("reamaze_id", conv.slug)
          .single();

        if (existing) {
          skipped++;
          continue;
        }

        // Clean the message body for classification
        const cleanBody = cleanMessageBody(conv.message?.body || "");

        // Classify with Claude
        const classification = await classifyTicket(cleanBody);

        // Build permalink
        const permaUrl = ReamazeClient.getPermalink(brand, conv.slug);

        // Insert into Supabase
        const { error: insertError } = await supabase
          .from("support_tickets")
          .insert({
            reamaze_id: conv.slug,
            created_at: conv.created_at,
            subject: conv.subject,
            message_body: cleanBody.substring(0, 10000), // Truncate to prevent DB overflow
            channel: conv.category?.name || String(conv.category?.channel),
            perma_url: permaUrl,
            category: classification.category,
            sentiment: classification.sentiment,
            summary: classification.summary,
            urgency: classification.urgency,
          });

        if (insertError) {
          console.error(`[REAMAZE SYNC] Insert error for ${conv.slug}:`, insertError);
          errors++;
          failedTicketIds.push(conv.slug);
        } else {
          processed++;
        }

        // Log progress every 10 tickets
        if ((processed + skipped + errors) % 10 === 0) {
          console.log(`[REAMAZE SYNC] Progress: ${processed} processed, ${skipped} skipped, ${errors} errors`);
        }

      } catch (err) {
        console.error(`[REAMAZE SYNC] Error processing ${conv.slug}:`, err);
        errors++;
        failedTicketIds.push(conv.slug);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[REAMAZE SYNC] Complete: ${processed} processed, ${skipped} skipped, ${errors} errors in ${duration}ms`);

    // Log failed ticket IDs for debugging
    if (failedTicketIds.length > 0) {
      console.error(`[REAMAZE SYNC] Failed ticket IDs: ${failedTicketIds.join(", ")}`);
    }

    // Log success to sync_logs
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "reamaze",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: errors > 0 ? "partial" : "success",
        records_expected: conversations.length,
        records_synced: processed,
        details: { processed, skipped, errors },
        duration_ms: duration,
      });
    } catch (logError) {
      console.error("[REAMAZE SYNC] Failed to log sync success:", logError);
    }

    return NextResponse.json({
      success: true,
      processed,
      skipped,
      errors,
      total: conversations.length,
      duration,
      ...(failedTicketIds.length > 0 && { failedTicketIds }),
    });

  } catch (error) {
    console.error("[REAMAZE SYNC] Fatal error:", error);

    const errorMessage = error instanceof Error ? error.message : "Sync failed";
    const elapsed = Date.now() - startTime;

    // Send email alert
    await sendSyncFailureAlert({
      syncType: "Re:amaze Support Tickets",
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    // Log to sync_logs
    const supabase = createServiceClient();
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "reamaze",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 0,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("[REAMAZE SYNC] Failed to log sync failure:", logError);
    }

    return NextResponse.json(
      {
        error: errorMessage,
        duration: elapsed,
      },
      { status: 500 }
    );
  }
}

// POST handler for manual triggers
export async function POST(request: Request) {
  // Use shared cron auth for consistency
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  // Reuse GET logic
  return GET(request);
}
