import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { MetricsResponse, WarehouseMetrics, DailyFulfillment } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const supabase = await createClient();
    const today = new Date().toISOString().split("T")[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    // Get warehouse metrics in parallel
    const [unfulfilledResult, partialResult, fulfilledTodayResult, dailyResult] =
      await Promise.all([
        // Unfulfilled count by warehouse
        supabase
          .from("orders")
          .select("warehouse")
          .is("fulfillment_status", null)
          .eq("canceled", false)
          .not("warehouse", "is", null),

        // Partial count by warehouse
        supabase
          .from("orders")
          .select("warehouse")
          .eq("fulfillment_status", "partial")
          .eq("canceled", false)
          .not("warehouse", "is", null),

        // Fulfilled today by warehouse
        supabase
          .from("orders")
          .select("warehouse, fulfilled_at")
          .gte("fulfilled_at", `${today}T00:00:00`)
          .eq("canceled", false)
          .not("warehouse", "is", null),

        // Daily fulfillments for last 30 days
        supabase
          .from("orders")
          .select("warehouse, fulfilled_at")
          .gte("fulfilled_at", `${thirtyDaysAgo}T00:00:00`)
          .eq("canceled", false)
          .not("warehouse", "is", null)
          .not("fulfilled_at", "is", null),
      ]);

    // Process unfulfilled counts
    const unfulfilledByWarehouse = countByWarehouse(unfulfilledResult.data || []);

    // Process partial counts
    const partialByWarehouse = countByWarehouse(partialResult.data || []);

    // Process fulfilled today
    const fulfilledTodayByWarehouse = countByWarehouse(fulfilledTodayResult.data || []);

    // Build warehouse metrics
    const warehouses: WarehouseMetrics[] = ["smithey", "selery"].map((wh) => ({
      warehouse: wh,
      unfulfilled_count: unfulfilledByWarehouse[wh] || 0,
      partial_count: partialByWarehouse[wh] || 0,
      fulfilled_today: fulfilledTodayByWarehouse[wh] || 0,
    }));

    // Process daily fulfillments
    const daily = processDailyFulfillments(dailyResult.data || []);

    const response: MetricsResponse = {
      warehouses,
      daily,
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}

function countByWarehouse(
  data: Array<{ warehouse: string | null }>
): Record<string, number> {
  return data.reduce((acc, row) => {
    if (row.warehouse) {
      acc[row.warehouse] = (acc[row.warehouse] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);
}

function processDailyFulfillments(
  data: Array<{ warehouse: string | null; fulfilled_at: string | null }>
): DailyFulfillment[] {
  // Group by date and warehouse
  const grouped = new Map<string, number>();

  for (const row of data) {
    if (!row.warehouse || !row.fulfilled_at) continue;

    const date = row.fulfilled_at.split("T")[0];
    const key = `${date}|${row.warehouse}`;
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }

  // Convert to array and sort
  const result: DailyFulfillment[] = [];
  for (const [key, count] of grouped) {
    const [date, warehouse] = key.split("|");
    result.push({ date, warehouse, count });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}
