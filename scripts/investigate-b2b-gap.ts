import * as XLSX from "xlsx";
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

const workbook = XLSX.readFile("/Users/trevorfunderburk/Library/CloudStorage/OneDrive-SharedLibraries-SmitheyIronwareCompany,LLC/Smithey Ironware Team Site - Documents/Reporting/Unit Sales Model/Archive/Ron Test Models/S Ironware Data From Existing.xlsx");

function excelDateToUTC(serial: number): Date {
  return new Date((serial - 25569) * 86400 * 1000);
}

const decStart = new Date(Date.UTC(2025, 11, 1, 0, 0, 0));
const decEnd = new Date(Date.UTC(2025, 11, 9, 23, 59, 59));

async function investigateB2B() {
  console.log("=== B2B GAP INVESTIGATION ===\n");

  // Get B2B from Excel Coupler (by PO/order)
  const whslSheet = workbook.Sheets["Coupler Whsl Data Feed"];
  const whslData = XLSX.utils.sheet_to_json(whslSheet) as Array<{
    "Order: Order name": string;
    "Fulfillment: Fulfillment created at": number;
    "Fulfillment line item: Line item SKU": string;
    "Fulfillment line item: Line item quantity": number;
  }>;

  // Group Excel B2B by PO number for skil10
  const excelPOs = new Map<string, { qty: number; date: string }>();

  for (const row of whslData) {
    const dateSerial = row["Fulfillment: Fulfillment created at"];
    const sku = (row["Fulfillment line item: Line item SKU"] || "").toLowerCase();
    const qty = row["Fulfillment line item: Line item quantity"] || 0;
    const po = row["Order: Order name"];

    if (!dateSerial) continue;
    const date = excelDateToUTC(dateSerial);

    if (date >= decStart && date <= decEnd && sku === "smith-ci-skil10") {
      const existing = excelPOs.get(po) || { qty: 0, date: date.toISOString() };
      existing.qty += qty;
      excelPOs.set(po, existing);
    }
  }

  console.log(">>> Excel B2B skil10 POs (Dec 1-9):", excelPOs.size);
  let excelTotal = 0;
  for (const [po, data] of excelPOs) {
    excelTotal += data.qty;
  }
  console.log(">>> Excel B2B skil10 total:", excelTotal);

  // Get Supabase B2B skil10
  const { data: supabaseB2B } = await supabase
    .from("b2b_fulfilled")
    .select("*")
    .ilike("sku", "smith-ci-skil10")
    .gte("fulfilled_at", "2025-12-01T00:00:00.000Z")
    .lte("fulfilled_at", "2025-12-09T23:59:59.999Z");

  console.log("\n>>> Supabase B2B skil10 rows:", supabaseB2B?.length || 0);
  let supabaseTotal = 0;
  const supabasePOs = new Map<string, number>();
  for (const row of supabaseB2B || []) {
    supabaseTotal += row.quantity || 0;
    const po = row.po_number || row.order_name || "unknown";
    supabasePOs.set(po, (supabasePOs.get(po) || 0) + (row.quantity || 0));
  }
  console.log(">>> Supabase B2B skil10 total:", supabaseTotal);

  console.log("\n>>> Gap:", excelTotal - supabaseTotal);

  // Find POs in Excel but not in Supabase (or with different qty)
  console.log("\n>>> POs in Excel but missing/different in Supabase:");
  let missingQty = 0;

  for (const [po, data] of Array.from(excelPOs.entries()).sort((a, b) => b[1].qty - a[1].qty)) {
    const supabaseQty = supabasePOs.get(po) || 0;
    if (supabaseQty !== data.qty) {
      const diff = data.qty - supabaseQty;
      missingQty += diff;
      console.log(`   ${po}: Excel=${data.qty}, Supabase=${supabaseQty}, Diff=${diff > 0 ? "+" + diff : diff} (${data.date.split("T")[0]})`);
    }
  }

  console.log("\n>>> Total missing from these POs:", missingQty);

  // Check b2b_fulfilled table structure
  console.log("\n>>> Sample b2b_fulfilled row:");
  const { data: sample } = await supabase
    .from("b2b_fulfilled")
    .select("*")
    .limit(1);
  console.log(JSON.stringify(sample?.[0], null, 2));
}

investigateB2B().catch(console.error);
