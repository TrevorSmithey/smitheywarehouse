/**
 * Revenue Tracker API
 *
 * Supports two modes:
 * 1. Calendar Year: ?year=2025 (full-year comparison)
 * 2. Trailing Period: ?trailing=30 (last N days comparison)
 *
 * Supports channel filtering:
 * - ?channel=total (default) - D2C + B2B combined
 * - ?channel=retail - D2C only (Shopify)
 * - ?channel=b2b - B2B only (NetSuite/wholesale)
 *
 * Returns up to 366 days of data + quarter summaries + period totals
 * Handles leap years correctly and calculates quarters from actual dates.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";
import type {
  DaySalesData,
  QuarterSummary,
  YTDSummary,
  RevenueTrackerResponse,
  RevenueTrackerChannel,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Quarter metadata (labels only - boundaries calculated from dates)
const QUARTER_META = {
  1: { label: "Q1", months: "Jan-Mar" },
  2: { label: "Q2", months: "Apr-Jun" },
  3: { label: "Q3", months: "Jul-Sep" },
  4: { label: "Q4", months: "Oct-Dec" },
} as const;

// Valid trailing periods
const VALID_TRAILING_PERIODS = [7, 30, 90, 365] as const;
type TrailingPeriod = typeof VALID_TRAILING_PERIODS[number];

// Valid channel filters (runtime validation array)
const VALID_CHANNELS: readonly RevenueTrackerChannel[] = ["total", "retail", "b2b"];

/**
 * Map channel filter to database channel value(s)
 * - "total" = both d2c and b2b
 * - "retail" = d2c only
 * - "b2b" = b2b only
 */
function getChannelDbValues(channel: RevenueTrackerChannel): string[] {
  switch (channel) {
    case "retail":
      return ["d2c"];
    case "b2b":
      return ["b2b"];
    case "total":
    default:
      return ["d2c", "b2b"];
  }
}

/**
 * Check if a year is a leap year
 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Get total days in a year (365 or 366)
 */
function getDaysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/**
 * Get quarter (1-4) from a date string (YYYY-MM-DD)
 */
function getQuarterFromDate(dateStr: string): number {
  const month = parseInt(dateStr.split("-")[1], 10);
  return Math.ceil(month / 3);
}

// Re-export types for backwards compatibility with existing imports
export type { DaySalesData, QuarterSummary, YTDSummary, RevenueTrackerResponse } from "@/lib/types";

/**
 * Get current day of year (1-365/366)
 */
function getCurrentDayOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * Get current quarter (1-4)
 */
function getCurrentQuarter(): number {
  const month = new Date().getMonth();
  if (month <= 2) return 1;
  if (month <= 5) return 2;
  if (month <= 8) return 3;
  return 4;
}

/**
 * Calculate percentage growth (handles null/zero cases)
 */
