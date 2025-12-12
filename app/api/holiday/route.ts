import { NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Validate env vars and create client (lazy initialization to avoid build-time errors)
function getSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase credentials (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY)");
  }

  return createClient(url, key);
}

export interface HolidayData {
  day_number: number;
  date_2024: string | null;
  orders_2024: number | null;
  sales_2024: number | null;
  cumulative_orders_2024: number | null;
  cumulative_sales_2024: number | null;
  date_2025: string | null;
  orders_2025: number | null;
  sales_2025: number | null;
  cumulative_orders_2025: number | null;
  cumulative_sales_2025: number | null;
  daily_orders_delta: number | null;
  daily_sales_delta: number | null;
  cumulative_orders_delta: number | null;
  cumulative_sales_delta: number | null;
  synced_at?: string;
}

export interface HolidayResponse {
  data: HolidayData[];
  summary: {
    totalOrders2025: number;
    totalRevenue2025: number;
    totalOrders2024: number;
    totalRevenue2024: number;
    ordersGrowth: number;
    revenueGrowth: number;
    daysWithData: number;
    latestDate: string | null;
    avgDailyOrders2025: number;
    avgDailyRevenue2025: number;
    avgOrderValue2025: number;
    avgOrderValue2024: number;
  };
  lastSynced: string | null;
}

export async function GET() {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("holiday_tracking")
      .select("*")
      .order("day_number", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch holiday data: ${error.message}`);
    }

    const rows = (data || []) as HolidayData[];

    // Calculate summary stats
    const rowsWithData = rows.filter((r) => r.orders_2025 !== null);
    const latestRow = rowsWithData[rowsWithData.length - 1];

    const summary = {
      totalOrders2025: latestRow?.cumulative_orders_2025 || 0,
      totalRevenue2025: latestRow?.cumulative_sales_2025 || 0,
      totalOrders2024: latestRow?.cumulative_orders_2024 || 0,
      totalRevenue2024: latestRow?.cumulative_sales_2024 || 0,
      ordersGrowth: latestRow?.cumulative_orders_delta
        ? latestRow.cumulative_orders_delta * 100
        : 0,
      revenueGrowth: latestRow?.cumulative_sales_delta
        ? latestRow.cumulative_sales_delta * 100
        : 0,
      daysWithData: rowsWithData.length,
      latestDate: latestRow?.date_2025 || null,
      avgDailyOrders2025: rowsWithData.length > 0
        ? Math.round((latestRow?.cumulative_orders_2025 || 0) / rowsWithData.length)
        : 0,
      avgDailyRevenue2025: rowsWithData.length > 0
        ? (latestRow?.cumulative_sales_2025 || 0) / rowsWithData.length
        : 0,
      avgOrderValue2025:
        latestRow?.cumulative_orders_2025 && latestRow.cumulative_sales_2025
          ? latestRow.cumulative_sales_2025 / latestRow.cumulative_orders_2025
          : 0,
      avgOrderValue2024:
        latestRow?.cumulative_orders_2024 && latestRow.cumulative_sales_2024
          ? latestRow.cumulative_sales_2024 / latestRow.cumulative_orders_2024
          : 0,
    };

    // Get sync time from first row
    const lastSynced = rows[0]?.synced_at || null;

    const response: HolidayResponse = {
      data: rows,
      summary,
      lastSynced,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching holiday data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch holiday data" },
      { status: 500 }
    );
  }
}
