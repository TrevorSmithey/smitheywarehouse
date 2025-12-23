import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function investigate() {
  console.log("=== INVESTIGATING TODAY'S DATA ===\n");

  // What EST time is it now?
  const now = new Date();
  const estFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  console.log("Current UTC time:", now.toISOString());
  console.log("Current EST time:", estFormatter.format(now));

  // Dashboard uses end = current day at 28:59:59 (next day 4:59:59 UTC)
  const estParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const estYear = parseInt(estParts.find((p) => p.type === "year")?.value || "2025");
  const estMonth = parseInt(estParts.find((p) => p.type === "month")?.value || "1") - 1;
  const estDay = parseInt(estParts.find((p) => p.type === "day")?.value || "1");

  // The end date as calculated by dashboard
  const dashboardEndDate = new Date(
    Date.UTC(estYear, estMonth, estDay, 28, 59, 59)
  );
  console.log("\nDashboard would use end date:", dashboardEndDate.toISOString());
  console.log("(28:59:59 = next day 4:59:59 UTC)");

  // Start of today EST
  const todayStartEST = new Date(Date.UTC(estYear, estMonth, estDay, 5, 0, 0));
  console.log("\nToday (EST) start:", todayStartEST.toISOString());

  // Get cast iron orders from today
  const castIronSkus = [
    "smith-ci-skil8", "smith-ci-chef10", "smith-ci-flat10", "smith-ci-flat12",
    "smith-ci-skil6", "smith-ci-skil10", "smith-ci-skil12", "smith-ci-tradskil14",
    "smith-ci-skil14", "smith-ci-dskil11", "smith-ci-grill12", "smith-ci-dutch4",
    "smith-ci-dutch5", "smith-ci-dutch7", "smith-ci-dual6", "smith-ci-griddle18",
    "smith-ci-dual12", "smith-ci-sauce1"
  ];

  // Get ALL cast iron from Dec 1 to NOW
  const decStart = "2025-12-01T05:00:00.000Z";

  const { data: allItems } = await supabase
    .from("line_items")
    .select(`
      sku,
      quantity,
      orders!inner(created_at, canceled)
    `)
    .gte("orders.created_at", decStart)
    .eq("orders.canceled", false)
    .limit(1000000);

  let totalCastIronAllDec = 0;
  let todayCastIron = 0;

  for (const item of allItems || []) {
    if (!item.sku) continue;
    const lowerSku = item.sku.toLowerCase();
    if (castIronSkus.includes(lowerSku)) {
      totalCastIronAllDec += item.quantity || 0;

      // Check if it's from today
      const order = item.orders as { created_at: string };
      if (order && new Date(order.created_at) >= todayStartEST) {
        todayCastIron += item.quantity || 0;
      }
    }
  }

  console.log("\n>>> Cast Iron Retail:");
  console.log("  All December (to now):", totalCastIronAllDec);
  console.log("  Today (Dec 9):", todayCastIron);

  // Get B2B
  const { data: b2bAll } = await supabase
    .from("b2b_fulfilled")
    .select("sku, quantity")
    .gte("fulfilled_at", decStart)
    .limit(1000000);

  let b2bCastIronAll = 0;
  for (const item of b2bAll || []) {
    if (item.sku && castIronSkus.includes(item.sku.toLowerCase())) {
      b2bCastIronAll += item.quantity || 0;
    }
  }
  console.log("\n>>> Cast Iron B2B (all Dec):", b2bCastIronAll);

  console.log("\n>>> GRAND TOTAL Cast Iron (Retail + B2B):", totalCastIronAllDec + b2bCastIronAll);
  console.log(">>> User's Excel shows: 15,336");
  console.log(">>> Gap:", 15336 - (totalCastIronAllDec + b2bCastIronAll));
}

investigate().catch(console.error);
