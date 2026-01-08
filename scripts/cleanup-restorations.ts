/**
 * Cleanup script for restoration data
 *
 * Marks completed restorations based on order fulfillment status:
 * - Fulfilled orders → restoration status = "delivered"
 * - Refunded orders (not fulfilled) → restoration status = "cancelled"
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function cleanup() {
  console.log("=== RESTORATION DATA CLEANUP ===\n");
  const now = new Date().toISOString();

  // 1. Get all restorations with order data
  const { data: restorations } = await supabase
    .from("restorations")
    .select("id, status, order_id");

  console.log("Total restorations:", restorations?.length);

  // Get order data in batches (Supabase .in() has limits)
  const orderIds = [...new Set(restorations?.map((r) => r.order_id).filter(Boolean))];
  const orderMap = new Map<number, { id: number; fulfilled_at: string | null; financial_status: string }>();

  const batchSize = 500;
  for (let i = 0; i < orderIds.length; i += batchSize) {
    const batch = orderIds.slice(i, i + batchSize);
    const { data: orders } = await supabase
      .from("orders")
      .select("id, fulfilled_at, financial_status")
      .in("id", batch);

    for (const o of orders || []) {
      orderMap.set(o.id, o);
    }
  }

  console.log("Orders loaded:", orderMap.size);

  // Categorize restorations
  const toDeliver: { id: number; fulfilled_at: string }[] = [];
  const toCancel: number[] = [];

  for (const r of restorations || []) {
    // Skip already terminal states
    if (["delivered", "shipped", "cancelled"].includes(r.status)) continue;

    const order = orderMap.get(r.order_id);
    if (!order) continue;

    // If order is fulfilled, restoration is done
    if (order.fulfilled_at) {
      toDeliver.push({ id: r.id, fulfilled_at: order.fulfilled_at });
    }
    // If refunded and NOT fulfilled, mark as cancelled
    else if (
      order.financial_status === "refunded" ||
      order.financial_status === "partially_refunded"
    ) {
      toCancel.push(r.id);
    }
  }

  console.log("\nCleanup actions:");
  console.log("  Mark as delivered:", toDeliver.length);
  console.log("  Mark as cancelled:", toCancel.length);

  // Execute cleanup - DELIVERED
  console.log("\nUpdating delivered...");
  let deliveredCount = 0;
  for (const item of toDeliver) {
    const { error } = await supabase
      .from("restorations")
      .update({
        status: "delivered",
        shipped_at: item.fulfilled_at,
        delivered_at: item.fulfilled_at,
        updated_at: now,
      })
      .eq("id", item.id);

    if (!error) deliveredCount++;
  }
  console.log("  Updated:", deliveredCount);

  // Execute cleanup - CANCELLED
  console.log("\nUpdating cancelled...");
  let cancelledCount = 0;
  for (const id of toCancel) {
    const { error } = await supabase
      .from("restorations")
      .update({
        status: "cancelled",
        cancelled_at: now,
        cancellation_reason: "Order refunded",
        updated_at: now,
      })
      .eq("id", id);

    if (!error) cancelledCount++;
  }
  console.log("  Updated:", cancelledCount);

  // Final stats
  const { data: finalStats } = await supabase.from("restorations").select("status");

  const statusCounts: Record<string, number> = {};
  for (const r of finalStats || []) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  }

  console.log("\n=== FINAL STATUS DISTRIBUTION ===");
  for (const [status, count] of Object.entries(statusCounts).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(" ", status + ":", count);
  }
}

cleanup().catch(console.error);
