/**
 * P&L Dashboard API
 *
 * Returns monthly P&L data by channel and category.
 * Supports YoY comparisons, monthly trends, and cumulative tracking.
 * Designed to power a Fathom-style sales report.
 *
 * Modes:
 * - TTM (default): Trailing 12 complete months
 * - Year: Calendar year view (legacy behavior)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/server";
import { getTTMBoundaries, getLastNMonthsBoundaries, getNowEST } from "@/lib/date-utils";

export const dynamic = "force-dynamic";

type ViewMode = "ttm" | "year";

interface PLMonthlyRow {
  year_month: string;
  channel: string;
  category: string;
  revenue: number;
  cogs: number | null;
  gross_profit: number;
}

interface CategoryData {
  web: number;
  wholesale: number;
  total: number;
}

interface MonthlyData {
  month: string;
  monthNum: number;
  web: number;
  wholesale: number;
  total: number;
  byCategory: Record<string, CategoryData>;
}

interface YoYComparison {
  current: number;
  prior: number;
  change: number;
  changePercent: number;
}

interface MonthComparison {
  category: string;
  current: number;
  prior: number;
  yoyPercent: number;
  currentWeb?: number;
  currentWholesale?: number;
  priorWeb?: number;
  priorWholesale?: number;
}

function aggregateMonthlyData(rows: PLMonthlyRow[]): Record<string, MonthlyData> {
  const monthlyData: Record<string, MonthlyData> = {};

  for (const row of rows) {
    const m = row.year_month;
    const monthNum = parseInt(m.split("-")[1]);

    if (!monthlyData[m]) {
      monthlyData[m] = {
        month: m,
        monthNum,
        web: 0,
        wholesale: 0,
        total: 0,
        byCategory: {},
      };
    }

    const channel = row.channel as "Web" | "Wholesale";
    const revenue = Number(row.revenue) || 0;

    if (channel === "Web") monthlyData[m].web += revenue;
    else if (channel === "Wholesale") monthlyData[m].wholesale += revenue;
    monthlyData[m].total += revenue;

    if (!monthlyData[m].byCategory[row.category]) {
      monthlyData[m].byCategory[row.category] = { web: 0, wholesale: 0, total: 0 };
    }
    if (channel === "Web") monthlyData[m].byCategory[row.category].web += revenue;
    else if (channel === "Wholesale") monthlyData[m].byCategory[row.category].wholesale += revenue;
    monthlyData[m].byCategory[row.category].total += revenue;
  }

  return monthlyData;
}

function calculateYTD(monthlyData: Record<string, MonthlyData>, throughMonth?: number) {
  const ytd = {
    web: 0,
    wholesale: 0,
    total: 0,
    byCategory: {} as Record<string, CategoryData>,
  };

  for (const m of Object.values(monthlyData)) {
    // If throughMonth specified, only include months up to and including that month
    if (throughMonth !== undefined && m.monthNum > throughMonth) continue;

    ytd.web += m.web;
    ytd.wholesale += m.wholesale;
    ytd.total += m.total;
    for (const [cat, vals] of Object.entries(m.byCategory)) {
      if (!ytd.byCategory[cat]) ytd.byCategory[cat] = { web: 0, wholesale: 0, total: 0 };
      ytd.byCategory[cat].web += vals.web;
      ytd.byCategory[cat].wholesale += vals.wholesale;
      ytd.byCategory[cat].total += vals.total;
    }
  }

  return ytd;
}

function yoyPercent(current: number, prior: number): number {
  if (prior === 0) return current > 0 ? 100 : 0;
  const pct = ((current - prior) / Math.abs(prior)) * 100;
  // Cap at ±1000% to prevent UI issues with extreme outliers
  return Math.min(Math.max(pct, -1000), 1000);
}

const VALID_MODES = ["ttm", "year"] as const;

export async function GET(request: NextRequest) {
  // Auth check - requires admin session
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const url = new URL(request.url);

  // Validate mode parameter
  const modeParam = url.searchParams.get("mode") || "ttm";
  if (!VALID_MODES.includes(modeParam as ViewMode)) {
    return NextResponse.json(
      { error: `Invalid mode. Must be one of: ${VALID_MODES.join(", ")}` },
      { status: 400 }
    );
  }
  const mode = modeParam as ViewMode;
  const yearParam = parseInt(url.searchParams.get("year") || getNowEST().getFullYear().toString());

  // Validate year parameter (only used in year mode)
  const currentYear = getNowEST().getFullYear();
  if (mode === "year") {
    if (isNaN(yearParam) || yearParam < 2020 || yearParam > currentYear + 5) {
      return NextResponse.json(
        { error: `Invalid year. Must be between 2020 and ${currentYear + 5}` },
        { status: 400 }
      );
    }
  }
  const year = yearParam;

  const supabase = createServiceClient();

  try {
    // Determine date ranges based on mode
    let currentRange: { start: string; end: string };
    let priorRange: { start: string; end: string };
    let ttmInfo: {
      startMonth: string;
      endMonth: string;
      label: string;
      priorLabel: string;
      monthLabels: { yearMonth: string; shortLabel: string }[];
    } | null = null;
    let last3MonthsInfo: {
      current: { start: string; end: string };
      prior: { start: string; end: string };
      displayLabel: string;
    } | null = null;

    if (mode === "ttm") {
      const ttmBounds = getTTMBoundaries();
      currentRange = ttmBounds.current;
      priorRange = ttmBounds.prior;
      ttmInfo = {
        startMonth: ttmBounds.current.start,
        endMonth: ttmBounds.current.end,
        label: ttmBounds.displayLabel,
        priorLabel: ttmBounds.priorDisplayLabel,
        monthLabels: ttmBounds.monthLabels,
      };
      // Get last 3 months for "Last 3 Months" card (replaces QTD in TTM mode)
      last3MonthsInfo = getLastNMonthsBoundaries(3);
    } else {
      // Calendar year mode
      currentRange = { start: `${year}-01`, end: `${year}-12` };
      priorRange = { start: `${year - 1}-01`, end: `${year - 1}-12` };
    }

    // Fetch both periods in parallel
    const [currentResult, priorResult] = await Promise.all([
      supabase
        .from("ns_pl_monthly")
        .select("*")
        .gte("year_month", currentRange.start)
        .lte("year_month", currentRange.end)
        .order("year_month"),
      supabase
        .from("ns_pl_monthly")
        .select("*")
        .gte("year_month", priorRange.start)
        .lte("year_month", priorRange.end)
        .order("year_month"),
    ]);

    if (currentResult.error || priorResult.error) {
      const errorMsg = currentResult.error?.message || priorResult.error?.message || "Database query failed";
      console.error("[PL-API] Query error:", {
        currentError: currentResult.error,
        priorError: priorResult.error,
      });
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    const currentData = (currentResult.data || []) as PLMonthlyRow[];
    const priorData = (priorResult.data || []) as PLMonthlyRow[];

    // Aggregate monthly data for both years
    const currentMonthly = aggregateMonthlyData(currentData);
    const priorMonthly = aggregateMonthlyData(priorData);

    // Get all categories
    const categories = new Set<string>();
    currentData.forEach((r) => categories.add(r.category));
    priorData.forEach((r) => categories.add(r.category));

    // Calculate YTD totals
    const ytd = calculateYTD(currentMonthly);
    const priorYtd = calculateYTD(priorMonthly);

    // Get the most recent month with data for calculating "closed" period
    const monthlyArrayTemp = Object.values(currentMonthly).sort((a, b) => a.month.localeCompare(b.month));
    const nowEST = getNowEST();
    const currentCalendarYear = nowEST.getFullYear();
    const currentCalendarMonth = nowEST.getMonth() + 1; // 1-indexed

    // Determine "closed through" month based on whether we're viewing current year or past year
    // This is only used in year mode; TTM always shows complete months
    let closedThroughMonth: number;

    if (mode === "ttm") {
      // TTM mode: all 12 months are complete by definition
      closedThroughMonth = 12;
    } else if (year < currentCalendarYear) {
      // Past year: all 12 months are closed
      closedThroughMonth = 12;
    } else if (year > currentCalendarYear) {
      // Future year: use whatever data exists, or current calendar month - 1
      const lastDataMonth = monthlyArrayTemp[monthlyArrayTemp.length - 1]?.monthNum;
      closedThroughMonth = lastDataMonth ? Math.max(lastDataMonth - 1, 0) : 0;
    } else {
      // Current year: closed through prior month (current month is "open")
      // If it's January, there's no closed month yet for this year
      closedThroughMonth = currentCalendarMonth - 1;
    }

    // For backwards compatibility with existing code that uses these
    const currentMonthNum = monthlyArrayTemp[monthlyArrayTemp.length - 1]?.monthNum || currentCalendarMonth;
    const priorMonthNum = closedThroughMonth;

    // Calculate YTD through closed period - more stable for comparisons
    // In TTM mode, we don't need this since all months are complete
    const ytdClosed = mode === "year" && closedThroughMonth > 0 ? calculateYTD(currentMonthly, closedThroughMonth) : null;
    const priorYtdClosed = mode === "year" && closedThroughMonth > 0 ? calculateYTD(priorMonthly, closedThroughMonth) : null;

    // Build monthly arrays sorted by month
    const monthlyArray = Object.values(currentMonthly).sort((a, b) => a.month.localeCompare(b.month));
    const priorMonthlyArray = Object.values(priorMonthly).sort((a, b) => a.month.localeCompare(b.month));

    // Calculate cumulative totals for trend charts
    const cumulativeYtd: { month: string; monthNum: number; current: number; prior: number; label?: string }[] = [];
    let currentCumulative = 0;
    let priorCumulative = 0;

    if (mode === "ttm" && ttmInfo) {
      // TTM mode: iterate through the month labels (may span years)
      for (let i = 0; i < ttmInfo.monthLabels.length; i++) {
        const { yearMonth, shortLabel } = ttmInfo.monthLabels[i];
        // Get corresponding prior month (same position in prior TTM)
        const [priorYear, priorMonth] = yearMonth.split("-").map(Number);
        const priorYearMonth = `${priorYear - 1}-${String(priorMonth).padStart(2, "0")}`;

        const currentMonth = currentMonthly[yearMonth];
        const priorMonthData = priorMonthly[priorYearMonth];

        if (currentMonth) currentCumulative += currentMonth.total;
        if (priorMonthData) priorCumulative += priorMonthData.total;

        cumulativeYtd.push({
          month: yearMonth,
          monthNum: i + 1,
          current: currentCumulative,
          prior: priorCumulative,
          label: shortLabel,
        });
      }
    } else {
      // Year mode: iterate months 1-12 of the calendar year
      for (let m = 1; m <= 12; m++) {
        const monthStr = m.toString().padStart(2, "0");
        const currentMonth = currentMonthly[`${year}-${monthStr}`];
        const priorMonth = priorMonthly[`${year - 1}-${monthStr}`];

        if (currentMonth) currentCumulative += currentMonth.total;
        if (priorMonth) priorCumulative += priorMonth.total;

        if (currentMonth || priorMonth) {
          cumulativeYtd.push({
            month: `${year}-${monthStr}`,
            monthNum: m,
            current: currentCumulative,
            prior: priorCumulative,
          });
        }
      }
    }

    // Calculate "Last 3 Months" data for TTM mode (replaces QTD)
    let last3Months: {
      current: { web: number; wholesale: number; total: number; byCategory: Record<string, CategoryData> };
      prior: { web: number; wholesale: number; total: number; byCategory: Record<string, CategoryData> };
      displayLabel: string;
    } | null = null;

    if (mode === "ttm" && last3MonthsInfo) {
      // Aggregate the last 3 months for current and prior periods
      const l3mCurrent = { web: 0, wholesale: 0, total: 0, byCategory: {} as Record<string, CategoryData> };
      const l3mPrior = { web: 0, wholesale: 0, total: 0, byCategory: {} as Record<string, CategoryData> };

      // Iterate through months in the range
      for (const [monthKey, monthData] of Object.entries(currentMonthly)) {
        if (monthKey >= last3MonthsInfo.current.start && monthKey <= last3MonthsInfo.current.end) {
          l3mCurrent.web += monthData.web;
          l3mCurrent.wholesale += monthData.wholesale;
          l3mCurrent.total += monthData.total;
          for (const [cat, vals] of Object.entries(monthData.byCategory)) {
            if (!l3mCurrent.byCategory[cat]) l3mCurrent.byCategory[cat] = { web: 0, wholesale: 0, total: 0 };
            l3mCurrent.byCategory[cat].web += vals.web;
            l3mCurrent.byCategory[cat].wholesale += vals.wholesale;
            l3mCurrent.byCategory[cat].total += vals.total;
          }
        }
      }

      for (const [monthKey, monthData] of Object.entries(priorMonthly)) {
        if (monthKey >= last3MonthsInfo.prior.start && monthKey <= last3MonthsInfo.prior.end) {
          l3mPrior.web += monthData.web;
          l3mPrior.wholesale += monthData.wholesale;
          l3mPrior.total += monthData.total;
          for (const [cat, vals] of Object.entries(monthData.byCategory)) {
            if (!l3mPrior.byCategory[cat]) l3mPrior.byCategory[cat] = { web: 0, wholesale: 0, total: 0 };
            l3mPrior.byCategory[cat].web += vals.web;
            l3mPrior.byCategory[cat].wholesale += vals.wholesale;
            l3mPrior.byCategory[cat].total += vals.total;
          }
        }
      }

      last3Months = {
        current: l3mCurrent,
        prior: l3mPrior,
        displayLabel: last3MonthsInfo.displayLabel,
      };
    }

    // Get the most recent month with data
    const lastMonth = monthlyArray[monthlyArray.length - 1];
    const lastMonthNum = lastMonth?.monthNum || new Date().getMonth() + 1;
    const lastMonthKey = lastMonth?.month || `${year}-${lastMonthNum.toString().padStart(2, "0")}`;
    const priorLastMonthKey = `${year - 1}-${lastMonthNum.toString().padStart(2, "0")}`;

    // Build last month comparison data (matching Fathom's table structure)
    const lastMonthData = currentMonthly[lastMonthKey];
    const priorLastMonthData = priorMonthly[priorLastMonthKey];

    const buildComparison = (
      cat: string,
      current: CategoryData | undefined,
      prior: CategoryData | undefined
    ): MonthComparison => ({
      category: cat,
      current: current?.total || 0,
      prior: prior?.total || 0,
      yoyPercent: yoyPercent(current?.total || 0, prior?.total || 0),
      currentWeb: current?.web || 0,
      currentWholesale: current?.wholesale || 0,
      priorWeb: prior?.web || 0,
      priorWholesale: prior?.wholesale || 0,
    });

    // Fathom-style category ordering
    const categoryOrder = [
      "Cast Iron",
      "Carbon Steel",
      "Glass Lids",
      "Accessories",
      "Services",
      "Shipping Income",
      "Other",
      "Other Cookware",
      "Discounts",
    ];

    const sortedCategories = Array.from(categories).sort((a, b) => {
      const aIdx = categoryOrder.indexOf(a);
      const bIdx = categoryOrder.indexOf(b);
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });

    // Build month comparison for the report table
    const lastMonthComparison = sortedCategories
      .filter((cat) => cat !== "Discounts")
      .map((cat) =>
        buildComparison(
          cat,
          lastMonthData?.byCategory[cat],
          priorLastMonthData?.byCategory[cat]
        )
      );

    // Build YTD comparison
    const ytdComparison = sortedCategories
      .filter((cat) => cat !== "Discounts")
      .map((cat) =>
        buildComparison(cat, ytd.byCategory[cat], priorYtd.byCategory[cat])
      );

    // Calculate aggregates
    const cookwareCategories = ["Cast Iron", "Carbon Steel", "Glass Lids"];

    const sumCategories = (data: Record<string, CategoryData>, cats: string[]) => {
      return cats.reduce(
        (acc, cat) => ({
          web: acc.web + (data[cat]?.web || 0),
          wholesale: acc.wholesale + (data[cat]?.wholesale || 0),
          total: acc.total + (data[cat]?.total || 0),
        }),
        { web: 0, wholesale: 0, total: 0 }
      );
    };

    const grossCategories = sortedCategories.filter((c) => c !== "Discounts");

    // Last month aggregates
    const lastMonthCookware = sumCategories(lastMonthData?.byCategory || {}, cookwareCategories);
    const priorLastMonthCookware = sumCategories(priorLastMonthData?.byCategory || {}, cookwareCategories);
    const lastMonthGross = sumCategories(lastMonthData?.byCategory || {}, grossCategories);
    const priorLastMonthGross = sumCategories(priorLastMonthData?.byCategory || {}, grossCategories);
    const lastMonthDiscounts = lastMonthData?.byCategory["Discounts"]?.total || 0;
    const priorLastMonthDiscounts = priorLastMonthData?.byCategory["Discounts"]?.total || 0;

    // YTD aggregates
    const ytdCookware = sumCategories(ytd.byCategory, cookwareCategories);
    const priorYtdCookware = sumCategories(priorYtd.byCategory, cookwareCategories);
    const ytdGross = sumCategories(ytd.byCategory, grossCategories);
    const priorYtdGross = sumCategories(priorYtd.byCategory, grossCategories);
    const ytdDiscounts = ytd.byCategory["Discounts"]?.total || 0;
    const priorYtdDiscounts = priorYtd.byCategory["Discounts"]?.total || 0;

    // YoY comparisons for main metrics
    const yoy = {
      total: {
        current: ytd.total,
        prior: priorYtd.total,
        change: ytd.total - priorYtd.total,
        changePercent: yoyPercent(ytd.total, priorYtd.total),
      } as YoYComparison,
      web: {
        current: ytd.web,
        prior: priorYtd.web,
        change: ytd.web - priorYtd.web,
        changePercent: yoyPercent(ytd.web, priorYtd.web),
      } as YoYComparison,
      wholesale: {
        current: ytd.wholesale,
        prior: priorYtd.wholesale,
        change: ytd.wholesale - priorYtd.wholesale,
        changePercent: yoyPercent(ytd.wholesale, priorYtd.wholesale),
      } as YoYComparison,
      byCategory: Object.fromEntries(
        sortedCategories.map((cat) => [
          cat,
          {
            current: ytd.byCategory[cat]?.total || 0,
            prior: priorYtd.byCategory[cat]?.total || 0,
            change: (ytd.byCategory[cat]?.total || 0) - (priorYtd.byCategory[cat]?.total || 0),
            changePercent: yoyPercent(
              ytd.byCategory[cat]?.total || 0,
              priorYtd.byCategory[cat]?.total || 0
            ),
          } as YoYComparison,
        ])
      ),
    };

    // Get last sync time
    const { data: syncLog } = await supabase
      .from("sync_logs")
      .select("completed_at")
      .eq("sync_type", "netsuite_pl")
      .eq("status", "success")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      // Mode information
      mode,
      year,
      priorYear: year - 1,

      // TTM-specific info (only present in TTM mode)
      ...(mode === "ttm" && ttmInfo ? {
        ttmRange: {
          startMonth: ttmInfo.startMonth,
          endMonth: ttmInfo.endMonth,
          label: ttmInfo.label,
          priorLabel: ttmInfo.priorLabel,
        },
        monthLabels: ttmInfo.monthLabels,
      } : {}),

      // Last 3 months data (replaces QTD in TTM mode)
      ...(last3Months ? { last3Months } : {}),

      // Monthly data for charts
      monthly: monthlyArray,
      priorMonthly: priorMonthlyArray,
      cumulativeYtd,

      // Period totals (YTD in year mode, 12M in TTM mode)
      ytd,
      priorYtd,

      // Last month specific data (for "Summary Last Month" section)
      lastMonth: {
        month: lastMonthKey,
        monthNum: lastMonthNum,
        data: lastMonthData || null,
        priorData: priorLastMonthData || null,
        comparison: lastMonthComparison,
        cookware: {
          current: lastMonthCookware,
          prior: priorLastMonthCookware,
          yoyPercent: yoyPercent(lastMonthCookware.total, priorLastMonthCookware.total),
        },
        grossRevenue: {
          current: lastMonthGross.total,
          prior: priorLastMonthGross.total,
          yoyPercent: yoyPercent(lastMonthGross.total, priorLastMonthGross.total),
        },
        discounts: {
          current: lastMonthDiscounts,
          prior: priorLastMonthDiscounts,
          yoyPercent: yoyPercent(Math.abs(lastMonthDiscounts), Math.abs(priorLastMonthDiscounts)),
        },
        netRevenue: {
          current: lastMonthGross.total + lastMonthDiscounts,
          prior: priorLastMonthGross.total + priorLastMonthDiscounts,
          yoyPercent: yoyPercent(
            lastMonthGross.total + lastMonthDiscounts,
            priorLastMonthGross.total + priorLastMonthDiscounts
          ),
        },
      },

      // YTD comparison data (for "Summary YTD" section)
      ytdSummary: {
        comparison: ytdComparison,
        cookware: {
          current: ytdCookware,
          prior: priorYtdCookware,
          yoyPercent: yoyPercent(ytdCookware.total, priorYtdCookware.total),
        },
        grossRevenue: {
          current: ytdGross.total,
          prior: priorYtdGross.total,
          yoyPercent: yoyPercent(ytdGross.total, priorYtdGross.total),
        },
        discounts: {
          current: ytdDiscounts,
          prior: priorYtdDiscounts,
          yoyPercent: yoyPercent(Math.abs(ytdDiscounts), Math.abs(priorYtdDiscounts)),
        },
        netRevenue: {
          current: ytdGross.total + ytdDiscounts,
          prior: priorYtdGross.total + priorYtdDiscounts,
          yoyPercent: yoyPercent(
            ytdGross.total + ytdDiscounts,
            priorYtdGross.total + priorYtdDiscounts
          ),
        },
      },

      // YTD through prior month (closed books - stable for comparisons)
      ytdClosed: ytdClosed && priorYtdClosed ? (() => {
        const closedCookware = sumCategories(ytdClosed.byCategory, cookwareCategories);
        const priorClosedCookware = sumCategories(priorYtdClosed.byCategory, cookwareCategories);
        const closedGross = sumCategories(ytdClosed.byCategory, grossCategories);
        const priorClosedGross = sumCategories(priorYtdClosed.byCategory, grossCategories);
        const closedDiscounts = ytdClosed.byCategory["Discounts"]?.total || 0;
        const priorClosedDiscounts = priorYtdClosed.byCategory["Discounts"]?.total || 0;

        return {
          throughMonth: priorMonthNum,
          throughMonthName: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][priorMonthNum - 1],
          current: ytdClosed,
          prior: priorYtdClosed,
          comparison: sortedCategories
            .filter((cat) => cat !== "Discounts")
            .map((cat) =>
              buildComparison(cat, ytdClosed.byCategory[cat], priorYtdClosed.byCategory[cat])
            ),
          cookware: {
            current: closedCookware,
            prior: priorClosedCookware,
            yoyPercent: yoyPercent(closedCookware.total, priorClosedCookware.total),
          },
          grossRevenue: {
            current: closedGross.total,
            prior: priorClosedGross.total,
            yoyPercent: yoyPercent(closedGross.total, priorClosedGross.total),
          },
          discounts: {
            current: closedDiscounts,
            prior: priorClosedDiscounts,
            yoyPercent: yoyPercent(Math.abs(closedDiscounts), Math.abs(priorClosedDiscounts)),
          },
          netRevenue: {
            current: closedGross.total + closedDiscounts,
            prior: priorClosedGross.total + priorClosedDiscounts,
            yoyPercent: yoyPercent(
              closedGross.total + closedDiscounts,
              priorClosedGross.total + priorClosedDiscounts
            ),
          },
        };
      })() : null,

      // YoY comparisons
      yoy,

      // Metadata
      categories: sortedCategories,
      lastSync: syncLog?.completed_at || null,
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("[PL-API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
