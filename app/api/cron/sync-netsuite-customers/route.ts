/**
 * NetSuite Customers Sync (Part 1 of 3)
 *
 * Syncs wholesale customers from NetSuite.
 * Split from main sync to avoid Vercel timeout.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import {
  hasNetSuiteCredentials,
  testConnection,
  fetchWholesaleCustomers,
  type NSCustomer,
} from "@/lib/netsuite";
import { BATCH_SIZES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  try {
    if (!hasNetSuiteCredentials()) {
      return NextResponse.json({ error: "Missing NetSuite credentials" }, { status: 500 });
    }

    console.log("[NETSUITE] Starting customers sync...");

    const connected = await testConnection();
    if (!connected) {
      throw new Error("Failed to connect to NetSuite API");
    }

    let offset = 0;
    const limit = 200; // Reduced from 1000 for better reliability from serverless
    let totalFetched = 0;
    let totalUpserted = 0;

    while (true) {
      const customers = await fetchWholesaleCustomers(offset, limit);
      if (customers.length === 0) break;
      totalFetched += customers.length;

      // Note: balance fields (balance, overduebalance, etc.) removed from query
      // because they're calculated fields that cause 30+ second timeouts from Vercel
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
        credit_limit: c.creditlimit ? parseFloat(c.creditlimit) : null,
        // Balance fields not synced - they cause NetSuite query timeouts
        bill_address: c.billaddress,
        ship_address: c.shipaddress,
        default_billing_address: c.defaultbillingaddress,
        default_shipping_address: c.defaultshippingaddress,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      for (let i = 0; i < records.length; i += BATCH_SIZES.DEFAULT) {
        const batch = records.slice(i, i + BATCH_SIZES.DEFAULT);
        const { error } = await supabase
          .from("ns_wholesale_customers")
          .upsert(batch, { onConflict: "ns_customer_id" });

        if (error) {
          console.error("[NETSUITE] Customer upsert error:", error);
        } else {
          totalUpserted += batch.length;
        }
      }

      console.log(`[NETSUITE] Customers: ${totalFetched} fetched, ${totalUpserted} upserted`);

      if (customers.length < limit) break;
      offset += limit;
      await new Promise((r) => setTimeout(r, 200));
    }

    const elapsed = Date.now() - startTime;

    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_customers",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: totalFetched,
      records_synced: totalUpserted,
      duration_ms: elapsed,
    });

    console.log(`[NETSUITE] Customers sync complete: ${totalUpserted} records in ${(elapsed/1000).toFixed(1)}s`);

    return NextResponse.json({
      success: true,
      type: "customers",
      fetched: totalFetched,
      upserted: totalUpserted,
      elapsed: `${(elapsed/1000).toFixed(1)}s`,
    });
  } catch (error) {
    console.error("[NETSUITE] Customers sync failed:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await supabase.from("sync_logs").insert({
      sync_type: "netsuite_customers",
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
