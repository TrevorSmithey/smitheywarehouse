/**
 * NetSuite Wholesale Data Sync
 *
 * Syncs wholesale customers, transactions, and line items from NetSuite.
 * Uses OAuth 1.0 Token-Based Authentication.
 *
 * Triggered by Vercel cron daily at 6:00 AM UTC (1:00 AM EST)
 *
 * Data flow:
 * 1. Sync customers (business entities, excludes D2C entity 493)
 * 2. Sync transactions (CashSale + CustInvc)
 * 3. Sync line items (SKUs, quantities, prices)
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendSyncFailureAlert } from "@/lib/notifications";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import {
  hasNetSuiteCredentials,
  testConnection,
  fetchWholesaleCustomers,
  fetchWholesaleTransactions,
  fetchWholesaleLineItems,
  type NSCustomer,
  type NSTransaction,
  type NSLineItem,
} from "@/lib/netsuite";
import { BATCH_SIZES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes - must be literal for Next.js static analysis

interface SyncStats {
  customers: { fetched: number; upserted: number };
  transactions: { fetched: number; upserted: number };
  lineItems: { fetched: number; upserted: number };
}

async function syncCustomers(
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ fetched: number; upserted: number }> {
  console.log("[NETSUITE] Syncing customers...");

  let offset = 0;
  const limit = 1000;
  let totalFetched = 0;
  let totalUpserted = 0;

  while (true) {
    const customers = await fetchWholesaleCustomers(offset, limit);

    if (customers.length === 0) break;
    totalFetched += customers.length;

    // Transform to Supabase format - core fields only for performance
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
      balance: c.balance ? parseFloat(c.balance) : null,
      overdue_balance: c.overduebalance ? parseFloat(c.overduebalance) : null,
      consol_balance: c.consolbalance ? parseFloat(c.consolbalance) : null,
      unbilled_orders: c.unbilledorders ? parseFloat(c.unbilledorders) : null,
      deposit_balance: c.depositbalance ? parseFloat(c.depositbalance) : null,
      bill_address: c.billaddress,
      ship_address: c.shipaddress,
      default_billing_address: c.defaultbillingaddress,
      default_shipping_address: c.defaultshippingaddress,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    // Batch upsert
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
    await new Promise((r) => setTimeout(r, 300)); // Rate limit
  }

  return { fetched: totalFetched, upserted: totalUpserted };
}

async function syncTransactions(
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ fetched: number; upserted: number }> {
  console.log("[NETSUITE] Syncing transactions...");

  let offset = 0;
  const limit = 1000;
  let totalFetched = 0;
  let totalUpserted = 0;
  const seenIds = new Set<number>();

  while (true) {
    const transactions = await fetchWholesaleTransactions(offset, limit);

    if (transactions.length === 0) break;
    totalFetched += transactions.length;

    // Transform to Supabase format, deduping by transaction_id
    const records = transactions
      .filter((t: NSTransaction) => {
        if (seenIds.has(t.transaction_id)) return false;
        seenIds.add(t.transaction_id);
        return true;
      })
      .map((t: NSTransaction) => ({
        ns_transaction_id: t.transaction_id,
        tran_id: t.tranid,
        transaction_type: t.transaction_type,
        tran_date: t.trandate,
        foreign_total: t.transaction_total ? parseFloat(t.transaction_total) : null,
        status: t.status,
        ns_customer_id: t.customer_id,
        synced_at: new Date().toISOString(),
      }));

    if (records.length === 0) {
      if (transactions.length < limit) break;
      offset += limit;
      continue;
    }

    // Batch upsert
    for (let i = 0; i < records.length; i += BATCH_SIZES.DEFAULT) {
      const batch = records.slice(i, i + BATCH_SIZES.DEFAULT);
      const { error } = await supabase
        .from("ns_wholesale_transactions")
        .upsert(batch, { onConflict: "ns_transaction_id" });

      if (error) {
        console.error("[NETSUITE] Transaction upsert error:", error);
      } else {
        totalUpserted += batch.length;
      }
    }

    console.log(`[NETSUITE] Transactions: ${totalFetched} fetched, ${totalUpserted} upserted`);

    if (transactions.length < limit) break;
    offset += limit;
    await new Promise((r) => setTimeout(r, 300)); // Rate limit
  }

  return { fetched: totalFetched, upserted: totalUpserted };
}

async function syncLineItems(
  supabase: ReturnType<typeof createServiceClient>
): Promise<{ fetched: number; upserted: number }> {
  console.log("[NETSUITE] Syncing line items...");

  let offset = 0;
  const limit = 1000;
  let totalFetched = 0;
  let totalUpserted = 0;

  while (true) {
    const lineItems = await fetchWholesaleLineItems(offset, limit);

    if (lineItems.length === 0) break;
    totalFetched += lineItems.length;

    // Transform to Supabase format
    const records = lineItems.map((li: NSLineItem) => ({
      ns_line_id: li.line_id,
      ns_transaction_id: li.transaction_id,
      ns_item_id: li.item_id,
      sku: li.sku || "UNKNOWN",
      quantity: li.quantity ? parseInt(li.quantity) : 0,
      rate: li.rate ? parseFloat(li.rate) : null,
      net_amount: li.netamount ? parseFloat(li.netamount) : null,
      foreign_amount: li.foreignamount ? parseFloat(li.foreignamount) : null,
      item_type: li.itemtype,
      synced_at: new Date().toISOString(),
    }));

    // Batch upsert
    for (let i = 0; i < records.length; i += BATCH_SIZES.DEFAULT) {
      const batch = records.slice(i, i + BATCH_SIZES.DEFAULT);
      const { error } = await supabase
        .from("ns_wholesale_line_items")
        .upsert(batch, { onConflict: "ns_transaction_id,ns_line_id" });

      if (error) {
        console.error("[NETSUITE] Line item upsert error:", error);
      } else {
        totalUpserted += batch.length;
      }
    }

    console.log(`[NETSUITE] Line items: ${totalFetched} fetched, ${totalUpserted} upserted`);

    if (lineItems.length < limit) break;
    offset += limit;
    await new Promise((r) => setTimeout(r, 300)); // Rate limit
  }

  return { fetched: totalFetched, upserted: totalUpserted };
}

export async function GET(request: Request) {
  // Always verify cron secret - no exceptions
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  const stats: SyncStats = {
    customers: { fetched: 0, upserted: 0 },
    transactions: { fetched: 0, upserted: 0 },
    lineItems: { fetched: 0, upserted: 0 },
  };

  try {
    // Check credentials
    if (!hasNetSuiteCredentials()) {
      return NextResponse.json(
        { error: "Missing NetSuite credentials" },
        { status: 500 }
      );
    }

    console.log("[NETSUITE] Starting wholesale sync...");

    // Test connection
    const connected = await testConnection();
    if (!connected) {
      throw new Error("Failed to connect to NetSuite API");
    }
    console.log("[NETSUITE] Connection verified");

    // Sync in order: customers first (foreign key dependency)
    stats.customers = await syncCustomers(supabase);
    stats.transactions = await syncTransactions(supabase);
    stats.lineItems = await syncLineItems(supabase);

    const elapsed = Date.now() - startTime;
    const elapsedSec = (elapsed / 1000).toFixed(1);

    // Log sync result
    await supabase.from("sync_logs").insert({
      sync_type: "netsuite",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: stats.customers.fetched + stats.transactions.fetched + stats.lineItems.fetched,
      records_synced: stats.customers.upserted + stats.transactions.upserted + stats.lineItems.upserted,
      details: stats,
      duration_ms: elapsed,
    });

    console.log(`[NETSUITE] Sync complete in ${elapsedSec}s:`, stats);

    return NextResponse.json({
      success: true,
      status: "success",
      elapsed: `${elapsedSec}s`,
      stats,
    });
  } catch (error) {
    console.error("[NETSUITE] Sync failed:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const elapsed = Date.now() - startTime;

    // Send email alert
    await sendSyncFailureAlert({
      syncType: "NetSuite Wholesale",
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });

    // Log failure
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "netsuite",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 0,
        records_synced: 0,
        error_message: errorMessage,
        details: stats,
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("[NETSUITE] Failed to log sync failure:", logError);
    }

    return NextResponse.json(
      {
        success: false,
        status: "failed",
        error: errorMessage,
        stats,
      },
      { status: 500 }
    );
  }
}

// POST handler for manual triggers
export async function POST(request: Request) {
  return GET(request);
}
