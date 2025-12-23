import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function main() {
  // Check orders for each day
  const days = [
    "2025-11-27",
    "2025-11-28",
    "2025-11-29",
    "2025-11-30",
    "2025-12-01",
  ];

  console.log("Warehouse Split by Day (orders created):\n");

  for (const day of days) {
    const startDate = `${day}T00:00:00.000Z`;
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    const endDate = nextDay.toISOString().split("T")[0] + "T00:00:00.000Z";

    const { data, error } = await supabase
      .from("orders")
      .select("id, warehouse")
      .gte("created_at", startDate)
      .lt("created_at", endDate)
      .eq("canceled", false)
      .not("warehouse", "is", null);

    if (error) {
      console.error(`Error for ${day}:`, error);
      continue;
    }

    let smithey = 0,
      selery = 0;
    for (const order of data || []) {
      if (order.warehouse === "smithey") smithey++;
      else if (order.warehouse === "selery") selery++;
    }

    const total = smithey + selery;
    const smitheyPct = total > 0 ? Math.round((smithey / total) * 100) : 0;
    const seleryPct = total > 0 ? Math.round((selery / total) * 100) : 0;

    console.log(`${day}: Smithey ${smithey} (${smitheyPct}%) | Selery ${selery} (${seleryPct}%) | Total: ${total}`);
  }
}

main();
