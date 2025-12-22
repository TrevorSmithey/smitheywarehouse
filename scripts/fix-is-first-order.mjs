/**
 * Fix is_first_order Field - Targeted Approach
 *
 * Around mid-August 2025, Shopify stopped sending customer.orders_count.
 * This script identifies first orders and marks them correctly WITHOUT
 * resetting all orders (to avoid timeout).
 *
 * Usage: npx tsx scripts/fix-is-first-order.mjs
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log("=== Fix is_first_order Field (Targeted) ===\n");

  // Step 1: Find all first orders by scanning chronologically
  console.log("Step 1: Scanning orders to identify first orders per customer...");

  let offset = 0;
  const batchSize = 50000;
  const firstOrderIds = new Map(); // customer_id -> { orderId, createdAt }

  while (true) {
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, shopify_customer_id, created_at")
      .not("shopify_customer_id", "is", null)
      .neq("shopify_customer_id", -1)
      .eq("canceled", false)
      .order("created_at", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error("Query error:", error.message);
      break;
    }

    if (!orders || orders.length === 0) break;

    // Track first order for each customer
    for (const order of orders) {
      if (!firstOrderIds.has(order.shopify_customer_id)) {
        firstOrderIds.set(order.shopify_customer_id, order.id);
      }
    }

    console.log(`  Processed ${(offset + orders.length).toLocaleString()} orders, ${firstOrderIds.size.toLocaleString()} unique customers`);
    offset += batchSize;

    if (orders.length < batchSize) break;
  }

  const firstOrderIdSet = new Set(firstOrderIds.values());
  console.log(`\nTotal first orders to mark: ${firstOrderIdSet.size.toLocaleString()}`);

  // Step 2: Mark first orders as is_first_order = true
  console.log("\nStep 2: Marking first orders...");

  const idsToUpdate = Array.from(firstOrderIdSet);
  const updateBatchSize = 500;
  let markedTrue = 0;

  for (let i = 0; i < idsToUpdate.length; i += updateBatchSize) {
    const batch = idsToUpdate.slice(i, i + updateBatchSize);

    const { error: updateError } = await supabase
      .from("orders")
      .update({ is_first_order: true })
      .in("id", batch);

    if (updateError) {
      console.error(`  Batch error at ${i}:`, updateError.message);
    } else {
      markedTrue += batch.length;
    }

    if ((i + updateBatchSize) % 5000 === 0 || i + updateBatchSize >= idsToUpdate.length) {
      console.log(`  Progress: ${Math.min(i + updateBatchSize, idsToUpdate.length).toLocaleString()} / ${idsToUpdate.length.toLocaleString()}`);
    }
  }

  // Step 3: Mark non-first orders as is_first_order = false (only those currently true that shouldn't be)
  console.log("\nStep 3: Fixing incorrectly marked orders...");

  // Find orders currently marked true that shouldn't be
  let fixedFalse = 0;
  offset = 0;

  while (true) {
    const { data: wronglyTrue, error } = await supabase
      .from("orders")
      .select("id")
      .eq("is_first_order", true)
      .range(offset, offset + 10000 - 1);

    if (error) {
      console.error("Query error:", error.message);
      break;
    }

    if (!wronglyTrue || wronglyTrue.length === 0) break;

    // Filter to only those NOT in firstOrderIdSet
    const toFix = wronglyTrue.filter(o => !firstOrderIdSet.has(o.id)).map(o => o.id);

    if (toFix.length > 0) {
      for (let i = 0; i < toFix.length; i += 500) {
        const batch = toFix.slice(i, i + 500);
        const { error: fixError } = await supabase
          .from("orders")
          .update({ is_first_order: false })
          .in("id", batch);

        if (!fixError) {
          fixedFalse += batch.length;
        }
      }
    }

    offset += 10000;
    if (wronglyTrue.length < 10000) break;
  }

  console.log(`  Fixed ${fixedFalse} incorrectly marked orders.`);

  // Step 4: Verify the fix
  console.log("\nStep 4: Verifying fix...");

  const { data: verification } = await supabase.rpc("get_monthly_revenue_trends", {
    p_start_date: "2025-01-01",
    p_end_date: "2025-12-31"
  });

  console.log("\nMonthly New vs Returning Revenue (after fix):");
  console.log("Month       | New Revenue    | Returning Revenue");
  console.log("------------|----------------|------------------");
  for (const row of verification || []) {
    const newRev = Number(row.new_customer_revenue).toLocaleString("en-US", { maximumFractionDigits: 0 });
    const retRev = Number(row.returning_customer_revenue).toLocaleString("en-US", { maximumFractionDigits: 0 });
    console.log(`${row.month} | $${newRev.padStart(12)} | $${retRev.padStart(14)}`);
  }

  // Summary
  console.log("\n=== Summary ===");
  console.log(`First orders marked true: ${markedTrue.toLocaleString()}`);
  console.log(`Incorrectly marked orders fixed: ${fixedFalse.toLocaleString()}`);
  console.log("Complete!");
}

main().catch(console.error);
