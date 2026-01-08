/**
 * Fix cancelled orders showing as active restorations
 *
 * The original cleanup script only checked financial_status === "refunded"
 * but missed orders where the `canceled` boolean is true.
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function fixCancelledOrders() {
  console.log("=== FIXING CANCELLED ORDERS ===\n");

  // Get all restorations NOT in cancelled status
  const { data: restorations } = await supabase
    .from("restorations")
    .select("id, order_id, status")
    .neq("status", "cancelled");

  const orderIds = restorations?.map(r => r.order_id).filter(Boolean) || [];

  // Find cancelled orders in batches
  const cancelledOrderIds = new Set<number>();
  const orderNameMap = new Map<number, string>();

  const batchSize = 500;
  for (let i = 0; i < orderIds.length; i += batchSize) {
    const batch = orderIds.slice(i, i + batchSize);
    const { data: orders } = await supabase
      .from("orders")
      .select("id, order_name")
      .in("id", batch)
      .eq("canceled", true);

    for (const o of orders || []) {
      cancelledOrderIds.add(o.id);
      orderNameMap.set(o.id, o.order_name);
    }
  }

  // Find restorations to fix
  const toFix = restorations?.filter(r => cancelledOrderIds.has(r.order_id!)) || [];

  console.log("Found", toFix.length, "restorations with cancelled orders to fix\n");

  // Fix them
  const now = new Date().toISOString();
  let fixed = 0;

  for (const r of toFix) {
    const { error } = await supabase
      .from("restorations")
      .update({
        status: "cancelled",
        cancelled_at: now,
        cancellation_reason: "Order cancelled in Shopify",
        updated_at: now
      })
      .eq("id", r.id);

    if (!error) {
      fixed++;
      const orderName = orderNameMap.get(r.order_id!);
      console.log("  Fixed:", orderName, "(" + r.status + " → cancelled)");
    } else {
      console.log("  Error fixing", r.id, ":", error.message);
    }
  }

  console.log("\nTotal fixed:", fixed);
}

fixCancelledOrders().catch(console.error);
