import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  dataSource: "live" | "cached";
}

/**
 * Convert a date string (YYYY-MM-DD) to day number in Q4
 * Day 1 = Oct 1, Day 92 = Dec 31
 */
function dateToDayNumber(dateStr: string): number | null {
  const date = new Date(dateStr + "T00:00:00");
  const month = date.getMonth(); // 0-indexed: Oct=9, Nov=10, Dec=11
  const day = date.getDate();

  if (month === 9) return day; // Oct: day 1-31
  if (month === 10) return 31 + day; // Nov: day 32-61
  if (month === 11) return 61 + day; // Dec: day 62-92
  return null; // Not in Q4
}

/**
 * Convert day number to 2025 date string (YYYY-MM-DD)
 */
function dayNumberToDate2025(dayNumber: number): string {
  if (dayNumber <= 31) {
    return `2025-10-${String(dayNumber).padStart(2, "0")}`;
  } else if (dayNumber <= 61) {
    return `2025-11-${String(dayNumber - 31).padStart(2, "0")}`;
  } else {
    return `2025-12-${String(dayNumber - 61).padStart(2, "0")}`;
  }
}

export async function GET(request: Request) {
  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`holiday:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const supabase = createServiceClient();

    // Fetch 2024 baseline data from holiday_tracking
    const { data: baselineData, error: baselineError } = await supabase
      .from("holiday_tracking")
      .select("day_number, date_2024, orders_2024, sales_2024, cumulative_orders_2024, cumulative_sales_2024")
      .order("day_number", { ascending: true });

    if (baselineError) {
      throw new Error(`Failed to fetch baseline data: ${baselineError.message}`);
    }

    // Fetch live 2025 data from daily_stats (Oct 1 - Dec 31, 2025)
    const { data: liveData, error: liveError } = await supabase
      .from("daily_stats")
      .select("date, total_orders, total_revenue, updated_at")
      .gte("date", "2025-10-01")
      .lte("date", "2025-12-31")
      .order("date", { ascending: true });

    if (liveError) {
      throw new Error(`Failed to fetch live Shopify data: ${liveError.message}`);
    }

    // Create a map of day_number -> live 2025 data
    const liveDataByDay = new Map<number, { orders: number; revenue: number; date: string; updated_at: string }>();
    for (const row of liveData || []) {
      const dayNum = dateToDayNumber(row.date);
      if (dayNum) {
        liveDataByDay.set(dayNum, {
          orders: row.total_orders,
          revenue: parseFloat(row.total_revenue) || 0,
          date: row.date,
          updated_at: row.updated_at,
        });
      }
    }

    // Merge baseline with live data and calculate cumulative values
    let cumOrders2025 = 0;
    let cumSales2025 = 0;
    let latestSyncedAt: string | null = null;

    const rows: HolidayData[] = (baselineData || []).map((baseline) => {
      const dayNum = baseline.day_number;
      const live = liveDataByDay.get(dayNum);

      // Get 2025 daily values from live Shopify data
      const orders2025 = live?.orders ?? null;
      const sales2025 = live?.revenue ?? null;

      // Update cumulative totals
      if (orders2025 !== null) {
        cumOrders2025 += orders2025;
      }
      if (sales2025 !== null) {
        cumSales2025 += sales2025;
      }

      // Track latest sync time
      if (live?.updated_at) {
        if (!latestSyncedAt || live.updated_at > latestSyncedAt) {
          latestSyncedAt = live.updated_at;
        }
      }

      // Calculate deltas (% change from 2024)
      const dailyOrdersDelta =
        orders2025 !== null && baseline.orders_2024
          ? (orders2025 - baseline.orders_2024) / baseline.orders_2024
          : null;
      const dailySalesDelta =
        sales2025 !== null && baseline.sales_2024
          ? (sales2025 - baseline.sales_2024) / parseFloat(baseline.sales_2024)
          : null;
      const cumOrdersDelta =
        cumOrders2025 > 0 && baseline.cumulative_orders_2024
          ? (cumOrders2025 - baseline.cumulative_orders_2024) / baseline.cumulative_orders_2024
          : null;
      const cumSalesDelta =
        cumSales2025 > 0 && baseline.cumulative_sales_2024
          ? (cumSales2025 - parseFloat(baseline.cumulative_sales_2024)) / parseFloat(baseline.cumulative_sales_2024)
          : null;

      return {
        day_number: dayNum,
        date_2024: baseline.date_2024,
        orders_2024: baseline.orders_2024,
        sales_2024: baseline.sales_2024 ? parseFloat(baseline.sales_2024) : null,
        cumulative_orders_2024: baseline.cumulative_orders_2024,
        cumulative_sales_2024: baseline.cumulative_sales_2024 ? parseFloat(baseline.cumulative_sales_2024) : null,
        date_2025: live?.date || dayNumberToDate2025(dayNum),
        orders_2025: orders2025,
        sales_2025: sales2025,
        cumulative_orders_2025: orders2025 !== null ? cumOrders2025 : null,
        cumulative_sales_2025: sales2025 !== null ? cumSales2025 : null,
        daily_orders_delta: dailyOrdersDelta,
        daily_sales_delta: dailySalesDelta,
        cumulative_orders_delta: cumOrdersDelta,
        cumulative_sales_delta: cumSalesDelta,
        synced_at: live?.updated_at || undefined,
      };
    });

    // Calculate summary stats from the merged data
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

    const response: HolidayResponse = {
      data: rows,
      summary,
      lastSynced: latestSyncedAt,
      dataSource: "live",
    };

    // Live Shopify data, cache for 5 minutes
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("Error fetching holiday data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch holiday data" },
      { status: 500 }
    );
  }
}
