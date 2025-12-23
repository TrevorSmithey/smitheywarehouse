import * as XLSX from "xlsx";
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

const workbook = XLSX.readFile("/Users/trevorfunderburk/Library/CloudStorage/OneDrive-SharedLibraries-SmitheyIronwareCompany,LLC/Smithey Ironware Team Site - Documents/Reporting/Unit Sales Model/Archive/Ron Test Models/S Ironware Data From Existing.xlsx");

const castIronSkus = [
  "smith-ci-skil8", "smith-ci-chef10", "smith-ci-flat10", "smith-ci-flat12",
  "smith-ci-skil6", "smith-ci-skil10", "smith-ci-skil12", "smith-ci-tradskil14",
  "smith-ci-skil14", "smith-ci-dskil11", "smith-ci-grill12", "smith-ci-dutch4",
  "smith-ci-dutch5", "smith-ci-dutch7", "smith-ci-dual6", "smith-ci-griddle18",
  "smith-ci-dual12", "smith-ci-sauce1"
];

function excelDateToUTC(serial: number): Date {
  return new Date((serial - 25569) * 86400 * 1000);
}

const decStart = new Date(Date.UTC(2025, 11, 1, 0, 0, 0));
const decEnd = new Date(Date.UTC(2025, 11, 9, 23, 59, 59));

async function compare() {
  // Get order names and cast iron from Excel
  const retailSheet = workbook.Sheets["Coupler Retail Data Feed"];
  const retailData = XLSX.utils.sheet_to_json(retailSheet) as Array<{
    "Order: Order name": string;
    "Order: Order created at": number;
    "Line items: SKU": string;
    "Line items: Quantity": number;
  }>;

  const excelOrders = new Map<string, { ci: number; date: Date }>();

  for (const row of retailData) {
    const dateSerial = row["Order: Order created at"];
    const orderName = row["Order: Order name"];
    const sku = (row["Line items: SKU"] || "").toLowerCase();
    const qty = row["Line items: Quantity"] || 0;

    if (!dateSerial || !orderName) continue;

    const date = excelDateToUTC(dateSerial);

    if (date >= decStart && date <= decEnd && castIronSkus.includes(sku)) {
      if (!excelOrders.has(orderName)) {
        excelOrders.set(orderName, { ci: 0, date });
      }
      excelOrders.get(orderName)!.ci += qty;
    }
  }

  console.log("=== EXCEL vs SUPABASE ORDER COMPARISON ===\n");
  console.log("Excel orders with cast iron (Dec 1-9):", excelOrders.size);

  // Check which orders are cancelled in Supabase
  const { data: cancelledOrders } = await supabase
    .from("orders")
    .select("order_name")
    .gte("created_at", "2025-12-01T00:00:00.000Z")
    .lte("created_at", "2025-12-09T23:59:59.999Z")
    .eq("canceled", true);

  const cancelledSet = new Set((cancelledOrders || []).map(o => o.order_name));
  console.log("Supabase cancelled orders (Dec 1-9):", cancelledSet.size);

  // Find orders in Excel that are cancelled in Supabase
  let cancelledCI = 0;
  const cancelledOrdersList: Array<{ name: string; ci: number }> = [];

  for (const [orderName, data] of excelOrders) {
    if (cancelledSet.has(orderName)) {
      cancelledCI += data.ci;
      cancelledOrdersList.push({ name: orderName, ci: data.ci });
    }
  }

  console.log("\n>>> Orders in Excel that are CANCELLED in Supabase:");
  console.log("   Count:", cancelledOrdersList.length);
  console.log("   Cast Iron units:", cancelledCI);

  if (cancelledOrdersList.length > 0) {
    console.log("\n   Sample cancelled orders:");
    for (const order of cancelledOrdersList.slice(0, 10)) {
      console.log(`     ${order.name}: ${order.ci} cast iron`);
    }
  }

  // Calculate what dashboard WOULD show if we include cancelled
  console.log("\n>>> Impact on totals:");
  console.log("   Dashboard without cancelled: ~14,946");
  console.log("   + Cancelled CI in Excel:", cancelledCI);
  console.log("   = Dashboard with cancelled:", 14946 + cancelledCI);
  console.log("   Excel total: 15,402");
  console.log("   Remaining gap:", 15402 - (14946 + cancelledCI));

  // Also check if there are orders in Excel that aren't in Supabase at all
  const { data: supabaseOrders } = await supabase
    .from("orders")
    .select("order_name")
    .gte("created_at", "2025-12-01T00:00:00.000Z")
    .lte("created_at", "2025-12-09T23:59:59.999Z");

  const supabaseSet = new Set((supabaseOrders || []).map(o => o.order_name));
  console.log("\nSupabase total orders (Dec 1-9):", supabaseSet.size);

  let missingCI = 0;
  const missingOrders: Array<{ name: string; ci: number }> = [];

  for (const [orderName, data] of excelOrders) {
    if (!supabaseSet.has(orderName)) {
      missingCI += data.ci;
      missingOrders.push({ name: orderName, ci: data.ci });
    }
  }

  console.log("\n>>> Orders in Excel but NOT in Supabase:");
  console.log("   Count:", missingOrders.length);
  console.log("   Cast Iron units:", missingCI);

  if (missingOrders.length > 0) {
    console.log("\n   Sample missing orders:");
    for (const order of missingOrders.slice(0, 10)) {
      console.log(`     ${order.name}: ${order.ci} cast iron`);
    }
  }
}

compare().catch(console.error);
