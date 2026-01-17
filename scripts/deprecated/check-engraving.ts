import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function main() {
  // Get ALL unique SKUs containing engraving terms
  const { data } = await supabase
    .from("line_items")
    .select("sku, title")
    .or("sku.ilike.%eng%,title.ilike.%engrav%")
    .limit(1000);

  // Group by SKU
  const skus = new Map<string, { sku: string; title: string | null; count: number }>();
  for (const item of data || []) {
    const existing = skus.get(item.sku);
    if (existing) {
      existing.count++;
    } else {
      skus.set(item.sku, { sku: item.sku, title: item.title, count: 1 });
    }
  }

  console.log("Potential engraving SKUs found:");
  Array.from(skus.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .forEach((s) => console.log(`  ${s.sku} (${s.count}x) - ${s.title?.substring(0, 50)}`));

  // Now get unfulfilled engraving items with full details
  console.log("\n--- Checking unfulfilled orders ---");

  const { data: unfulfilled, count } = await supabase
    .from("orders")
    .select("id, order_name, fulfillment_status, canceled, line_items(sku, quantity, fulfilled_quantity)", { count: "exact" })
    .is("fulfillment_status", null)
    .eq("canceled", false)
    .limit(1000);

  let engravingUnits = 0;
  const engravingOrders = new Set<number>();

  for (const order of unfulfilled || []) {
    for (const li of order.line_items || []) {
      if (li.sku === "Smith-Eng" || li.sku === "Smith-Eng2") {
        const remaining = li.quantity - li.fulfilled_quantity;
        if (remaining > 0) {
          engravingUnits += remaining;
          engravingOrders.add(order.id);
          console.log(`Order ${order.order_name}: ${li.sku} x${remaining} unfulfilled`);
        }
      }
    }
  }

  console.log(`\nTotal unfulfilled engraving units: ${engravingUnits}`);
  console.log(`Total orders with engravings: ${engravingOrders.size}`);
  console.log(`Total unfulfilled orders checked: ${unfulfilled?.length} (of ${count} total)`);
}

main();
