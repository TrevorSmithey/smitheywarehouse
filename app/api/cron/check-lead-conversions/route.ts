/**
 * Lead Conversion Detection Cron Job
 *
 * Runs daily to check if matched leads have converted to customers.
 * Looks for first orders after the lead submission date.
 *
 * Schedule: Daily at 7am UTC (via vercel.json)
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // 2 minutes

export async function GET(request: Request) {
  // Always verify cron secret - no exceptions
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  try {
    console.log("[LEAD-CONVERSION] Starting conversion check...");

    // 1. Find matched leads that haven't been marked as converted yet
    const { data: pendingLeads, error: leadsError } = await supabase
      .from("typeform_leads")
      .select("id, matched_customer_id, submitted_at, status")
      .in("match_status", ["auto_matched", "manual_matched"])
      .is("converted_at", null)
      .not("matched_customer_id", "is", null);

    if (leadsError) {
      console.error("[LEAD-CONVERSION] Error fetching leads:", leadsError);
      throw leadsError;
    }

    if (!pendingLeads || pendingLeads.length === 0) {
      console.log("[LEAD-CONVERSION] No pending leads to check");
      return NextResponse.json({
        success: true,
        message: "No pending leads to check",
        checked: 0,
        converted: 0,
      });
    }

    console.log(`[LEAD-CONVERSION] Found ${pendingLeads.length} matched leads to check`);

    // 2. Get the customer IDs to check
    const customerIds = pendingLeads
      .map((lead) => lead.matched_customer_id)
      .filter((id): id is number => id !== null);

    // 3. Find first orders for these customers from transactions
    // We look for the earliest transaction after the lead submission date
    const { data: transactions, error: txError } = await supabase
      .from("ns_wholesale_transactions")
      .select("ns_customer_id, ns_transaction_id, transaction_date, total_amount")
      .in("ns_customer_id", customerIds)
      .order("transaction_date", { ascending: true });

    if (txError) {
      console.error("[LEAD-CONVERSION] Error fetching transactions:", txError);
      throw txError;
    }

    // 4. Group first transaction by customer
    const firstOrderByCustomer = new Map<number, {
      transaction_id: number;
      transaction_date: string;
      total_amount: number;
    }>();

    for (const tx of transactions || []) {
      if (!firstOrderByCustomer.has(tx.ns_customer_id)) {
        firstOrderByCustomer.set(tx.ns_customer_id, {
          transaction_id: tx.ns_transaction_id,
          transaction_date: tx.transaction_date,
          total_amount: tx.total_amount,
        });
      }
    }

    // 5. Check each lead and update if converted
    let convertedCount = 0;
    const updates: {
      id: number;
      converted_at: string;
      first_order_id: number;
      first_order_date: string;
      first_order_amount: number;
      days_to_conversion: number;
      status: string;
    }[] = [];

    for (const lead of pendingLeads) {
      if (!lead.matched_customer_id) continue;

      const firstOrder = firstOrderByCustomer.get(lead.matched_customer_id);
      if (!firstOrder) continue;

      // Check if order is after lead submission
      const leadDate = new Date(lead.submitted_at);
      const orderDate = new Date(firstOrder.transaction_date);

      if (orderDate >= leadDate) {
        // Calculate days to conversion
        const daysToConversion = Math.floor(
          (orderDate.getTime() - leadDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        updates.push({
          id: lead.id,
          converted_at: firstOrder.transaction_date,
          first_order_id: firstOrder.transaction_id,
          first_order_date: firstOrder.transaction_date,
          first_order_amount: firstOrder.total_amount,
          days_to_conversion: daysToConversion,
          status: "converted",
        });

        convertedCount++;
      }
    }

    // 6. Apply updates
    if (updates.length > 0) {
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from("typeform_leads")
          .update({
            converted_at: update.converted_at,
            first_order_id: update.first_order_id,
            first_order_date: update.first_order_date,
            first_order_amount: update.first_order_amount,
            days_to_conversion: update.days_to_conversion,
            status: update.status,
          })
          .eq("id", update.id);

        if (updateError) {
          console.error(`[LEAD-CONVERSION] Error updating lead ${update.id}:`, updateError);
        }
      }
    }

    const elapsed = Date.now() - startTime;

    // 7. Log to sync_logs
    await supabase.from("sync_logs").insert({
      sync_type: "lead_conversion_check",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: pendingLeads.length,
      records_synced: convertedCount,
      duration_ms: elapsed,
      details: {
        leads_checked: pendingLeads.length,
        leads_converted: convertedCount,
      },
    });

    console.log(
      `[LEAD-CONVERSION] Complete: checked ${pendingLeads.length} leads, found ${convertedCount} conversions in ${elapsed}ms`
    );

    return NextResponse.json({
      success: true,
      checked: pendingLeads.length,
      converted: convertedCount,
      duration_ms: elapsed,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    console.error("[LEAD-CONVERSION] Error:", error);

    // Log failure
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "lead_conversion_check",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 0,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("[LEAD-CONVERSION] Failed to log error:", logError);
    }

    return NextResponse.json(
      { error: "Failed to check lead conversions", details: errorMessage },
      { status: 500 }
    );
  }
}
