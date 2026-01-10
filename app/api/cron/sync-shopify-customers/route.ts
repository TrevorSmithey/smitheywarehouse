/**
 * Shopify Customer Sync
 * Syncs customer data from Shopify to Supabase for ecommerce analytics
 *
 * Triggered by Vercel cron daily at 4:00 AM UTC (11:00 PM EST)
 *
 * Syncs:
 * - Customer profile (name, email, phone)
 * - Lifetime metrics (orders_count, total_spent)
 * - Marketing consent
 * - Geographic data (from default address)
 * - Tags for segmentation
 *
 * Uses incremental sync: only fetches customers updated since last sync
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyCronSecret, unauthorizedResponse } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { SHOPIFY_API_VERSION, withRetry } from "@/lib/shopify";
import { RATE_LIMIT_DELAYS } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

const LOCK_NAME = "sync-shopify-customers";

// GraphQL query for customers with all needed fields
// Note: Using 2024-01 API fields - numberOfOrders and amountSpent replaced ordersCount/totalSpentV2
const CUSTOMERS_QUERY = `
  query Customers($cursor: String, $query: String) {
    customers(first: 250, after: $cursor, query: $query) {
      edges {
        node {
          id
          email
          firstName
          lastName
          phone
          createdAt
          updatedAt
          numberOfOrders
          amountSpent {
            amount
            currencyCode
          }
          emailMarketingConsent {
            marketingState
          }
          smsMarketingConsent {
            marketingState
          }
          tags
          defaultAddress {
            city
            province
            provinceCode
            country
            countryCodeV2
            zip
          }
          orders(first: 1, sortKey: CREATED_AT, reverse: false) {
            edges {
              node {
                createdAt
              }
            }
          }
          lastOrder {
            createdAt
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

interface ShopifyCustomerNode {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
  numberOfOrders: number;
  amountSpent: {
    amount: string;
    currencyCode: string;
  };
  emailMarketingConsent: {
    marketingState: string;
  } | null;
  smsMarketingConsent: {
    marketingState: string;
  } | null;
  tags: string[];
  defaultAddress: {
    city: string | null;
    province: string | null;
    provinceCode: string | null;
    country: string | null;
    countryCodeV2: string | null;
    zip: string | null;
  } | null;
  orders: {
    edges: Array<{
      node: {
        createdAt: string;
      };
    }>;
  };
  lastOrder: {
    createdAt: string;
  } | null;
}

interface CustomerRecord {
  shopify_customer_id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  shopify_created_at: string;
  orders_count: number;
  total_spent: number;
  email_marketing_consent: boolean;
  sms_marketing_consent: boolean;
  tags: string | null;
  city: string | null;
  province: string | null;
  province_code: string | null;
  country: string | null;
  country_code: string | null;
  zip: string | null;
  first_order_date: string | null;
  last_order_date: string | null;
  synced_at: string;
}

function extractId(gid: string): number {
  const match = gid.match(/\/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

function transformCustomer(node: ShopifyCustomerNode): CustomerRecord {
  const firstOrderDate = node.orders.edges.length > 0
    ? node.orders.edges[0].node.createdAt
    : null;

  const lastOrderDate = node.lastOrder?.createdAt || null;

  return {
    shopify_customer_id: extractId(node.id),
    email: node.email,
    first_name: node.firstName,
    last_name: node.lastName,
    phone: node.phone,
    shopify_created_at: node.createdAt,
    orders_count: node.numberOfOrders || 0,
    total_spent: parseFloat(node.amountSpent?.amount || "0"),
    email_marketing_consent: node.emailMarketingConsent?.marketingState === "SUBSCRIBED",
    sms_marketing_consent: node.smsMarketingConsent?.marketingState === "SUBSCRIBED",
    tags: node.tags.length > 0 ? node.tags.join(", ") : null,
    city: node.defaultAddress?.city || null,
    province: node.defaultAddress?.province || null,
    province_code: node.defaultAddress?.provinceCode || null,
    country: node.defaultAddress?.country || null,
    country_code: node.defaultAddress?.countryCodeV2 || null,
    zip: node.defaultAddress?.zip || null,
    first_order_date: firstOrderDate,
    last_order_date: lastOrderDate,
    synced_at: new Date().toISOString(),
  };
}

async function fetchCustomers(
  query?: string
): Promise<CustomerRecord[]> {
  const shop = process.env.SHOPIFY_STORE_URL;
  const accessToken = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!shop || !accessToken) {
    throw new Error("Missing Shopify credentials");
  }

  const customers: CustomerRecord[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  let pageCount = 0;

  while (hasMore) {
    pageCount++;
    console.log(`[CUSTOMER SYNC] Fetching page ${pageCount}...`);

    const { data } = await withRetry(
      async () => {
        const response = await fetch(
          `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
          {
            method: "POST",
            headers: {
              "X-Shopify-Access-Token": accessToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: CUSTOMERS_QUERY,
              variables: { cursor, query },
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[CUSTOMER SYNC] API error: ${response.status} - ${errorText}`);
          throw new Error(`Shopify API error: ${response.status}`);
        }

        const result = await response.json();

        if (result.errors) {
          console.error("[CUSTOMER SYNC] GraphQL errors:", result.errors);
          throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
        }

        return result;
      },
      { maxRetries: 3, baseDelayMs: 1000 },
      "Shopify customer fetch"
    );

    const edges = data.customers.edges;
    const pageInfo = data.customers.pageInfo;

    for (const edge of edges) {
      customers.push(transformCustomer(edge.node));
    }

    console.log(`[CUSTOMER SYNC] Page ${pageCount}: ${edges.length} customers (total: ${customers.length})`);

    if (pageInfo.hasNextPage && pageInfo.endCursor) {
      cursor = pageInfo.endCursor;
      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAYS.SHOPIFY));
    } else {
      hasMore = false;
    }
  }

  return customers;
}

async function upsertCustomers(
  supabase: ReturnType<typeof createServiceClient>,
  customers: CustomerRecord[]
): Promise<{ inserted: number; updated: number; errors: number }> {
  const stats = { inserted: 0, updated: 0, errors: 0 };

  // Batch upsert in chunks of 100
  const chunkSize = 100;
  for (let i = 0; i < customers.length; i += chunkSize) {
    const chunk = customers.slice(i, i + chunkSize);

    const { error } = await supabase
      .from("shopify_customers")
      .upsert(chunk, {
        onConflict: "shopify_customer_id",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`[CUSTOMER SYNC] Upsert error for chunk ${i / chunkSize + 1}:`, error);
      stats.errors += chunk.length;
    } else {
      stats.inserted += chunk.length; // Upsert doesn't distinguish, count all as success
    }
  }

  return stats;
}

export async function GET(request: Request) {
  // Verify cron secret
  if (!verifyCronSecret(request)) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  // Acquire lock
  const lock = await acquireCronLock(supabase, LOCK_NAME);
  if (!lock.acquired) {
    console.warn(`[CUSTOMER SYNC] Skipping - another sync is in progress`);
    return NextResponse.json(
      { success: false, error: "Another sync is already in progress", skipped: true },
      { status: 409 }
    );
  }

  try {
    console.log("[CUSTOMER SYNC] Starting sync...");

    // Get last sync time for incremental sync
    const { data: lastSync } = await supabase
      .from("sync_logs")
      .select("completed_at")
      .eq("sync_type", "shopify_customers")
      .eq("status", "success")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single();

    let query: string | undefined;

    if (lastSync?.completed_at) {
      // Incremental sync: only customers updated since last sync
      // Add 1 hour buffer for clock skew
      const since = new Date(new Date(lastSync.completed_at).getTime() - 60 * 60 * 1000);
      query = `updated_at:>='${since.toISOString()}'`;
      console.log(`[CUSTOMER SYNC] Incremental sync since ${since.toISOString()}`);
    } else {
      // Full sync: all customers (first run)
      console.log("[CUSTOMER SYNC] Full sync (first run)");
    }

    // Fetch customers from Shopify
    const customers = await fetchCustomers(query);
    console.log(`[CUSTOMER SYNC] Fetched ${customers.length} customers`);

    if (customers.length === 0) {
      console.log("[CUSTOMER SYNC] No customers to sync");

      // Log success even if no updates
      await supabase.from("sync_logs").insert({
        sync_type: "shopify_customers",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "success",
        records_expected: 0,
        records_synced: 0,
        details: { message: "No customers updated since last sync" },
        duration_ms: Date.now() - startTime,
      });

      return NextResponse.json({
        success: true,
        message: "No customers to sync",
        duration: Date.now() - startTime,
      });
    }

    // Upsert to database
    const stats = await upsertCustomers(supabase, customers);
    console.log("[CUSTOMER SYNC] Upsert complete:", stats);

    // Update computed fields (customer_type, cohort, etc.)
    console.log("[CUSTOMER SYNC] Updating computed fields...");
    const { error: computeError } = await supabase.rpc("update_customer_computed_fields");
    if (computeError) {
      console.error("[CUSTOMER SYNC] Error updating computed fields:", computeError);
    }

    const duration = Date.now() - startTime;

    // Log success
    await supabase.from("sync_logs").insert({
      sync_type: "shopify_customers",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: customers.length,
      records_synced: stats.inserted,
      details: stats,
      duration_ms: duration,
    });

    console.log(`[CUSTOMER SYNC] Complete in ${duration}ms`);

    return NextResponse.json({
      success: true,
      customersProcessed: customers.length,
      ...stats,
      duration,
    });

  } catch (error) {
    console.error("[CUSTOMER SYNC] Fatal error:", error);

    const errorMessage = error instanceof Error ? error.message : "Sync failed";
    const elapsed = Date.now() - startTime;

    // Log failure
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "shopify_customers",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 0,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("[CUSTOMER SYNC] Failed to log error:", logError);
    }

    return NextResponse.json(
      { success: false, error: errorMessage, duration: elapsed },
      { status: 500 }
    );

  } finally {
    await releaseCronLock(supabase, LOCK_NAME);
  }
}

// POST for manual triggers
export async function POST(request: Request) {
  return GET(request);
}
