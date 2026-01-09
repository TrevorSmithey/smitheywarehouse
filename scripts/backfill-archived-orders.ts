/**
 * One-time script to backfill archived status from Shopify
 * Run with: npx tsx scripts/backfill-archived-orders.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const SHOPIFY_API_VERSION = "2024-10";
const LOOKBACK_DAYS = 365;
const PAGE_LIMIT = 250;

interface ShopifyOrder {
  id: number;
  name: string;
  closed_at: string | null;
}

async function fetchArchivedOrders(
  shop: string,
  accessToken: string,
  createdAtMin: string,
  pageInfo?: string
): Promise<{ orders: ShopifyOrder[]; nextPageInfo: string | null }> {
  let url: string;

  if (pageInfo) {
    url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=${PAGE_LIMIT}&page_info=${pageInfo}`;
  } else {
    url =
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
      `?status=closed` +
      `&created_at_min=${createdAtMin}` +
      `&limit=${PAGE_LIMIT}` +
      `&fields=id,name,closed_at`;
  }

  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
    },
  });

  if (!res.ok) {
    throw new Error(`Shopify API error: ${res.status} ${res.statusText}`);
  }

  // Parse Link header for pagination
  const linkHeader = res.headers.get("Link");
  let nextPage: string | null = null;

  if (linkHeader) {
    const nextMatch = linkHeader.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    if (nextMatch) {
      nextPage = nextMatch[1];
    }
  }

  const data = await res.json();
  return { orders: data.orders, nextPageInfo: nextPage };
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const shopifyStore = process.env.SHOPIFY_STORE_URL;
  const shopifyToken = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase credentials");
  }
  if (!shopifyStore || !shopifyToken) {
    throw new Error("Missing Shopify credentials");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Calculate lookback date
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - LOOKBACK_DAYS);
  const createdAtMin = lookbackDate.toISOString();

  console.log(`Fetching archived orders since ${createdAtMin}...`);

  // Paginate through all archived orders
  let pageInfo: string | undefined = undefined;
  let allArchivedOrders: ShopifyOrder[] = [];

  do {
    const result = await fetchArchivedOrders(shopifyStore, shopifyToken, createdAtMin, pageInfo);
    allArchivedOrders = allArchivedOrders.concat(result.orders);
    pageInfo = result.nextPageInfo || undefined;
    console.log(`Fetched ${result.orders.length} orders (total: ${allArchivedOrders.length})`);
  } while (pageInfo);

  console.log(`\nTotal archived orders from Shopify: ${allArchivedOrders.length}`);

  if (allArchivedOrders.length === 0) {
    console.log("No archived orders to process.");
    return;
  }

  // Get current archived status from our DB
  const orderIds = allArchivedOrders.map((o) => o.id);
  const batchSize = 500;
  let totalMarked = 0;
  let alreadyArchived = 0;
  let notInDb = 0;

  for (let i = 0; i < orderIds.length; i += batchSize) {
    const batchIds = orderIds.slice(i, i + batchSize);

    const { data: dbOrders, error: fetchError } = await supabase
      .from("orders")
      .select("id, archived")
      .in("id", batchIds);

    if (fetchError) {
      console.error(`Error fetching batch: ${fetchError.message}`);
      continue;
    }

    const dbOrderMap = new Map(dbOrders?.map((o) => [o.id, o.archived]) || []);
    const ordersToUpdate: number[] = [];

    for (const shopifyOrder of allArchivedOrders.slice(i, i + batchSize)) {
      const currentArchived = dbOrderMap.get(shopifyOrder.id);

      if (currentArchived === undefined) {
        notInDb++;
      } else if (currentArchived === true) {
        alreadyArchived++;
      } else {
        ordersToUpdate.push(shopifyOrder.id);
      }
    }

    if (ordersToUpdate.length > 0) {
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          archived: true,
          updated_at: new Date().toISOString(),
        })
        .in("id", ordersToUpdate);

      if (updateError) {
        console.error(`Error updating batch: ${updateError.message}`);
      } else {
        totalMarked += ordersToUpdate.length;
        console.log(`Marked ${ordersToUpdate.length} orders as archived`);
      }
    }
  }

  console.log(`\nSummary:`);
  console.log(`- Total from Shopify: ${allArchivedOrders.length}`);
  console.log(`- Already archived in DB: ${alreadyArchived}`);
  console.log(`- Not in our DB: ${notInDb}`);
  console.log(`- Newly marked archived: ${totalMarked}`);
}

main().catch(console.error);
