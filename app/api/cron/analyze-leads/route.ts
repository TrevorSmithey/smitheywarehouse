/**
 * Lead Analysis Cron Job
 *
 * Runs periodically to analyze unanalyzed leads using Claude AI.
 * Generates summaries and fit scores for each lead.
 *
 * Schedule: Every 2 hours (via vercel.json)
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { analyzeLead } from "@/lib/lead-analyzer";
import type { TypeformLead } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // 2 minutes

// Maximum leads to analyze per run (to stay within time limits)
const MAX_LEADS_PER_RUN = 25;

export async function GET(request: Request) {
  // Verify cron secret
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  try {
    console.log("[ANALYZE-LEADS] Starting lead analysis...");

    // Find leads that haven't been analyzed yet
    const { data: unanalyzedLeads, error: fetchError } = await supabase
      .from("typeform_leads")
      .select("*")
      .is("ai_analyzed_at", null)
      .order("submitted_at", { ascending: false })
      .limit(MAX_LEADS_PER_RUN);

    if (fetchError) {
      console.error("[ANALYZE-LEADS] Error fetching leads:", fetchError);
      throw fetchError;
    }

    if (!unanalyzedLeads || unanalyzedLeads.length === 0) {
      console.log("[ANALYZE-LEADS] No unanalyzed leads found");
      return NextResponse.json({
        success: true,
        message: "No leads to analyze",
        analyzed: 0,
      });
    }

    console.log(`[ANALYZE-LEADS] Found ${unanalyzedLeads.length} leads to analyze`);

    let analyzed = 0;
    let failed = 0;

    for (const lead of unanalyzedLeads as TypeformLead[]) {
      try {
        console.log(`[ANALYZE-LEADS] Analyzing lead ${lead.id}: ${lead.company_name}`);

        const analysis = await analyzeLead(lead);

        if (analysis.analysisFailed) {
          console.error(`[ANALYZE-LEADS] Analysis failed for ${lead.id}:`, analysis.error);
          failed++;
          continue;
        }

        // Update the lead with analysis results
        const { error: updateError } = await supabase
          .from("typeform_leads")
          .update({
            ai_summary: analysis.summary,
            ai_fit_score: analysis.fit_score,
            ai_analyzed_at: new Date().toISOString(),
          })
          .eq("id", lead.id);

        if (updateError) {
          console.error(`[ANALYZE-LEADS] Error updating lead ${lead.id}:`, updateError);
          failed++;
        } else {
          analyzed++;
          console.log(
            `[ANALYZE-LEADS] Lead ${lead.id} analyzed - Score: ${analysis.fit_score}/5 - ${analysis.recommendation}`
          );
        }

        // Rate limiting between API calls
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`[ANALYZE-LEADS] Error processing lead ${lead.id}:`, error);
        failed++;
      }
    }

    const elapsed = Date.now() - startTime;

    // Log to sync_logs
    await supabase.from("sync_logs").insert({
      sync_type: "lead_analysis",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: failed === 0 ? "success" : "partial",
      records_expected: unanalyzedLeads.length,
      records_synced: analyzed,
      duration_ms: elapsed,
      details: {
        leads_found: unanalyzedLeads.length,
        leads_analyzed: analyzed,
        leads_failed: failed,
      },
    });

    console.log(
      `[ANALYZE-LEADS] Complete: ${analyzed} analyzed, ${failed} failed in ${elapsed}ms`
    );

    return NextResponse.json({
      success: true,
      analyzed,
      failed,
      duration_ms: elapsed,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    console.error("[ANALYZE-LEADS] Error:", error);

    // Log failure
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "lead_analysis",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 0,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("[ANALYZE-LEADS] Failed to log error:", logError);
    }

    return NextResponse.json(
      { error: "Failed to analyze leads", details: errorMessage },
      { status: 500 }
    );
  }
}

// Also support POST for manual triggering
export { GET as POST };
