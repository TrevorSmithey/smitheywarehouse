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
import {
  getCurrentDayOfYearEST,
  getLastCompletedDayOfYearEST,
  getCurrentQuarterEST,
  getCurrentYearEST,
  getDaysInYear,
  isLeapYearNumber,
  getQuarterFromDate,
  getCorrespondingDate,
  getDayOfYearFromDate,
  getDateFromDayOfYear,
  getTodayEST,
} from "@/lib/date-utils";
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

// Re-export types for backwards compatibility with existing imports
export type { DaySalesData, QuarterSummary, YTDSummary, RevenueTrackerResponse } from "@/lib/types";

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
 * Handle trailing period mode (T7, T30, T90, T365)
 * Uses EST timezone for "today" to match Smithey operations.
 */
async function handleTrailingPeriod(
  supabase: ReturnType<typeof createServiceClient>,
  trailingDays: TrailingPeriod,
  channel: RevenueTrackerChannel = "total"
): Promise<RevenueTrackerResponse> {
  // Use EST timezone for determining "today" to match Smithey operations
  const todayStr = getTodayEST();
  const [yearStr, monthStr, dayStr] = todayStr.split("-");
  const today = new Date(parseInt(yearStr), parseInt(monthStr) - 1, parseInt(dayStr));
  const thisYear = parseInt(yearStr);
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

    const dayOfYear = getDayOfYearFromDate(currentDateStr);
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
  const currentQuarter = getCurrentQuarterEST();
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
 *
 * IMPORTANT: Uses calendar date alignment (not day-of-year) for YoY comparisons.
 * This ensures March 1, 2025 compares to March 1, 2024 - not Feb 29, 2024.
 * Feb 29 in leap years maps to Feb 28 in non-leap years.
 */
async function handleCalendarYear(
  supabase: ReturnType<typeof createServiceClient>,
  currentYear: number,
  channel: RevenueTrackerChannel = "total"
): Promise<RevenueTrackerResponse> {
  const thisYear = getCurrentYearEST();
  const comparisonYear = currentYear - 1;
  const channelValues = getChannelDbValues(channel);

  // Fetch data for both years, filtered by channel
  const { data: rawData, error } = await supabase
    .from("annual_sales_tracking")
    .select("year, day_of_year, date, quarter, orders, revenue, channel, synced_at")
    .in("year", [currentYear, comparisonYear])
    .in("channel", channelValues)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch annual sales data: ${error.message}`);
  }

  // Index data by DATE STRING (not day-of-year) for proper calendar alignment
  // This fixes the leap year bug where day 60 in 2025 (Mar 1) was compared to day 60 in 2024 (Feb 29)
  const dataByDate: Record<string, { orders: number; revenue: number; year: number }> = {};

  let lastSynced: string | null = null;

  for (const row of rawData || []) {
    if (!row.date) continue;

    const existing = dataByDate[row.date];
    if (existing) {
      // Aggregate multiple channels for the same date
      existing.orders += row.orders || 0;
      existing.revenue += parseFloat(row.revenue) || 0;
    } else {
      dataByDate[row.date] = {
        orders: row.orders || 0,
        revenue: parseFloat(row.revenue) || 0,
        year: row.year,
      };
    }
    if (row.synced_at && (!lastSynced || row.synced_at > lastSynced)) {
      lastSynced = row.synced_at;
    }
  }

  // Build daily data array with cumulative totals
  const daysInCurrentYear = getDaysInYear(currentYear);
  const daysInComparisonYear = getDaysInYear(comparisonYear);

  const dailyData: DaySalesData[] = [];
  let cumOrdersCurrent = 0;
  let cumRevenuesCurrent = 0;
  let cumOrdersComparison = 0;
  let cumRevenuesComparison = 0;

  // For YTD: only accumulate up to current day if viewing current year (EST timezone)
  const currentDayOfYear = getCurrentDayOfYearEST();
  const isViewingCurrentYear = currentYear === thisYear;

  // ytdCutoffDay: Used for chart display (includes today's partial data)
  const ytdCutoffDay = isViewingCurrentYear ? currentDayOfYear : daysInCurrentYear;

  // yoyCompletedDay: Used for YoY percentage calculations (excludes today's partial data)
  // Comparing partial-to-complete data is unfair, so we only compare completed days
  // Returns 0 on January 1st (no completed days yet)
  const yoyCompletedDay = isViewingCurrentYear ? getLastCompletedDayOfYearEST() : daysInCurrentYear;

  // Iterate through current year's calendar dates
  for (let day = 1; day <= daysInCurrentYear; day++) {
    // Get the actual calendar date for this day-of-year in current year
    const currentDateStr = getDateFromDayOfYear(currentYear, day);

    // Get the CORRESPONDING date in comparison year (handles leap year alignment)
    // e.g., 2025-03-01 → 2024-03-01 (not 2024-02-29 which would be day 60 in leap year)
    const comparisonDateStr = getCorrespondingDate(currentDateStr, comparisonYear);

    const currentData = dataByDate[currentDateStr];
    const comparisonData = dataByDate[comparisonDateStr];

    const ordersCurrent = currentData?.orders || 0;
    const revenueCurrent = currentData?.revenue || 0;
    const ordersComparison = comparisonData?.orders || 0;
    const revenueComparison = comparisonData?.revenue || 0;

    // Current year: accumulate up to last COMPLETED day only (not today's partial)
    if (day <= yoyCompletedDay) {
      cumOrdersCurrent += ordersCurrent;
      cumRevenuesCurrent += revenueCurrent;
    }

    // Comparison year: accumulate for days up to ytdCutoffDay (for chart trajectory)
    // We use ytdCutoffDay here to show comparison line up to same point as current
    if (day <= ytdCutoffDay) {
      cumOrdersComparison += ordersComparison;
      cumRevenuesComparison += revenueComparison;
    }

    // Get quarter from actual date
    const quarter = getQuarterFromDate(currentDateStr);

    // For current year: set cumulative to null for days beyond last COMPLETED day
    // Today's partial data shouldn't be shown in cumulative (unfair comparison)
    const hasCurrent = day <= yoyCompletedDay;

    dailyData.push({
      dayOfYear: day,
      date: currentDateStr,
      quarter,
      ordersCurrent,
      ordersComparison,
      revenueCurrent,
      revenueComparison,
      // Current year cumulative: null for future days (line stops at current day)
      cumulativeOrdersCurrent: hasCurrent ? cumOrdersCurrent : null,
      cumulativeRevenueCurrent: hasCurrent ? cumRevenuesCurrent : null,
      // Comparison year cumulative: follows same pattern for chart alignment
      cumulativeOrdersComparison: day <= ytdCutoffDay ? cumOrdersComparison : cumOrdersComparison,
      cumulativeRevenueComparison: day <= ytdCutoffDay ? cumRevenuesComparison : cumRevenuesComparison,
    });
  }

  // Build quarter summaries using actual quarter assignments from dates
  const currentQuarter = getCurrentQuarterEST();
  const quarterSummaries: QuarterSummary[] = [];

  for (let q = 1; q <= 4; q++) {
    const qMeta = QUARTER_META[q as 1 | 2 | 3 | 4];
    const qData = dailyData.filter((d) => d.quarter === q);

    // Display totals (includes today's partial data)
    let ordersCurrent = 0;
    let revenueCurrent = 0;
    let daysComplete = 0;

    // Completed-day totals for fair YoY growth calculation
    let ordersCurrentCompleted = 0;
    let revenueCurrentCompleted = 0;
    let ordersComparison = 0;
    let revenueComparison = 0;

    for (const day of qData) {
      // isWithinDisplay: Include in current year display totals (shows today's partial)
      const isWithinDisplay = day.dayOfYear <= ytdCutoffDay;
      // isWithinComparison: Include in YoY comparison (completed days only, both years)
      const isWithinComparison = day.dayOfYear <= yoyCompletedDay;

      // Current year display totals: include up to today
      if (isWithinDisplay) {
        ordersCurrent += day.ordersCurrent;
        revenueCurrent += day.revenueCurrent;

        if (day.ordersCurrent > 0 || day.revenueCurrent > 0) {
          daysComplete++;
        }
      }

      // YoY comparison: both years use completed days only for fair comparison
      if (isWithinComparison) {
        ordersCurrentCompleted += day.ordersCurrent;
        revenueCurrentCompleted += day.revenueCurrent;
        ordersComparison += day.ordersComparison;
        revenueComparison += day.revenueComparison;
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
      // Growth uses completed-day totals for fair YoY comparison
      ordersGrowth: calcGrowth(ordersCurrentCompleted, ordersComparison),
      revenueCurrent,
      revenueComparison,
      revenueGrowth: calcGrowth(revenueCurrentCompleted, revenueComparison),
      daysComplete,
      daysTotal: qData.length,
      isComplete,
      isCurrent,
    });
  }

  // Build YTD summary
  // Display data: include up to today (for showing current totals)
  const ytdDataDisplay = dailyData.filter((d) => d.dayOfYear <= ytdCutoffDay);
  // Comparison data: only completed days for fair YoY % (excludes today for both years)
  const ytdDataCompleted = dailyData.filter((d) => d.dayOfYear <= yoyCompletedDay);

  const daysComplete = ytdDataDisplay.filter((d) => d.ordersCurrent > 0 || d.revenueCurrent > 0).length;

  // Display totals (includes today's partial data)
  const totalOrdersCurrent = ytdDataDisplay.reduce((sum, d) => sum + d.ordersCurrent, 0);
  const totalRevenueCurrent = ytdDataDisplay.reduce((sum, d) => sum + d.revenueCurrent, 0);

  // YoY comparison totals (completed days only, for fair comparison)
  const ordersCurrentCompleted = ytdDataCompleted.reduce((sum, d) => sum + d.ordersCurrent, 0);
  const revenueCurrentCompleted = ytdDataCompleted.reduce((sum, d) => sum + d.revenueCurrent, 0);
  const totalOrdersComparison = ytdDataCompleted.reduce((sum, d) => sum + d.ordersComparison, 0);
  const totalRevenueComparison = ytdDataCompleted.reduce((sum, d) => sum + d.revenueComparison, 0);

  const ytdSummary: YTDSummary = {
    ordersCurrent: totalOrdersCurrent,
    ordersComparison: totalOrdersComparison,
    // Growth uses completed-day totals for fair YoY comparison
    ordersGrowth: calcGrowth(ordersCurrentCompleted, totalOrdersComparison),
    revenueCurrent: totalRevenueCurrent,
    revenueComparison: totalRevenueComparison,
    revenueGrowth: calcGrowth(revenueCurrentCompleted, totalRevenueComparison),
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

    // Calendar year mode (use EST timezone for consistency)
    const thisYear = getCurrentYearEST();
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
