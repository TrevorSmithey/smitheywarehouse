import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function audit() {
  console.log("=== DATA INTEGRITY AUDIT ===\n");

  // 1. Total order counts
  const { count: totalOrders } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true });
  console.log("Total orders in database:", totalOrders);

  // 2. Orders without warehouse tag
  const { count: noWarehouse } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .is("warehouse", null)
    .eq("canceled", false);
  console.log("Orders WITHOUT warehouse tag (not canceled):", noWarehouse);

  // 3. Orders by warehouse
  const { count: smitheyCount } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("warehouse", "smithey")
    .eq("canceled", false);
  const { count: seleryCount } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("warehouse", "selery")
    .eq("canceled", false);
  console.log("Smithey orders (not canceled):", smitheyCount);
  console.log("Selery orders (not canceled):", seleryCount);

  // 4. Orders by fulfillment status
  const { count: unfulfilled } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .is("fulfillment_status", null)
    .eq("canceled", false);
  const { count: partial } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("fulfillment_status", "partial")
    .eq("canceled", false);
  const { count: fulfilled } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("fulfillment_status", "fulfilled")
    .eq("canceled", false);
  const { count: canceled } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("canceled", true);

  console.log("\n--- Fulfillment Status ---");
  console.log("Unfulfilled (null):", unfulfilled);
  console.log("Partial:", partial);
  console.log("Fulfilled:", fulfilled);
  console.log("Canceled:", canceled);

  // 5. Check fulfilled orders have fulfilled_at
  const { count: fulfilledNoDate } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("fulfillment_status", "fulfilled")
    .is("fulfilled_at", null);
  console.log("\n--- Data Quality Issues ---");
  console.log("Fulfilled orders missing fulfilled_at:", fulfilledNoDate);

  // 6. Line items stats
  const { count: lineItemCount } = await supabase
    .from("line_items")
    .select("*", { count: "exact", head: true });
  console.log("Total line items:", lineItemCount);

  // 7. Date range of orders
  const { data: oldest } = await supabase
    .from("orders")
    .select("order_name, created_at")
    .order("created_at", { ascending: true })
    .limit(1);
  const { data: newest } = await supabase
    .from("orders")
    .select("order_name, created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  console.log("\n--- Date Range ---");
  console.log("Oldest order:", oldest?.[0]?.order_name, oldest?.[0]?.created_at);
  console.log("Newest order:", newest?.[0]?.order_name, newest?.[0]?.created_at);

  // 8. Sample of unfulfilled orders without warehouse
  const { data: noWhSample } = await supabase
    .from("orders")
    .select("order_name, created_at")
    .is("warehouse", null)
    .eq("canceled", false)
    .limit(5);
  if (noWhSample && noWhSample.length > 0) {
    console.log("\n--- Sample orders without warehouse tag ---");
    noWhSample.forEach((o) => console.log(o.order_name, o.created_at));
  }

  // 9. Fulfilled today count
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();
  const { count: fulfilledToday } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .gte("fulfilled_at", todayISO)
    .eq("canceled", false);
  console.log("\n--- Today's Activity ---");
  console.log("Fulfilled today (UTC midnight):", fulfilledToday);

  // 10. Created today
  const { count: createdToday } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .gte("created_at", todayISO)
    .eq("canceled", false);
  console.log("Created today (UTC midnight):", createdToday);

  // 11. Check engraving orders
  const { data: engravingData } = await supabase
    .from("line_items")
    .select("order_id, sku, quantity, fulfilled_quantity, orders!inner(fulfillment_status, canceled)")
    .or("sku.eq.Smith-Eng,sku.eq.Smith-Eng2")
    .eq("orders.canceled", false)
    .limit(5000);

  let engravingUnits = 0;
  const engravingOrders = new Set<number>();
  for (const row of engravingData || []) {
    const orders = row.orders as { fulfillment_status: string | null; canceled: boolean };
    if (orders.fulfillment_status === "fulfilled") continue;
    const unfulfilled = row.quantity - row.fulfilled_quantity;
    if (unfulfilled > 0) {
      engravingUnits += unfulfilled;
      engravingOrders.add(row.order_id);
    }
  }
  console.log("\n--- Engraving Queue ---");
  console.log("Unfulfilled engraving units:", engravingUnits);
  console.log("Orders with engravings:", engravingOrders.size);

  // 12. Shipments table stats
  const { count: shipmentCount } = await supabase
    .from("shipments")
    .select("*", { count: "exact", head: true });
  console.log("\n--- Shipments ---");
  console.log("Total shipment records:", shipmentCount);
}

audit().catch(console.error);
