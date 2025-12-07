import { config } from "dotenv";
config({ path: "/Users/trevorfunderburk/smitheywarehouse/.env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string
);

async function check() {
  const shipped = new Date("2025-11-15T00:00:00.000Z");

  // Status breakdown
  const { count: delivered } = await supabase
    .from("shipments")
    .select("*", { count: "exact", head: true })
    .eq("status", "delivered")
    .gte("shipped_at", shipped.toISOString());

  const { count: inTransit } = await supabase
    .from("shipments")
    .select("*", { count: "exact", head: true })
    .eq("status", "in_transit")
    .gte("shipped_at", shipped.toISOString());

  const { count: total } = await supabase
    .from("shipments")
    .select("*", { count: "exact", head: true })
    .gte("shipped_at", shipped.toISOString());

  console.log("=== FINAL STATUS (Nov 15+ shipments) ===");
  console.log("Delivered:", delivered);
  console.log("In Transit:", inTransit);
  console.log("Total:", total);
  console.log(
    "Delivery rate:",
    (((delivered || 0) / (total || 1)) * 100).toFixed(1) + "%"
  );
}
check();