function calcGrowth(current: number, comparison: number): number | null {
  if (comparison === 0) return current > 0 ? 100 : null;
  return ((current - comparison) / comparison) * 100;
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Get day of year from date
 */
function getDayOfYearFromDate(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * Handle trailing period mode (T7, T30, T90, T365)
 */
async function handleTrailingPeriod(
  supabase: ReturnType<typeof createServiceClient>,
  trailingDays: TrailingPeriod,
  channel: RevenueTrackerChannel = "total"
): Promise<RevenueTrackerResponse> {
  const today = new Date();
  const thisYear = today.getFullYear();
  const channelValues = getChannelDbValues(channel);

  // Calculate date ranges
  // Current period: last N days ending today
  const currentEnd = new Date(today);
  const currentStart = new Date(today);
  currentStart.setDate(currentStart.getDate() - trailingDays + 1);

  // Comparison period: same dates one year ago
  // Note: JavaScript auto-adjusts invalid dates (e.g., Feb 29 → Mar 1 in non-leap years)
  // This is intentional for YoY comparison - we compare same calendar days where they exist
  const comparisonEnd = new Date(currentEnd);
  comparisonEnd.setFullYear(comparisonEnd.getFullYear() - 1);
  const comparisonStart = new Date(currentStart);
  comparisonStart.setFullYear(comparisonStart.getFullYear() - 1);

  // Fetch data for both periods using date ranges, filtered by channel
  const { data: rawData, error } = await supabase
    .from("annual_sales_tracking")
    .select("year, day_of_year, date, quarter, orders, revenue, channel, synced_at")
    .in("channel", channelValues)
    .or(
      `and(date.gte.${formatDate(currentStart)},date.lte.${formatDate(currentEnd)}),` +
      `and(date.gte.${formatDate(comparisonStart)},date.lte.${formatDate(comparisonEnd)})`
    )
    .order("date", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch trailing sales data: ${error.message}`);
  }

  // Index and aggregate data by date (may have multiple channels per date for "total" view)
  const dataByDate: Record<string, { orders: number; revenue: number; date: string; year: number }> = {};
  let lastSynced: string | null = null;

  for (const row of rawData || []) {
    const existing = dataByDate[row.date];
    if (existing) {
      // Aggregate multiple channels for the same date
      existing.orders += row.orders || 0;
      existing.revenue += parseFloat(row.revenue) || 0;
    } else {
      dataByDate[row.date] = {
        orders: row.orders || 0,
        revenue: parseFloat(row.revenue) || 0,
        date: row.date,
        year: row.year,
      };
    }
    if (row.synced_at && (!lastSynced || row.synced_at > lastSynced)) {
      lastSynced = row.synced_at;
    }
  }

  // Build daily data array
  const dailyData: DaySalesData[] = [];
  let cumOrdersCurrent = 0;
  let cumRevenuesCurrent = 0;
  let cumOrdersComparison = 0;
  let cumRevenuesComparison = 0;

  // Iterate through each day in the trailing period
  for (let i = 0; i < trailingDays; i++) {
    const currentDate = new Date(currentStart);
    currentDate.setDate(currentStart.getDate() + i);
    const comparisonDate = new Date(currentDate);
    comparisonDate.setFullYear(comparisonDate.getFullYear() - 1);

    const currentDateStr = formatDate(currentDate);
    const comparisonDateStr = formatDate(comparisonDate);

    const currentData = dataByDate[currentDateStr];
    const comparisonData = dataByDate[comparisonDateStr];

    const ordersCurrent = currentData?.orders || 0;
    const revenueCurrent = currentData?.revenue || 0;
    const ordersComparison = comparisonData?.orders || 0;
    const revenueComparison = comparisonData?.revenue || 0;

    cumOrdersCurrent += ordersCurrent;
    cumRevenuesCurrent += revenueCurrent;
    cumOrdersComparison += ordersComparison;
    cumRevenuesComparison += revenueComparison;

    const dayOfYear = getDayOfYearFromDate(currentDate);
    const quarter = getQuarterFromDate(currentDateStr);

    dailyData.push({
      dayOfYear,
      date: currentDateStr,
      quarter,
      ordersCurrent,
      ordersComparison,
      revenueCurrent,
      revenueComparison,
      cumulativeOrdersCurrent: cumOrdersCurrent,
      cumulativeOrdersComparison: cumOrdersComparison,
      cumulativeRevenueCurrent: cumRevenuesCurrent,
      cumulativeRevenueComparison: cumRevenuesComparison,
    });
  }

  // Build quarter summaries (for trailing periods, group by quarter in the data)
  const currentQuarter = getCurrentQuarter();
  const quarterSummaries: QuarterSummary[] = [];

  for (let q = 1; q <= 4; q++) {
    const qMeta = QUARTER_META[q as 1 | 2 | 3 | 4];
    const qData = dailyData.filter((d) => d.quarter === q);

    let ordersCurrent = 0;
    let ordersComparison = 0;
    let revenueCurrent = 0;
    let revenueComparison = 0;
    let daysComplete = 0;

    for (const day of qData) {
      ordersCurrent += day.ordersCurrent;
      ordersComparison += day.ordersComparison;
      revenueCurrent += day.revenueCurrent;
      revenueComparison += day.revenueComparison;
      if (day.ordersCurrent > 0 || day.revenueCurrent > 0) {
        daysComplete++;
      }
    }

    quarterSummaries.push({
      quarter: q,
      label: `${qMeta.label} (T${trailingDays})`,
      months: qMeta.months,
      ordersCurrent,
      ordersComparison,
      ordersGrowth: calcGrowth(ordersCurrent, ordersComparison),
      revenueCurrent,
      revenueComparison,
      revenueGrowth: calcGrowth(revenueCurrent, revenueComparison),
      daysComplete,
      daysTotal: qData.length,
      isComplete: qData.length > 0,
      isCurrent: q === currentQuarter && qData.length > 0,
    });
  }

  // Build period summary
  const daysComplete = dailyData.filter((d) => d.ordersCurrent > 0 || d.revenueCurrent > 0).length;
  const totalOrdersCurrent = dailyData.reduce((sum, d) => sum + d.ordersCurrent, 0);
  const totalRevenueCurrent = dailyData.reduce((sum, d) => sum + d.revenueCurrent, 0);
  const totalOrdersComparison = dailyData.reduce((sum, d) => sum + d.ordersComparison, 0);
  const totalRevenueComparison = dailyData.reduce((sum, d) => sum + d.revenueComparison, 0);

  const ytdSummary: YTDSummary = {
    ordersCurrent: totalOrdersCurrent,
    ordersComparison: totalOrdersComparison,
    ordersGrowth: calcGrowth(totalOrdersCurrent, totalOrdersComparison),
    revenueCurrent: totalRevenueCurrent,
    revenueComparison: totalRevenueComparison,
    revenueGrowth: calcGrowth(totalRevenueCurrent, totalRevenueComparison),
    daysComplete,
    avgDailyOrders: daysComplete > 0 ? Math.round(totalOrdersCurrent / daysComplete) : 0,
    avgDailyRevenue: daysComplete > 0 ? Math.round(totalRevenueCurrent / daysComplete) : 0,
    avgOrderValue: totalOrdersCurrent > 0 ? Math.round(totalRevenueCurrent / totalOrdersCurrent) : 0,
  };

  return {
    currentYear: thisYear,
    comparisonYear: thisYear - 1,
    dailyData,
    quarterSummaries,
    ytdSummary,
    lastSynced,
  };
}

/**
 * Handle calendar year mode
 */
async function handleCalendarYear(
  supabase: ReturnType<typeof createServiceClient>,
  currentYear: number,
  channel: RevenueTrackerChannel = "total"
): Promise<RevenueTrackerResponse> {
  const thisYear = new Date().getFullYear();
  const comparisonYear = currentYear - 1;
  const channelValues = getChannelDbValues(channel);

  // Fetch data for both years, filtered by channel
  const { data: rawData, error } = await supabase
    .from("annual_sales_tracking")
    .select("year, day_of_year, date, quarter, orders, revenue, channel, synced_at")
    .in("year", [currentYear, comparisonYear])
    .in("channel", channelValues)
    .order("day_of_year", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch annual sales data: ${error.message}`);
  }

  // Index and aggregate data by year and day (may have multiple channels per day for "total" view)
  const dataByYearDay: Record<number, Record<number, { orders: number; revenue: number; date: string }>> = {
    [currentYear]: {},
    [comparisonYear]: {},
  };

  let lastSynced: string | null = null;

  for (const row of rawData || []) {
    const existing = dataByYearDay[row.year]?.[row.day_of_year];
    if (existing) {
      // Aggregate multiple channels for the same day
      existing.orders += row.orders || 0;
      existing.revenue += parseFloat(row.revenue) || 0;
    } else {
      dataByYearDay[row.year][row.day_of_year] = {
        orders: row.orders || 0,
        revenue: parseFloat(row.revenue) || 0,
        date: row.date,
      };
    }
    if (row.synced_at && (!lastSynced || row.synced_at > lastSynced)) {
      lastSynced = row.synced_at;
    }
  }

  // Build daily data array with cumulative totals
  const daysInCurrentYear = getDaysInYear(currentYear);
  const daysInComparisonYear = getDaysInYear(comparisonYear);
  const maxDaysTotal = Math.max(daysInCurrentYear, daysInComparisonYear);

  const dailyData: DaySalesData[] = [];
  let cumOrdersCurrent = 0;
  let cumRevenuesCurrent = 0;
  let cumOrdersComparison = 0;
  let cumRevenuesComparison = 0;

  // For YTD: only accumulate up to current day if viewing current year
  const currentDayOfYear = getCurrentDayOfYear();
  const isViewingCurrentYear = currentYear === thisYear;
  const ytdCutoffDay = isViewingCurrentYear ? currentDayOfYear : daysInCurrentYear;

  for (let day = 1; day <= maxDaysTotal; day++) {
    const currentData = dataByYearDay[currentYear][day];
    const comparisonData = dataByYearDay[comparisonYear][day];

    const ordersCurrent = currentData?.orders || 0;
    const revenueCurrent = currentData?.revenue || 0;
    const ordersComparison = comparisonData?.orders || 0;
    const revenueComparison = comparisonData?.revenue || 0;

    // Accumulate current year up to YTD cutoff
    if (day <= ytdCutoffDay) {
      cumOrdersCurrent += ordersCurrent;
      cumRevenuesCurrent += revenueCurrent;
    }

    // For comparison year: ONLY accumulate up to same day for fair YTD comparison
    if (day <= ytdCutoffDay) {
      cumOrdersComparison += ordersComparison;
      cumRevenuesComparison += revenueComparison;
    }

    // Determine quarter from actual date (not hardcoded day boundaries)
    const dateStr = currentData?.date || comparisonData?.date || "";
    const quarter = dateStr ? getQuarterFromDate(dateStr) : Math.ceil(day / 91.25);

    dailyData.push({
      dayOfYear: day,
      date: dateStr,
      quarter,
      ordersCurrent,
      ordersComparison,
      revenueCurrent,
      revenueComparison,
      cumulativeOrdersCurrent: cumOrdersCurrent,
      cumulativeOrdersComparison: cumOrdersComparison,
      cumulativeRevenueCurrent: cumRevenuesCurrent,
      cumulativeRevenueComparison: cumRevenuesComparison,
    });
  }

  // Build quarter summaries using actual quarter assignments from dates
  const currentQuarter = getCurrentQuarter();
  const quarterSummaries: QuarterSummary[] = [];

  for (let q = 1; q <= 4; q++) {
    const qMeta = QUARTER_META[q as 1 | 2 | 3 | 4];
    const qData = dailyData.filter((d) => d.quarter === q);

    let ordersCurrent = 0;
    let ordersComparison = 0;
    let revenueCurrent = 0;
    let revenueComparison = 0;
    let daysComplete = 0;

    for (const day of qData) {
      const isWithinYTD = day.dayOfYear <= ytdCutoffDay;

      ordersCurrent += day.ordersCurrent;
      revenueCurrent += day.revenueCurrent;

      // Only count comparison data for days within YTD (fair comparison)
      if (isWithinYTD) {
        ordersComparison += day.ordersComparison;
        revenueComparison += day.revenueComparison;
      }

      if (day.ordersCurrent > 0 || day.revenueCurrent > 0) {
        daysComplete++;
      }
    }

    const isComplete = currentYear < thisYear || q < currentQuarter;
    const isCurrent = currentYear === thisYear && q === currentQuarter;

    quarterSummaries.push({
      quarter: q,
      label: `${qMeta.label} ${currentYear}`,
      months: qMeta.months,
      ordersCurrent,
      ordersComparison,
      ordersGrowth: calcGrowth(ordersCurrent, ordersComparison),
      revenueCurrent,
      revenueComparison,
      revenueGrowth: calcGrowth(revenueCurrent, revenueComparison),
      daysComplete,
      daysTotal: qData.length,
      isComplete,
      isCurrent,
    });
  }

  // Build YTD summary
  const ytdData = dailyData.filter((d) => d.dayOfYear <= ytdCutoffDay);
  const daysComplete = ytdData.filter((d) => d.ordersCurrent > 0 || d.revenueCurrent > 0).length;
  const totalOrdersCurrent = ytdData.reduce((sum, d) => sum + d.ordersCurrent, 0);
  const totalRevenueCurrent = ytdData.reduce((sum, d) => sum + d.revenueCurrent, 0);
  const totalOrdersComparison = ytdData.reduce((sum, d) => sum + d.ordersComparison, 0);
  const totalRevenueComparison = ytdData.reduce((sum, d) => sum + d.revenueComparison, 0);

  const ytdSummary: YTDSummary = {
    ordersCurrent: totalOrdersCurrent,
    ordersComparison: totalOrdersComparison,
    ordersGrowth: calcGrowth(totalOrdersCurrent, totalOrdersComparison),
    revenueCurrent: totalRevenueCurrent,
    revenueComparison: totalRevenueComparison,
    revenueGrowth: calcGrowth(totalRevenueCurrent, totalRevenueComparison),
    daysComplete,
    avgDailyOrders: daysComplete > 0 ? Math.round(totalOrdersCurrent / daysComplete) : 0,
    avgDailyRevenue: daysComplete > 0 ? Math.round(totalRevenueCurrent / daysComplete) : 0,
    avgOrderValue: totalOrdersCurrent > 0 ? Math.round(totalRevenueCurrent / totalOrdersCurrent) : 0,
  };

  return {
    currentYear,
    comparisonYear,
    dailyData,
    quarterSummaries,
    ytdSummary,
    lastSynced,
  };
}

export async function GET(request: Request) {
  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`revenue-tracker:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const { searchParams } = new URL(request.url);
    const supabase = createServiceClient();

    // Parse channel filter (default: total)
    const channelParam = searchParams.get("channel") || "total";
    if (!VALID_CHANNELS.includes(channelParam as RevenueTrackerChannel)) {
      return NextResponse.json(
        { error: `Invalid channel. Must be one of: ${VALID_CHANNELS.join(", ")}` },
        { status: 400 }
      );
    }
    const channel = channelParam as RevenueTrackerChannel;

    // Check for trailing period mode
    const trailingParam = searchParams.get("trailing");
    if (trailingParam) {
      const trailingDays = parseInt(trailingParam, 10) as TrailingPeriod;
      if (!VALID_TRAILING_PERIODS.includes(trailingDays)) {
        return NextResponse.json(
          { error: `Invalid trailing period. Must be one of: ${VALID_TRAILING_PERIODS.join(", ")}` },
          { status: 400 }
        );
      }

      const response = await handleTrailingPeriod(supabase, trailingDays, channel);
      return NextResponse.json(response, {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      });
    }

    // Calendar year mode
    const thisYear = new Date().getFullYear();
    const requestedYear = parseInt(searchParams.get("year") || "", 10);
    const currentYear = (requestedYear >= 2023 && requestedYear <= thisYear)
      ? requestedYear
      : thisYear;

    const response = await handleCalendarYear(supabase, currentYear, channel);

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("Error fetching revenue tracker data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch revenue data" },
      { status: 500 }
    );
  }
}
