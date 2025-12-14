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

    // Transform to Supabase format - sync all raw NetSuite fields (71 total)
    const records = customers.map((c: NSCustomer) => ({
      // Core identifiers
      ns_customer_id: c.id,
      entity_id: c.entityid,
      entity_number: c.entitynumber,
      entity_title: c.entitytitle,
      external_id: c.externalid,
      company_name: c.companyname || "Unknown",
      alt_name: c.altname,
      full_name: c.fullname,

      // Contact info
      email: c.email,
      phone: c.phone,
      alt_phone: c.altphone,
      fax: c.fax,
      url: c.url,

      // Dates
      date_created: c.datecreated ? new Date(c.datecreated).toISOString().split("T")[0] : null,
      date_closed: c.dateclosed,
      last_modified: c.lastmodifieddate,
      first_sale_date: c.firstsaledate,
      last_sale_date: c.lastsaledate,
      first_order_date: c.firstorderdate,
      last_order_date: c.lastorderdate,
      first_sale_period: c.firstsaleperiod,
      last_sale_period: c.lastsaleperiod,

      // Status flags
      is_inactive: c.isinactive === "T",
      is_person: c.isperson === "T",
      is_job: c.isjob === "T",
      is_budget_approved: c.isbudgetapproved === "T",
      is_duplicate: c.duplicate === "T",
      is_web_lead: c.weblead === "T",
      give_access: c.giveaccess === "T",
      is_unsubscribed: c.unsubscribe === "T",

      // Relationships
      parent_id: c.parent,
      top_level_parent: c.toplevelparent,

      // Classification
      terms: c.terms,
      category: c.category,
      entity_status: c.entitystatus,
      sales_rep: c.salesrep,
      territory: c.territory,
      search_stage: c.searchstage,
      probability: c.probability ? parseFloat(c.probability) : null,

      // Currency & Financial
      currency: c.currency,
      display_symbol: c.displaysymbol,
      symbol_placement: c.symbolplacement,
      override_currency_format: c.overridecurrencyformat === "T",
      credit_limit: c.creditlimit ? parseFloat(c.creditlimit) : null,
      balance: c.balance ? parseFloat(c.balance) : null,
      overdue_balance: c.overduebalance ? parseFloat(c.overduebalance) : null,
      consol_balance: c.consolbalance ? parseFloat(c.consolbalance) : null,
      unbilled_orders: c.unbilledorders ? parseFloat(c.unbilledorders) : null,
      deposit_balance: c.depositbalance ? parseFloat(c.depositbalance) : null,
      receivables_account: c.receivablesaccount,
      credit_hold_override: c.creditholdoverride,
      on_credit_hold: c.oncredithold === "T",
      days_overdue_search: c.daysoverduesearch ? parseInt(c.daysoverduesearch) : null,

      // Addresses
      bill_address: c.billaddress,
      ship_address: c.shipaddress,
      default_billing_address: c.defaultbillingaddress,
      default_shipping_address: c.defaultshippingaddress,

      // Preferences
      email_preference: c.emailpreference,
      email_transactions: c.emailtransactions === "T",
      fax_transactions: c.faxtransactions === "T",
      print_transactions: c.printtransactions === "T",
      global_subscription_status: c.globalsubscriptionstatus,
      ship_complete: c.shipcomplete === "T",
      shipping_carrier: c.shippingcarrier,
      alcohol_recipient_type: c.alcoholrecipienttype,
      is_taxable: c.taxable === "T",

      // Custom fields (custentity_*)
      custentity1: c.custentity1,
      custentity_2663_customer_refund: c.custentity_2663_customer_refund === "T",
      custentity_2663_direct_debit: c.custentity_2663_direct_debit === "T",
      custentity_alf_cust_hide_service_periods: c.custentity_alf_cust_hide_service_periods === "T",
      custentity_alf_customer_hide_total_vat: c.custentity_alf_customer_hide_total_vat === "T",
      custentity_alf_customer_store_pdf: c.custentity_alf_customer_store_pdf === "T",
      custentity_bdc_lastupdatedbyimport: c.custentity_bdc_lastupdatedbyimport === "T",
      custentity_bdc_shortname: c.custentity_bdc_shortname,
      custentity_bdc_sync_exclude: c.custentity_bdc_sync_exclude === "T",
      custentity_celigo_etail_cust_exported: c.custentity_celigo_etail_cust_exported === "T",
      custentity_celigo_is_updated_via_shp: c.custentity_celigo_is_updated_via_shp === "T",
      custentity_mhi_customer_type: c.custentity_mhi_customer_type,
      custentity_mhi_intsagramfacebook: c.custentity_mhi_intsagramfacebook === "T",
      custentity_naw_trans_need_approval: c.custentity_naw_trans_need_approval === "T",

      // Metadata
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
