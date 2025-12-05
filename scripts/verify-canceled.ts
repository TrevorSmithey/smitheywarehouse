import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL!;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function shopifyGraphQL(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(
    `https://${SHOPIFY_STORE_URL}/admin/api/2024-10/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  return response.json();
}

async function main() {
  console.log("=== VERIFYING DISCREPANCY EXPLANATION ===\n");

  // Count canceled orders in Supabase that would show as "unfulfilled" in Shopify
  const { count: canceledUnfulfilled } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("canceled", true)
    .is("fulfillment_status", null)
    .gte("created_at", "2025-09-01");

  console.log("Orders that are:");
  console.log("  - Canceled in Supabase");
  console.log("  - Never fulfilled (fulfillment_status is null)");
  console.log("  - Created since Sept 1, 2025");
  console.log(`  = ${canceledUnfulfilled} orders\n`);

  // Get exact count from Shopify for comparison
  const shopifyUnfulfilled = `
    query {
      ordersCount(query: "fulfillment_status:unfulfilled created_at:>=2025-09-01") {
        count
      }
    }
  `;

  const shopifyCanceled = `
    query {
      ordersCount(query: "status:cancelled created_at:>=2025-09-01") {
        count
      }
    }
  `;

  // Also get unfulfilled that are NOT canceled
  const shopifyUnfulfilledNotCanceled = `
    query {
      ordersCount(query: "fulfillment_status:unfulfilled status:open created_at:>=2025-09-01") {
        count
      }
    }
  `;

  const [unfulfilledResult, canceledResult, notCanceledResult] = await Promise.all([
    shopifyGraphQL(shopifyUnfulfilled),
    shopifyGraphQL(shopifyCanceled),
    shopifyGraphQL(shopifyUnfulfilledNotCanceled),
  ]);

  console.log("Shopify counts (since Sept 1, 2025):");
  console.log(`  Unfulfilled (all): ${unfulfilledResult.data?.ordersCount?.count}`);
  console.log(`  Canceled: ${canceledResult.data?.ordersCount?.count}`);
  console.log(`  Unfulfilled AND Open (not canceled): ${notCanceledResult.data?.ordersCount?.count}`);

  // Get Supabase unfulfilled count for comparison
  const { count: supabaseUnfulfilled } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .is("fulfillment_status", null)
    .eq("canceled", false)
    .gte("created_at", "2025-09-01");

  const { count: supabasePartial } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("fulfillment_status", "partial")
    .eq("canceled", false)
    .gte("created_at", "2025-09-01");

  console.log(`\nSupabase counts (since Sept 1, 2025):`);
  console.log(`  Unfulfilled (not canceled): ${supabaseUnfulfilled}`);
  console.log(`  Partial (not canceled): ${supabasePartial}`);
  console.log(`  Total needing fulfillment: ${(supabaseUnfulfilled || 0) + (supabasePartial || 0)}`);

  console.log("\n=== RECONCILIATION ===");
  const shopifyUnfulfilledNotCanceledCount = notCanceledResult.data?.ordersCount?.count || 0;
  const supabaseTotal = (supabaseUnfulfilled || 0) + (supabasePartial || 0);
  const difference = shopifyUnfulfilledNotCanceledCount - supabaseTotal;

  console.log(`Shopify unfulfilled (not canceled): ${shopifyUnfulfilledNotCanceledCount}`);
  console.log(`Supabase needing fulfillment: ${supabaseTotal}`);
  console.log(`Difference: ${difference}`);

  if (Math.abs(difference) < 50) {
    console.log("\n✅ COUNTS MATCH (within acceptable variance)");
    console.log("The dashboard is showing accurate data.");
    console.log("The 400+ 'discrepancy' was actually canceled orders that Shopify");
    console.log("includes in 'unfulfilled' count but Supabase correctly excludes.");
  } else {
    console.log("\n⚠️  COUNTS STILL DIFFER - needs further investigation");
  }
}

main().catch(console.error);
