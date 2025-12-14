/**
 * NetSuite Sync Debug - Step-by-step sync test to identify timeout cause
 * Mimics sync-netsuite-customers but with detailed timing and early exit
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  hasNetSuiteCredentials,
  testConnection,
  fetchWholesaleCustomers,
  type NSCustomer,
} from "@/lib/netsuite";
import { BATCH_SIZES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // 1 minute timeout for debug endpoint

export async function GET(request: Request) {
  const url = new URL(request.url);
  const step = url.searchParams.get("step") || "all";

  const times: Record<string, number> = {};
  const start = Date.now();

  try {
    // Step 1: Check credentials
    times["credential_check_start"] = Date.now() - start;
    if (!hasNetSuiteCredentials()) {
      return NextResponse.json({ error: "Missing credentials", times });
    }
    times["credential_check_end"] = Date.now() - start;

    if (step === "credentials") {
      return NextResponse.json({ success: true, step, times });
    }

    // Step 2: Create Supabase client
    times["supabase_client_start"] = Date.now() - start;
    const supabase = createServiceClient();
    times["supabase_client_end"] = Date.now() - start;

    if (step === "supabase") {
      return NextResponse.json({ success: true, step, times });
    }

    // Step 3: Test NetSuite connection
    times["connection_test_start"] = Date.now() - start;
    const connected = await testConnection();
    times["connection_test_end"] = Date.now() - start;

    if (!connected) {
      return NextResponse.json({ error: "Connection test failed", times });
    }

    if (step === "connection") {
      return NextResponse.json({ success: true, step, connected, times });
    }

    // Step 4: Fetch one batch of customers
    times["fetch_start"] = Date.now() - start;
    const customers = await fetchWholesaleCustomers(0, 200);
    times["fetch_end"] = Date.now() - start;

    if (step === "fetch") {
      return NextResponse.json({
        success: true,
        step,
        count: customers.length,
        sample: customers[0],
        times
      });
    }

    // Step 5: Prepare records for upsert
    times["prepare_start"] = Date.now() - start;
    const records = customers.map((c: NSCustomer) => ({
      ns_customer_id: c.id,
      entity_id: c.entityid,
      company_name: c.companyname || "Unknown",
      email: c.email,
      phone: c.phone,
      alt_phone: c.altphone,
      fax: c.fax,
      url: c.url,
      first_sale_date: c.firstsaledate,
      last_sale_date: c.lastsaledate,
      first_order_date: c.firstorderdate,
      last_order_date: c.lastorderdate,
      date_created: c.datecreated ? new Date(c.datecreated).toISOString().split("T")[0] : null,
      last_modified: c.lastmodifieddate,
      is_inactive: c.isinactive === "T",
      parent_id: c.parent,
      terms: c.terms,
      category: c.category,
      entity_status: c.entitystatus,
      sales_rep: c.salesrep,
      territory: c.territory,
      currency: c.currency,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    times["prepare_end"] = Date.now() - start;

    if (step === "prepare") {
      return NextResponse.json({
        success: true,
        step,
        recordCount: records.length,
        sampleRecord: records[0],
        times
      });
    }

    // Step 6: Upsert one batch to Supabase
    times["upsert_start"] = Date.now() - start;
    const batch = records.slice(0, BATCH_SIZES.DEFAULT);
    const { data, error } = await supabase
      .from("ns_wholesale_customers")
      .upsert(batch, { onConflict: "ns_customer_id" })
      .select("ns_customer_id");
    times["upsert_end"] = Date.now() - start;

    if (error) {
      return NextResponse.json({
        error: "Upsert failed",
        errorMessage: error.message,
        times
      });
    }

    // Step 7: Log sync (optional)
    times["log_start"] = Date.now() - start;
    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_customers_debug",
      started_at: new Date(start).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: customers.length,
      records_synced: batch.length,
      duration_ms: Date.now() - start,
    });
    times["log_end"] = Date.now() - start;

    return NextResponse.json({
      success: true,
      step: "all",
      customersFound: customers.length,
      recordsUpserted: batch.length,
      totalTime: Date.now() - start,
      times,
    });

  } catch (error) {
    times["error_at"] = Date.now() - start;
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      errorStack: error instanceof Error ? error.stack?.split("\n").slice(0, 5) : undefined,
      times,
    }, { status: 500 });
  }
}
