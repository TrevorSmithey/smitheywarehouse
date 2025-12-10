import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Excel file location on Mac - adjust if needed for Vercel deployment
const EXCEL_PATH = "/Users/trevorfunderburk/Library/CloudStorage/OneDrive-SharedLibraries-SmitheyIronware/Smithey Shared Drive - Finance/2025 Forecasts/Q4 Holiday Tracking/Holiday Tracking_Looker Source.xlsx";

interface ExcelRow {
  "Day Number": number;
  "Date 2024"?: string | number;
  "Orders 2024"?: number;
  "Sales 2024"?: number;
  "Cumulative Orders 2024"?: number;
  "Cumulative Sales 2024"?: number;
  "Date 2025"?: string | number;
  "Orders 2025"?: number;
  "Sales 2025"?: number;
  "Cumulative Orders 2025"?: number;
  "Cumulative Sales 2025"?: number;
  "Daily Orders Delta"?: number;
  "Daily Sales Delta"?: number;
  "Cumulative Orders Delta"?: number;
  "Cumulative Sales Delta"?: number;
}

function parseExcelDate(value: string | number | undefined): string | null {
  if (!value) return null;
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  return value.toString();
}

export async function GET(request: Request) {
  const startTime = Date.now();

  // Verify cron secret for Vercel cron jobs
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Check if file exists (won't work on Vercel - this is for local dev)
    if (!fs.existsSync(EXCEL_PATH)) {
      return NextResponse.json({
        error: "Excel file not found - this cron only works locally",
        path: EXCEL_PATH
      }, { status: 404 });
    }

    // Read Excel file
    const workbook = XLSX.readFile(EXCEL_PATH);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json<ExcelRow>(worksheet);

    // Transform data for Supabase
    const records = jsonData
      .filter((row) => row["Day Number"] !== undefined)
      .map((row) => ({
        day_number: row["Day Number"],
        date_2024: parseExcelDate(row["Date 2024"]),
        orders_2024: row["Orders 2024"] ?? null,
        sales_2024: row["Sales 2024"] ?? null,
        cumulative_orders_2024: row["Cumulative Orders 2024"] ?? null,
        cumulative_sales_2024: row["Cumulative Sales 2024"] ?? null,
        date_2025: parseExcelDate(row["Date 2025"]),
        orders_2025: row["Orders 2025"] ?? null,
        sales_2025: row["Sales 2025"] ?? null,
        cumulative_orders_2025: row["Cumulative Orders 2025"] ?? null,
        cumulative_sales_2025: row["Cumulative Sales 2025"] ?? null,
        daily_orders_delta: row["Daily Orders Delta"] ?? null,
        daily_sales_delta: row["Daily Sales Delta"] ?? null,
        cumulative_orders_delta: row["Cumulative Orders Delta"] ?? null,
        cumulative_sales_delta: row["Cumulative Sales Delta"] ?? null,
        synced_at: new Date().toISOString(),
      }));

    // Upsert to Supabase
    const { error } = await supabase
      .from("holiday_tracking")
      .upsert(records, { onConflict: "day_number" });

    if (error) {
      throw new Error(`Supabase upsert failed: ${error.message}`);
    }

    // Count rows with 2025 data
    const rowsWith2025 = records.filter((r) => r.orders_2025 !== null).length;

    // Log successful sync for health tracking
    const elapsed = Date.now() - startTime;
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "holiday",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "success",
        records_expected: jsonData.length,
        records_synced: records.length,
        details: { rowsWith2025Data: rowsWith2025 },
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("Failed to log holiday sync health:", logError);
    }

    return NextResponse.json({
      success: true,
      totalRows: records.length,
      rowsWith2025Data: rowsWith2025,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Holiday sync error:", error);

    // Log failed sync for health tracking
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Sync failed";
    try {
      await supabase.from("sync_logs").insert({
        sync_type: "holiday",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 0,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("Failed to log holiday sync failure:", logError);
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
