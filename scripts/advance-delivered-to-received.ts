/**
 * Auto-advance delivered_warehouse items to received
 *
 * Since this is a new system, items that have been delivered to the warehouse
 * should be assumed as received. Going forward, manual check-in creates accountability.
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function advanceDeliveredToReceived() {
  console.log("=== ADVANCING DELIVERED → RECEIVED ===\n");

  // Get all restorations in delivered_warehouse status
  const { data: restorations } = await supabase
    .from("restorations")
    .select("id, order_id, delivered_to_warehouse_at")
    .eq("status", "delivered_warehouse");

  console.log("Found", restorations?.length, "items in delivered_warehouse status\n");

  // Update them to received
  const now = new Date().toISOString();
  let advanced = 0;

  for (const r of restorations || []) {
    // Use delivered_to_warehouse_at as received_at if available
    const receivedAt = r.delivered_to_warehouse_at || now;

    const { error } = await supabase
      .from("restorations")
      .update({
        status: "received",
        received_at: receivedAt,
        updated_at: now
      })
      .eq("id", r.id);

    if (!error) {
      advanced++;
    } else {
      console.log("  Error advancing", r.id, ":", error.message);
    }
  }

  console.log("Advanced", advanced, "items to received status");
  console.log("\nThese items are now ready for the team to send to restoration.");
}

advanceDeliveredToReceived().catch(console.error);
