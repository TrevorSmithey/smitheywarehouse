import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function checkNegative() {
  // Check for any negative inventory values
  const { data, error } = await supabase
    .from("inventory")
    .select("sku, warehouse_id, on_hand")
    .lt("on_hand", 0);

  if (error) {
    console.log("Error:", error.message);
    return;
  }

  console.log("=== Negative Inventory Check ===\n");
  console.log("Records with negative on_hand:", data?.length || 0);

  if (data && data.length > 0) {
    console.log("\nNegative values found:");
    data.forEach(r => {
      console.log(`  ${r.sku} @ warehouse ${r.warehouse_id}: ${r.on_hand}`);
    });
  }

  // Also check for zero inventory that might be hiding negatives
  const { data: zeroData } = await supabase
    .from("inventory")
    .select("sku, warehouse_id, on_hand, available")
    .eq("on_hand", 0);

  console.log("\nRecords with zero on_hand:", zeroData?.length || 0);
}

checkNegative();
